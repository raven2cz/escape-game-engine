// board/board-model.js
//
// The teacher's board, as data. Pure: no DOM, no clock of its own, no network.
// It consumes only the public dashboard API (DashboardReport, via the store
// below, and the catalogue from engine/dashboard/catalogue.js) and never
// imports anything else from the engine. That is deliberate and it is the
// test of the API: if the board needs something the report does not carry, the
// report is what gets extended, not this file.
//
// Judgements live here, not in the engine. The engine reports where a team is
// and since when; whether that is "stuck" is decided here, against the rest of
// the class, and the thresholds are options.

import {checkReport, toWire, DASHBOARD_API_VERSION} from '../engine/dashboard/report.js';

export const BOARD_DEFAULTS = Object.freeze({
    /** A single stay is never shown longer than a lesson: a tablet that slept through a break. */
    lessonMs: 45 * 60_000,
    /** No report for this long: the tablet may have gone to sleep or lost the network. */
    staleMs: 60_000,
    /** No report for this long: treat it as disconnected. */
    offlineMs: 3 * 60_000,
    /** Never call a team stuck before this long in one place. */
    stuckMinMs: 4 * 60_000,
    /** ...and not before this many times the class's median stay. */
    stuckFactor: 2,
});

/**
 * A report from a newer contract, reduced to what every version promises:
 * who, which run, and where. Counts and lists are emptied rather than trusted,
 * since their meaning may have changed.
 */
function positionOnly(report) {
    const wire = toWire(report);
    wire.activity = null;
    wire.progress = {scenesVisited: 0, scenesTotal: null, puzzlesSolved: 0, puzzlesTotal: null};
    for (const list of ['inventory', 'itemsUsed', 'dialogsSeen', 'puzzles', 'milestones']) wire[list] = [];
    return wire;
}

/** Where a report is filed: one slot per lesson, game and team. */
export function teamKey(report) {
    const part = (v) => encodeURIComponent(v ?? '');
    return `${part(report.session)}|${part(report.game)}|${part(report.team)}`;
}

/**
 * The latest report of every team. Reports can arrive twice, late, or out of
 * order (a retry, a beacon, a slow request); the order key is (run, revision)
 * from the contract. A later run of the same team (a restart) replaces an
 * earlier one; within a run the higher revision wins.
 */
export class ReportStore {
    constructor() {
        this._byKey = new Map();
    }

    /**
     * @returns {'accepted'|'stale'|'invalid'}
     */
    ingest(report, receivedAt) {
        if (!report || typeof report !== 'object') return 'invalid';
        const newer = Number.isInteger(report.api) && report.api > DASHBOARD_API_VERSION;
        if (newer) {
            // A newer engine than this board. Keep only what this board knows
            // how to read, rebuilt field by declared field, and show position
            // only: nothing the board does not understand is stored or handed
            // on (the dev server lists what is stored).
            if (typeof report.game !== 'string' || typeof report.run !== 'string') return 'invalid';
            report = positionOnly(report);
        } else if (checkReport(report).length) {
            return 'invalid';
        }
        const key = teamKey(report);
        const held = this._byKey.get(key);
        if (held) {
            const a = held.report;
            if (a.run === report.run) {
                if (report.revision <= a.revision) return 'stale';
            } else if ((report.startedAt ?? 0) < (a.startedAt ?? 0)) {
                return 'stale';
            }
        }
        this._byKey.set(key, {report, receivedAt, newerApi: newer});
        return 'accepted';
    }

    /** Entries for one game, optionally one lesson. */
    list({game = null, session = null} = {}) {
        return [...this._byKey.values()].filter(e =>
            (!game || e.report.game === game) && (session == null || e.report.session === session));
    }

    clear() {
        this._byKey.clear();
    }
}

const median = (values) => {
    if (!values.length) return 0;
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const collator = typeof Intl !== 'undefined' ? new Intl.Collator('cs', {numeric: true}) : null;
const byTeam = (a, b) => (collator ? collator.compare(a, b) : (a < b ? -1 : a > b ? 1 : 0));

/**
 * @typedef {'first'|'after'|'open'|'none'} CellState
 *   first: solved without a mistake; after: solved after mistakes;
 *   open: tried, not solved yet; none: not touched
 */

/**
 * Everything the board shows, computed from the latest report of each team.
 *
 * @param {object|null} catalogue  from buildCatalogue(); may be null or not ready
 * @param {{report: object, receivedAt: number, newerApi?: boolean}[]} entries
 * @param {object} [options]  `now` is required; the rest default to BOARD_DEFAULTS
 */
export function summarize(catalogue, entries, options = {}) {
    const o = {...BOARD_DEFAULTS, ...options};
    const now = o.now;
    if (!Number.isFinite(now)) throw new Error('summarize needs options.now');

    const cat = catalogue || null;
    const sceneLabel = new Map((cat?.scenes || []).map(s => [s.id, s.label]));
    const clamp = (ms) => Math.max(0, Math.min(ms, o.lessonMs));

    // Tasks: the catalogue's, in game order. Without one, whatever teams reported.
    let tasks = cat?.tasks ? cat.tasks.map(t => ({id: t.id, label: t.label})) : null;
    if (!tasks) {
        const seen = new Map();
        for (const {report} of entries) {
            for (const p of report.puzzles || []) if (!seen.has(p.ref)) seen.set(p.ref, {id: p.ref, label: p.ref});
        }
        tasks = [...seen.values()];
    }

    const teams = entries.map(({report: r, receivedAt, newerApi}) => {
        const outcomes = new Map((r.puzzles || []).map(p => [p.ref, p]));
        const since = r.position?.since ?? now;
        const lastSeenMs = Math.max(0, now - receivedAt);
        const milestoneSet = new Set(r.milestones || []);
        const inventory = new Set(r.inventory || []);
        const used = new Set(r.itemsUsed || []);
        return {
            key: teamKey(r),
            team: r.team || 'Bez názvu',
            session: r.session,
            newerApi: !!newerApi,
            scene: r.position?.scene ?? null,
            sceneLabel: r.position?.label ?? sceneLabel.get(r.position?.scene) ?? r.position?.scene ?? null,
            sceneForMs: r.completed ? 0 : clamp(now - since),
            activity: r.activity
                ? {ref: r.activity.ref, label: r.activity.label || r.activity.ref, forMs: clamp(now - r.activity.since)}
                : null,
            solved: r.progress?.puzzlesSolved ?? 0,
            total: r.progress?.puzzlesTotal ?? null,
            scenesVisited: r.progress?.scenesVisited ?? 0,
            scenesTotal: r.progress?.scenesTotal ?? null,
            mistakes: (r.puzzles || []).reduce((sum, p) => sum + (p.mistakes || 0), 0),
            milestones: (cat?.milestones || []).map(m => ({id: m.id, label: m.label, reached: milestoneSet.has(m.id)})),
            items: (cat?.items || []).map(it => ({
                id: it.id, label: it.label,
                state: used.has(it.id) ? 'used' : inventory.has(it.id) ? 'has' : 'none',
            })),
            completed: !!r.completed,
            completedAt: r.completedAt ?? null,
            playedMs: Math.max(0, (r.completedAt ?? now) - (r.startedAt ?? now)),
            lastSeenMs,
            connection: lastSeenMs >= o.offlineMs ? 'offline' : lastSeenMs >= o.staleMs ? 'stale' : 'ok',
            stuck: false,
            outcomes,
        };
    }).sort((a, b) => byTeam(a.team, b.team));

    // Stuck: much longer in one place than the rest of the class, and long in
    // absolute terms. A team that is disconnected is shown as that instead;
    // "no news" is not the same as "no progress".
    const playing = teams.filter(t => !t.completed);
    // The class baseline is the teams we are actually hearing from; a
    // disconnected tablet's frozen clock says nothing about the room.
    const med = median(playing.filter(t => t.connection !== 'offline').map(t => t.sceneForMs));
    const threshold = Math.max(o.stuckMinMs, o.stuckFactor * med);
    for (const t of playing) {
        const longStay = t.sceneForMs >= threshold;
        const longPuzzle = !!t.activity && t.activity.forMs >= threshold;
        t.stuck = t.connection !== 'offline' && (longStay || longPuzzle);
    }

    const grid = tasks.map(task => {
        let withMistakes = 0;
        let solvedBy = 0;
        const cells = teams.map(t => {
            const p = t.outcomes.get(task.id);
            if (p?.mistakes) withMistakes++;
            if (p?.solved) solvedBy++;
            /** @type {CellState} */
            const state = !p ? 'none' : p.solved ? (p.mistakes ? 'after' : 'first') : 'open';
            return {team: t.key, state, mistakes: p?.mistakes ?? 0};
        });
        return {id: task.id, label: task.label, cells, withMistakes, solvedBy};
    });

    for (const t of teams) delete t.outcomes;

    return {
        now,
        catalogueReady: !!cat?.ready,
        show: {items: !!cat?.show?.items, milestones: !!cat?.show?.milestones},
        teams,
        grid,
        summary: {
            teams: teams.length,
            completed: teams.filter(t => t.completed).length,
            stuck: teams.filter(t => t.stuck).length,
            offline: teams.filter(t => t.connection === 'offline').length,
            medianStayMs: med,
        },
    };
}

/** "3 min 05 s", "45 s": short, for a table cell. */
export function formatDuration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    const r = String(s % 60).padStart(2, '0');
    if (m < 60) return `${m} min ${r} s`;
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
