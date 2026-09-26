// engine/dashboard/projector.js
//
// The wall between the private state and the public contract (the
// anti-corruption layer of plans/EI-010-DESIGN-API.md §4.3). A pure function:
// it reads the saved state, the private progress and the static catalogue, and
// builds one DashboardReport. It names every field it produces; there is no
// spread of internal state into the output anywhere in this file, and toWire()
// re-copies the result field by declared field on top of that.
//
// What a report says is facts, never judgements. "Stuck" is not computed here:
// the board compares `position.since` and `activity.since` against the rest of
// the class. The engine ships where a team is and since when.

import {DASHBOARD_API_VERSION} from './report.js';
import {avatarById} from './avatars.js';

const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const bySeq = (map) => Object.entries(isMap(map) ? map : {})
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
    .map(([id]) => id);

/** The solved-puzzle key the engine has always written for a hotspot puzzle. */
const SOLVED_PREFIX = 'solved:pz:';

/**
 * @param {object} input
 * @param {object} input.state      the engine's saved state (read only)
 * @param {object} input.progress   state.progress (read only)
 * @param {{ref: string, since: number}|null} input.activity  the open leaf, from ProgressModel
 * @param {object} input.catalogue  from buildCatalogue()
 * @param {{game: string, gameVersion?: string|null, session?: string|null, playerId?: string|null, player?: string|null, avatar?: string|null}} input.identity
 * @param {number} input.now
 * @param {number} input.revision   the revision this report is sent under
 * @returns {object} a DashboardReport (plain data; pass it through toWire() before sending)
 */
export function project({state, progress, activity, catalogue, identity, now, revision}) {
    const st = isMap(state) ? state : {};
    const pr = isMap(progress) ? progress : {};
    const cat = catalogue || {scenes: [], tasks: null, items: [], milestones: [], totals: {}};

    const sceneLabel = new Map(cat.scenes.map(s => [s.id, s.label]));
    const taskLabel = new Map((cat.tasks || []).map(t => [t.id, t.label]));
    const taskIds = cat.tasks ? new Set(cat.tasks.map(t => t.id)) : null;

    // Solved: what the progress model saw, plus what the engine recorded on its
    // own for hotspot puzzles. The second covers a save from before this layer
    // existed, where a team solved puzzles nobody was counting yet.
    const outcomes = new Map();
    const touched = Object.entries(isMap(pr.puzzles) ? pr.puzzles : {})
        .sort((a, b) => (a[1].seq || 0) - (b[1].seq || 0));
    for (const [ref, rec] of touched) {
        outcomes.set(ref, {ref, attempts: rec.attempts, mistakes: rec.mistakes, solved: rec.solved === true});
    }
    for (const key of Object.keys(isMap(st.solved) ? st.solved : {})) {
        if (!key.startsWith(SOLVED_PREFIX) || !st.solved[key]) continue;
        const ref = key.slice(SOLVED_PREFIX.length);
        const known = outcomes.get(ref);
        if (known) known.solved = true;
        else outcomes.set(ref, {ref, attempts: 0, mistakes: 0, solved: true});
    }
    // Once the catalogue is known, only real tasks are reported: a list
    // container, a stale id from an older build, or an injected key is not a task.
    const puzzles = [...outcomes.values()].filter(o => !taskIds || taskIds.has(o.ref));
    const solvedSet = new Set(puzzles.filter(o => o.solved).map(o => o.ref));

    const visited = isMap(st.visited) ? st.visited : {};
    const scenesVisited = cat.scenes.filter(s => visited[s.id]).length;

    const flags = isMap(st.flags) ? st.flags : {};
    const dialogsSeen = isMap(pr.dialogsSeen) ? pr.dialogsSeen : {};
    const reached = {
        flag: (ref) => !!flags[ref],
        scene: (ref) => !!visited[ref],
        task: (ref) => solvedSet.has(ref),
        dialog: (ref) => dialogsSeen[ref] != null,
    };
    const milestones = cat.milestones.filter(m => reached[m.type]?.(m.ref)).map(m => m.id);

    const scene = typeof pr.scene === 'string' ? pr.scene : (typeof st.scene === 'string' ? st.scene : null);

    return {
        api: DASHBOARD_API_VERSION,
        game: identity.game,
        gameVersion: identity.gameVersion ?? null,
        session: identity.session ?? null,
        playerId: identity.playerId ?? identity.player ?? null,
        player: identity.player ?? null,
        // Only an avatar from the shared catalogue; anything else is none.
        avatar: avatarById(identity.avatar)?.id ?? null,
        run: pr.run,
        revision,
        startedAt: pr.startedAt,
        updatedAt: now,
        completedAt: pr.completedAt ?? null,
        completed: pr.completedAt != null,
        position: {
            scene,
            label: scene != null ? (sceneLabel.get(scene) ?? null) : null,
            since: pr.sceneEnteredAt,
            progressAt: Math.max(pr.progressAt ?? 0, pr.sceneEnteredAt),
        },
        activity: activity
            ? {ref: activity.ref, label: taskLabel.get(activity.ref) ?? null, since: activity.since}
            : null,
        progress: {
            scenesVisited,
            scenesTotal: cat.totals?.scenes ?? null,
            puzzlesSolved: solvedSet.size,
            puzzlesTotal: cat.totals?.tasks ?? null,
        },
        inventory: (Array.isArray(st.inventory) ? st.inventory : []).filter(id => typeof id === 'string'),
        itemsUsed: bySeq(pr.itemsUsed),
        dialogsSeen: bySeq(pr.dialogsSeen),
        puzzles,
        milestones,
        truncated: false,
    };
}
