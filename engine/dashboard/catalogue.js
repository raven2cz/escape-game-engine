// engine/dashboard/catalogue.js
//
// The static half of what a dashboard needs: which scenes, tasks, items and
// milestones a game has, and what to call them. Derived from the game files
// alone, never from a team's state, so the same function serves the engine on a
// tablet, the board in a browser, and the hosted runtime in a Worker. No DOM, no
// engine import, no time.
//
// Two rules decide what a *task* is, because every "solved of total" on the
// board stands on them (plans/EI-010-DESIGN-API.md §7, EI-010-EVIDENCE.md §2):
//
//   - A task is a leaf puzzle a team can actually reach: from a puzzle hotspot,
//     from an event's openPuzzle, or as a step of a reachable list. Puzzles
//     defined but reachable from nothing (leeuwenhoek's seven showcase clozes)
//     are not tasks, whether or not they stay in the file.
//   - Tasks are keyed by puzzle id. A list step that names a puzzle by `ref` is
//     that puzzle, so leeuwenhoek's five lab steps, which are also direct
//     hotspots, count once. An inline step with no ref is `<list>#<index>`,
//     which cannot collide between two lists. A list itself is a container, not
//     a task.
//
// Per-game customisation lives in `meta.dashboard` in scenes.json. It can rename
// things and declare milestones; it can never change what is measured. See
// docs/DASHBOARD-API.md "Per-game customisation".

/** Resolve a text value the way the engine does, without its dictionaries: `@key@fallback` -> fallback. */
export function plainText(value) {
    if (value && typeof value === 'object' && value.key) return String(value.key);
    if (typeof value === 'string') {
        const m = value.match(/^@([^@]+)@(.*)$/s);
        return m ? m[2] : value;
    }
    return value == null ? '' : String(value);
}

const MILESTONE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const MILESTONE_SOURCES = ['flag', 'scene', 'task', 'dialog'];
const SHOW_KEYS = ['items', 'milestones'];
const LABEL_GROUPS = ['scenes', 'tasks', 'items'];
const MAX_LABEL = 120;

const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Every flag name any action in a document can set. Walks the whole tree. */
export function collectFlags(...docs) {
    const out = new Set();
    const addSpec = (spec) => {
        if (typeof spec === 'string') out.add(spec);
        else if (Array.isArray(spec)) spec.forEach(s => typeof s === 'string' && out.add(s));
        else if (isMap(spec)) Object.keys(spec).forEach(k => out.add(k));
    };
    const walk = (node, depth) => {
        if (depth > 40 || node == null || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            node.forEach(n => walk(n, depth + 1));
            return;
        }
        for (const [k, v] of Object.entries(node)) {
            if (k === 'setFlags') addSpec(v);
            walk(v, depth + 1);
        }
    };
    docs.forEach(d => walk(d, 0));
    return out;
}

/** Puzzles as an id -> config map, whichever of the three shapes they came in. */
export function puzzleMap(source) {
    if (!source || typeof source !== 'object') return null;
    if (isMap(source.byId)) return source.byId;
    if (Array.isArray(source)) return Object.fromEntries(source.filter(p => p?.id).map(p => [p.id, p]));
    return source;
}

/** Ids of the puzzles a team can open, in the order a game reaches them (roots only, not expanded). */
function rootPuzzleRefs(doc) {
    const refs = [];
    for (const scene of doc?.scenes || []) {
        for (const h of scene?.hotspots || []) {
            if (h?.type !== 'puzzle') continue;
            const ref = h.puzzleRef || h.puzzle?.ref;
            if (typeof ref === 'string' && ref) refs.push(ref);
        }
    }
    // `then` is one action object: that is how _processEvents() reads it. A list
    // there is never executed, so its puzzles are not reachable.
    for (const ev of doc?.events || []) {
        const act = ev?.then;
        const ref = act && !Array.isArray(act) ? act.openPuzzle?.ref : null;
        if (typeof ref === 'string' && ref) refs.push(ref);
    }
    return refs;
}

/**
 * The reachable leaf tasks, in first-reach order.
 * @returns {{id: string, kind: string, parent: string|null, cfg: object}[]}
 */
export function reachableTasks(doc, puzzles) {
    const byId = puzzles || {};
    const tasks = new Map();
    const expanding = new Set();

    const visitCfg = (id, cfg, parent) => {
        if (!cfg || typeof cfg !== 'object') return;
        if (cfg.kind === 'list') {
            if (expanding.has(id)) return; // a list that contains itself
            expanding.add(id);
            const steps = cfg.steps || cfg.items || [];
            steps.forEach((step, i) => {
                if (typeof step?.ref === 'string' && step.ref) visitRef(step.ref, id);
                else if (step?.config) visitCfg(`${id}#${i}`, step.config, id);
            });
            expanding.delete(id);
            return;
        }
        if (!tasks.has(id)) tasks.set(id, {id, kind: String(cfg.kind || ''), parent, cfg});
    };
    const visitRef = (ref, parent) => {
        const cfg = byId[ref];
        if (!cfg) return; // a reference to nothing is broken data, not a task
        visitCfg(ref, cfg, parent);
    };

    rootPuzzleRefs(doc).forEach(ref => visitRef(ref, null));
    return [...tasks.values()];
}

/**
 * Check a game's `meta.dashboard` declaration.
 *
 * `known` holds the ids that exist. A set that is `null` means "cannot tell
 * yet" (the puzzle catalogue has not loaded), and a reference into it is then
 * accepted rather than refused. The games repository runs this with every set
 * filled, so there a reference to nothing fails the build.
 *
 * @returns {{dashboard: object, errors: string[]}} the usable part, and why the rest was dropped
 */
export function validateDashboardMeta(raw, known = {}) {
    const errors = [];
    const out = {labels: {scenes: {}, tasks: {}, items: {}}, milestones: [], show: {}};
    if (raw == null) return {dashboard: out, errors};
    if (!isMap(raw)) return {dashboard: out, errors: ['meta.dashboard must be an object']};

    for (const key of Object.keys(raw)) {
        if (!['labels', 'milestones', 'show'].includes(key)) errors.push(`meta.dashboard.${key} is not a known setting`);
    }

    const exists = (set, id) => set == null || set.has(id);
    const setFor = {scenes: known.scenes, tasks: known.tasks, items: known.items};

    if (raw.labels != null) {
        if (!isMap(raw.labels)) errors.push('meta.dashboard.labels must be an object');
        else {
            for (const [group, map] of Object.entries(raw.labels)) {
                if (!LABEL_GROUPS.includes(group)) {
                    errors.push(`meta.dashboard.labels.${group} is not a known group`);
                    continue;
                }
                if (!isMap(map)) {
                    errors.push(`meta.dashboard.labels.${group} must be an object`);
                    continue;
                }
                for (const [id, label] of Object.entries(map)) {
                    if (typeof label !== 'string' || !label.trim() || label.length > MAX_LABEL) {
                        errors.push(`meta.dashboard.labels.${group}.${id} must be a non-empty string up to ${MAX_LABEL} characters`);
                    } else if (!exists(setFor[group], id)) {
                        errors.push(`meta.dashboard.labels.${group}.${id} names nothing in this game`);
                    } else {
                        out.labels[group][id] = label.trim();
                    }
                }
            }
        }
    }

    if (raw.milestones != null) {
        if (!Array.isArray(raw.milestones)) errors.push('meta.dashboard.milestones must be a list');
        else {
            const seen = new Set();
            raw.milestones.forEach((m, i) => {
                const at = `meta.dashboard.milestones[${i}]`;
                if (!isMap(m)) return errors.push(`${at} must be an object`);
                if (typeof m.id !== 'string' || !MILESTONE_ID.test(m.id)) return errors.push(`${at}.id is missing or not a plain id`);
                if (seen.has(m.id)) return errors.push(`${at}.id "${m.id}" is declared twice`);
                if (typeof m.label !== 'string' || !m.label.trim() || m.label.length > MAX_LABEL) {
                    return errors.push(`${at}.label must be a non-empty string up to ${MAX_LABEL} characters`);
                }
                const sources = MILESTONE_SOURCES.filter(s => m[s] != null);
                if (sources.length !== 1) return errors.push(`${at} needs exactly one of ${MILESTONE_SOURCES.join(', ')}`);
                const type = sources[0];
                const ref = m[type];
                if (typeof ref !== 'string' || !ref) return errors.push(`${at}.${type} must be an id`);
                const set = {flag: known.flags, scene: known.scenes, task: known.tasks, dialog: known.dialogs}[type];
                if (!exists(set, ref)) return errors.push(`${at}.${type} "${ref}" names nothing in this game`);
                const extras = Object.keys(m).filter(k => !['id', 'label', type].includes(k));
                if (extras.length) return errors.push(`${at}.${extras[0]} is not a known field`);
                seen.add(m.id);
                out.milestones.push(Object.freeze({id: m.id, label: m.label.trim(), type, ref}));
            });
        }
    }

    if (raw.show != null) {
        if (!isMap(raw.show)) errors.push('meta.dashboard.show must be an object');
        else {
            for (const [k, v] of Object.entries(raw.show)) {
                if (!SHOW_KEYS.includes(k)) errors.push(`meta.dashboard.show.${k} is not a known switch`);
                else if (typeof v !== 'boolean') errors.push(`meta.dashboard.show.${k} must be true or false`);
                else out.show[k] = v;
            }
        }
    }

    return {dashboard: out, errors};
}

/**
 * Build the catalogue of one game.
 *
 * @param {object} scenesDoc          scenes.json as parsed
 * @param {object|null} puzzlesSource puzzles in any supported shape, or null if not loaded yet.
 *                                    Puzzles defined inside scenes.json are used when this is null.
 * @param {object} [opts]
 * @param {object|null} [opts.dialogsDoc] dialogs.json, for checking dialog milestones
 * @param {(value: any) => string} [opts.text] resolves a text value; the engine passes its own
 */
export function buildCatalogue(scenesDoc, puzzlesSource = null, opts = {}) {
    const text = opts.text || plainText;
    const doc = scenesDoc || {};
    const meta = isMap(doc.meta) ? doc.meta : {};

    const inlinePuzzles = isMap(doc.puzzles) || Array.isArray(doc.puzzles) ? puzzleMap(doc.puzzles) : null;
    const puzzles = puzzleMap(puzzlesSource) || inlinePuzzles;
    const ready = !!puzzles;

    const sceneList = (doc.scenes || []).filter(s => typeof s?.id === 'string');
    const itemList = (doc.items || []).filter(i => typeof i?.id === 'string');
    const tasksRaw = ready ? reachableTasks(doc, puzzles) : null;
    const dialogList = Array.isArray(opts.dialogsDoc?.dialogs) ? opts.dialogsDoc.dialogs : null;

    const {dashboard, errors} = validateDashboardMeta(meta.dashboard, {
        scenes: new Set(sceneList.map(s => s.id)),
        items: new Set(itemList.map(i => i.id)),
        tasks: tasksRaw ? new Set(tasksRaw.map(t => t.id)) : null,
        // Without the dialogs a flag may be set by one we have not seen, so
        // neither dialogs nor flags can be checked yet: accepted until they can.
        dialogs: dialogList ? new Set(dialogList.map(d => d?.id).filter(Boolean)) : null,
        flags: opts.dialogsDoc ? collectFlags(doc, opts.dialogsDoc) : null,
    });

    const label = (group, id, fallback) => dashboard.labels[group][id] || text(fallback) || id;

    const scenes = sceneList.map(s => Object.freeze({id: s.id, label: label('scenes', s.id, s.title), end: !!s.end}));
    const items = itemList.map(i => Object.freeze({id: i.id, label: label('items', i.id, i.label)}));
    const tasks = tasksRaw
        ? tasksRaw.map(t => Object.freeze({
            id: t.id,
            label: label('tasks', t.id, t.cfg.title || t.cfg.prompt),
            kind: t.kind,
            parent: t.parent,
        }))
        : null;

    const show = {
        items: dashboard.show.items ?? items.length > 0,
        milestones: dashboard.show.milestones ?? dashboard.milestones.length > 0,
    };

    return Object.freeze({
        game: typeof meta.id === 'string' ? meta.id : null,
        version: meta.version != null ? String(meta.version) : null,
        ready,
        scenes: Object.freeze(scenes),
        tasks: tasks ? Object.freeze(tasks) : null,
        items: Object.freeze(items),
        milestones: Object.freeze(dashboard.milestones),
        show: Object.freeze(show),
        totals: Object.freeze({scenes: scenes.length, tasks: tasks ? tasks.length : null}),
        errors: Object.freeze(errors),
    });
}
