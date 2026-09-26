// engine/dashboard/progress-model.js
//
// The private half of EI-010: what the engine records so that it is *able* to
// answer "what is this team doing". It lives in `state.progress`, survives a
// reload with the rest of the saved state, and is nobody's business but the
// engine's. Nothing here is ever sent anywhere; the projector reads it and
// builds the public DashboardReport. See plans/EI-010-DESIGN-API.md §3.
//
// ProgressModel is the only writer of `state.progress`. Every mutation is O(1)
// and happens synchronously inside a signal, so a transition costs a few integer
// writes and nothing else.
//
// Persistence is not done here. The reporter's flush saves the state before it
// reports (reserve, persist, send), and that flush is scheduled by the same
// signals, so a mutation made on a transition that does not save by itself (a
// held wrong answer, a dialog that sets nothing) reaches storage once the flush
// runs, without waiting for a later move. Telemetry is eventually durable;
// lesson continuity never depended on it.

import {SIGNALS} from './signals.js';

/** Upper bounds on the collections, so an edited or injected save cannot inflate a report. */
export const PROGRESS_LIMITS = Object.freeze({
    puzzles: 500,
    items: 300,
    dialogs: 300,
    scenes: 500,
    idLength: 200,
});

/** A run id: new for every fresh start, kept across reloads. */
export function mintRunId() {
    try {
        if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    } catch { /* fall through */
    }
    const rnd = () => Math.floor(Math.random() * 0x100000000).toString(36);
    return `r-${Date.now().toString(36)}-${rnd()}${rnd()}`;
}

/** The progress of a run that has just begun. */
export function freshProgress(clock, mintRun = mintRunId) {
    const now = clock.now();
    return {
        run: mintRun(),
        revision: 0,
        seq: 0,
        startedAt: now,
        scene: null,
        sceneEnteredAt: now,
        completedAt: null,
        sceneTime: {},
        puzzles: {},
        itemsUsed: {},
        dialogsSeen: {},
    };
}

/** Largest revision a run may reach. Far beyond any lesson, and far inside exact integers. */
export const MAX_REVISION = 2 ** 31;
/** Largest any counter may be; beyond it a value is an edited save, not a lesson. */
const MAX_COUNT = 1_000_000_000;

const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v) => (Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), MAX_COUNT) : 0);
const stamp = (v) => (Number.isFinite(v) && v > 0 ? v : null);
const okId = (id) => typeof id === 'string' && id.length > 0 && id.length <= PROGRESS_LIMITS.idLength;

/**
 * Accept a saved `progress`, or start one. A whitelist like the rest of
 * _normalizeState(): the state is the one thing a pupil can edit in devtools.
 *
 * An older save has no progress at all. It gets a fresh one, which means times
 * count from the upgrade rather than from the real start: correct, and said so
 * in the contract.
 */
export function normalizeProgress(raw, clock, mintRun = mintRunId) {
    const fresh = freshProgress(clock, mintRun);
    if (!isMap(raw)) return fresh;

    const out = {...fresh};
    // A revision that is not a safe integer below the ceiling cannot be
    // incremented without risking a repeat, so the run starts afresh: a new
    // run id makes every earlier revision irrelevant.
    // A run without its revision is as unsafe as one with a bad one: counting
    // again from 0 would reuse numbers already sent.
    const rev = raw.revision;
    const revOk = Number.isSafeInteger(rev) && rev >= 0 && rev < MAX_REVISION;
    if (okId(raw.run) && revOk) {
        out.run = raw.run;
        out.revision = rev;
    }
    out.seq = count(raw.seq);
    out.startedAt = stamp(raw.startedAt) ?? fresh.startedAt;
    out.scene = okId(raw.scene) ? raw.scene : null;
    out.sceneEnteredAt = stamp(raw.sceneEnteredAt) ?? fresh.sceneEnteredAt;
    out.completedAt = stamp(raw.completedAt);

    const boundedMap = (src, limit, value) => {
        const res = {};
        if (!isMap(src)) return res;
        let n = 0;
        for (const [k, v] of Object.entries(src)) {
            if (n >= limit) break;
            if (!okId(k)) continue;
            const val = value(v);
            if (val === undefined) continue;
            res[k] = val;
            n++;
        }
        return res;
    };

    out.sceneTime = boundedMap(raw.sceneTime, PROGRESS_LIMITS.scenes, v => count(v));
    out.puzzles = boundedMap(raw.puzzles, PROGRESS_LIMITS.puzzles, v => (isMap(v) ? {
        seq: count(v.seq),
        attempts: count(v.attempts),
        mistakes: count(v.mistakes),
        solved: v.solved === true,
    } : undefined));
    out.itemsUsed = boundedMap(raw.itemsUsed, PROGRESS_LIMITS.items, v => count(v));
    out.dialogsSeen = boundedMap(raw.dialogsSeen, PROGRESS_LIMITS.dialogs, v => count(v));

    // The first-touch counter must stay ahead of every stored order, or a new
    // entry would sort before an old one.
    const orders = [
        ...Object.values(out.puzzles).map(p => p.seq),
        ...Object.values(out.itemsUsed),
        ...Object.values(out.dialogsSeen),
    ];
    out.seq = Math.max(out.seq, ...orders, 0);
    return out;
}

export class ProgressModel {
    /**
     * @param {object} deps
     * @param {import('./signals.js').GameSignals} deps.signals
     * @param {() => object|null} deps.getState  the live engine state; replaced on every restore
     * @param {{now: () => number}} deps.clock
     */
    constructor({signals, getState, clock}) {
        this._getState = getState;
        this._clock = clock;
        /** Leaves open right now, innermost last. Not persisted: a reload closes every puzzle. */
        this._open = [];

        const on = (name, fn) => signals.on(name, (payload) => {
            const p = this._progress();
            if (p) fn(p, payload || {});
        });

        on(SIGNALS.SCENE_ENTERED, (p, {scene}) => this._enterScene(p, scene));
        on(SIGNALS.PUZZLE_OPENED, (p, {ref}) => {
            if (okId(ref)) this._open.push({ref, since: this._clock.now()});
        });
        on(SIGNALS.PUZZLE_SETTLED, (p, {ref}) => {
            for (let i = this._open.length - 1; i >= 0; i--) {
                if (this._open[i].ref === ref) {
                    this._open.splice(i, 1);
                    break;
                }
            }
        });
        on(SIGNALS.PUZZLE_EVALUATED, (p, {ref, ok}) => {
            const rec = this._touch(p, ref);
            if (!rec) return;
            rec.attempts++;
            if (ok !== true) rec.mistakes++;
        });
        on(SIGNALS.PUZZLE_SOLVED, (p, {ref}) => {
            const rec = this._touch(p, ref);
            if (rec) rec.solved = true;
        });
        on(SIGNALS.ITEM_USED, (p, {id}) => this._mark(p.itemsUsed, id, PROGRESS_LIMITS.items, p));
        on(SIGNALS.DIALOG_ENDED, (p, {id}) => this._mark(p.dialogsSeen, id, PROGRESS_LIMITS.dialogs, p));
        on(SIGNALS.RUN_COMPLETED, (p) => {
            if (p.completedAt == null) p.completedAt = this._clock.now();
        });
    }

    /** The innermost open leaf puzzle, or null. */
    activity() {
        const top = this._open[this._open.length - 1];
        return top ? {ref: top.ref, since: top.since} : null;
    }

    _progress() {
        const s = this._getState();
        return s && isMap(s.progress) ? s.progress : null;
    }

    _enterScene(p, scene) {
        if (!okId(scene)) return;
        // The same scene again is a reload or a goto() to where the team
        // already is. Its clock keeps running; restarting it would hide exactly
        // the team that has been stuck there longest.
        if (p.scene === scene) return;
        const now = this._clock.now();
        if (p.scene != null && Object.keys(p.sceneTime).length < PROGRESS_LIMITS.scenes) {
            p.sceneTime[p.scene] = (p.sceneTime[p.scene] || 0) + Math.max(0, now - p.sceneEnteredAt);
        }
        p.scene = scene;
        p.sceneEnteredAt = now;
        this._open.length = 0;
    }

    _touch(p, ref) {
        if (!okId(ref)) return null;
        let rec = p.puzzles[ref];
        if (!rec) {
            if (Object.keys(p.puzzles).length >= PROGRESS_LIMITS.puzzles) return null;
            rec = {seq: ++p.seq, attempts: 0, mistakes: 0, solved: false};
            p.puzzles[ref] = rec;
        }
        return rec;
    }

    _mark(map, id, limit, p) {
        if (!okId(id) || map[id] != null) return;
        if (Object.keys(map).length >= limit) return;
        map[id] = ++p.seq;
    }
}
