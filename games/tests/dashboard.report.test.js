// EI-010: the public contract, the projection that fills it, and the rule the
// whole item exists for - the internal state never reaches the wire.
//
// The no-leak tests inspect the actual serialised body, recursively, not the
// report's top-level keys. That is the test that would have caught the design
// the owner rejected ("ship the saved state unchanged").

import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {project} from '../../engine/dashboard/projector.js';
import {
    toWire, checkReport, wireBytes, REPORT_SCHEMA, DASHBOARD_API_VERSION, WIRE_TARGET_BYTES, WIRE_MAX_BYTES,
} from '../../engine/dashboard/report.js';
import {buildCatalogue} from '../../engine/dashboard/catalogue.js';
import {ENGINE_API_VERSION} from '../../engine/version.js';

const catalogue = buildCatalogue({
    meta: {id: 'g', dashboard: {milestones: [
        {id: 'door', label: 'Dveře', flag: 'door_open'},
        {id: 'lab', label: 'Laboratoř', scene: 'lab'},
        {id: 'riddle', label: 'Hádanka', task: 'riddle'},
        {id: 'met', label: 'Setkání', dialog: 'intro'},
    ]}},
    items: [{id: 'key', label: 'Klíč'}, {id: 'lamp', label: 'Lampa'}],
    scenes: [
        {id: 'hall', title: 'Chodba', hotspots: [
            {type: 'puzzle', puzzleRef: 'riddle', onSuccess: {setFlags: ['door_open']}},
            {type: 'puzzle', puzzleRef: 'series'},
        ]},
        {id: 'lab', title: 'Laboratoř'},
        {id: 'exit', title: 'Východ', end: true},
    ],
}, {
    riddle: {kind: 'phrase', title: 'Hádanka'},
    series: {kind: 'list', steps: [{config: {kind: 'quiz', title: 'Otázka 1'}}, {config: {kind: 'quiz'}}]},
}, {dialogsDoc: {dialogs: [{id: 'intro'}]}});

const SECRET = 'SECRET-DO-NOT-SHIP';

/** A state carrying every kind of internal thing that must never be shipped. */
const leakyState = () => ({
    stateSchemaVersion: 1,
    signature: `g|${SECRET}`,
    inventory: ['key'],
    solved: {'solved:pz:riddle': true, [`solved:pz:${SECRET}`]: true},
    flags: {door_open: true, [SECRET]: true},
    visited: {hall: true, lab: true},
    eventsFired: {[SECRET]: true},
    scene: 'lab',
    useItemId: 'key',
    hero: {id: SECRET, gender: 'n'},
    puzzleResults: [{ref: 'riddle', detail: {value: SECRET}}],
    contentShown: {[SECRET]: true},
    sceneImages: {lab: SECRET},
    engineVersion: SECRET,
});
const leakyProgress = (state) => ({
    run: 'run-1', revision: 3, seq: 4, startedAt: 1000, scene: 'lab', sceneEnteredAt: 5000, completedAt: null,
    sceneTime: {hall: 4000},
    puzzles: {
        riddle: {seq: 1, attempts: 3, mistakes: 2, solved: true, answer: SECRET},
        'series#0': {seq: 2, attempts: 1, mistakes: 1, solved: false},
        [SECRET]: {seq: 3, attempts: 1, mistakes: 0, solved: true},
    },
    itemsUsed: {lamp: 4},
    dialogsSeen: {intro: 2},
    backRef: state,             // a reference straight into the internal state
    secretField: SECRET,
});

const build = (overrides = {}) => {
    const state = leakyState();
    return project({
        state,
        progress: leakyProgress(state),
        activity: {ref: 'series#0', since: 6000},
        catalogue,
        identity: {game: 'g', gameVersion: '1.2.0', session: '7A', player: 'Anička', avatar: 'unicorn'},
        now: 9000,
        revision: 3,
        ...overrides,
    });
};

/** Every key and every string anywhere in a JSON value. */
const everything = (value, out = []) => {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach(v => everything(v, out));
    else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
            out.push(k);
            everything(v, out);
        }
    }
    return out;
};

describe('the contract version', () => {
    it('is the engine API version, and it is 2', () => {
        expect(DASHBOARD_API_VERSION).toBe(ENGINE_API_VERSION);
        expect(ENGINE_API_VERSION).toBe(2);
    });
});

describe('no leak: the internal state never reaches the wire', () => {
    it('the serialised body carries nothing internal, at any depth', () => {
        const body = JSON.stringify(toWire(build()));
        expect(body).not.toContain(SECRET);
        for (const internal of ['solved:pz:', 'eventsFired', 'flags', 'hero', 'signature', 'sceneImages',
            'puzzleResults', 'contentShown', 'useItemId', 'sceneTime', 'seq', 'secretField', 'backRef', 'answer',
            'door_open', 'stateSchemaVersion', 'engineVersion']) {
            expect(everything(JSON.parse(body))).not.toContain(internal);
        }
    });

    // Two walls, each tested on its own. Through both at once, removing either
    // one goes unnoticed: that is how the first version of these tests passed a
    // toWire() that had stopped allow-listing (found by mutation).
    it('wall 1 alone: the projector produces exactly the contract, before any serialisation', () => {
        expect(checkReport(build())).toEqual([]);
    });

    it('wall 2 alone: toWire strips anything outside the contract, at any depth', () => {
        const state = leakyState();
        const poisoned = {
            ...build(),
            flags: state.flags,
            hero: state.hero,
            backRef: state,
            position: {...build().position, secret: SECRET, nested: {deeper: SECRET}},
            activity: {ref: 'series#0', label: null, since: 1, answer: SECRET},
            progress: {...build().progress, solutions: [SECRET]},
            puzzles: [{ref: 'riddle', attempts: 1, mistakes: 0, solved: true, answer: SECRET, cfg: {solution: SECRET}}],
        };
        const wire = toWire(poisoned);
        expect(JSON.stringify(wire)).not.toContain(SECRET);
        expect(checkReport(wire)).toEqual([]);
    });

    it('the body is exactly the declared schema, keys and types, recursively', () => {
        const wire = toWire(build());
        expect(checkReport(wire)).toEqual([]);
    });

    it('checkReport refuses anything outside the contract', () => {
        const wire = toWire(build());
        const tampered = {...wire, flags: {}, position: {...wire.position, extra: 1}};
        const problems = checkReport(tampered);
        expect(problems).toContain('report.flags is not part of the contract');
        expect(problems).toContain('report.position.extra is not part of the contract');
    });

    it('the wire shares nothing with what it was built from', () => {
        const report = build();
        const wire = toWire(report);
        report.puzzles[0].mistakes = 99;
        report.inventory.push('stolen');
        report.position.scene = 'moved';
        expect(wire.puzzles[0].mistakes).toBe(2);
        expect(wire.inventory).toEqual(['key']);
        expect(wire.position.scene).toBe('lab');
    });

    it('coerces every field to its declared type', () => {
        const wire = toWire({api: '2', game: 7, revision: -4, completed: 'yes', inventory: [1, null], puzzles: [{ref: 3, attempts: 1.6}]});
        expect(wire.api).toBe(2);
        expect(wire.game).toBe('7');
        expect(wire.revision).toBe(0);
        expect(wire.completed).toBe(false);
        expect(wire.inventory).toEqual(['1', '']);
        expect(wire.puzzles[0]).toEqual({ref: '3', attempts: 2, mistakes: 0, solved: false});
        expect(checkReport(wire)).toEqual([]);
    });
});

describe('projection: what the report says', () => {
    it('identity, position and the open task, labelled from the catalogue', () => {
        const r = build();
        expect(r).toMatchObject({
            api: 2, game: 'g', gameVersion: '1.2.0', session: '7A', player: 'Anička', avatar: 'unicorn', run: 'run-1', revision: 3,
            startedAt: 1000, updatedAt: 9000, completedAt: null, completed: false,
            position: {scene: 'lab', label: 'Laboratoř', since: 5000},
            activity: {ref: 'series#0', label: 'Otázka 1', since: 6000},
        });
    });

    it('an avatar is an id from the shared catalogue, or nothing', () => {
        expect(build({identity: {game: 'g', avatar: 'fox'}}).avatar).toBe('fox');
        for (const avatar of ['dragon', '<img>', 42, null, undefined]) {
            expect(build({identity: {game: 'g', avatar}}).avatar, String(avatar)).toBeNull();
        }
    });

    it('counts only real tasks once the catalogue is known, and merges the engine own solved keys', () => {
        const r = build();
        expect(r.puzzles).toEqual([
            {ref: 'riddle', attempts: 3, mistakes: 2, solved: true},
            {ref: 'series#0', attempts: 1, mistakes: 1, solved: false},
        ]);
        expect(r.progress).toEqual({scenesVisited: 2, scenesTotal: 3, puzzlesSolved: 1, puzzlesTotal: 3});
    });

    it('reports a task solved before this layer existed (an upgraded save)', () => {
        const state = {...leakyState(), solved: {'solved:pz:riddle': true}};
        const r = project({
            state, progress: {run: 'r', puzzles: {}, itemsUsed: {}, dialogsSeen: {}},
            activity: null, catalogue, identity: {game: 'g'}, now: 1, revision: 1,
        });
        expect(r.puzzles).toEqual([{ref: 'riddle', attempts: 0, mistakes: 0, solved: true}]);
        expect(r.progress.puzzlesSolved).toBe(1);
    });

    it('says "unknown", never zero, while the catalogue is not loaded', () => {
        const notReady = buildCatalogue({meta: {id: 'g'}, scenes: [{id: 'hall'}]}, null);
        const r = build({catalogue: notReady});
        expect(r.progress.puzzlesTotal).toBeNull();
        expect(r.progress.scenesTotal).toBe(1);
        // Without the catalogue it cannot filter, so it keeps what it saw.
        expect(r.puzzles.map(p => p.ref)).toContain('riddle');
    });

    it('lists inventory, items used and dialogs seen in first-touch order', () => {
        const r = build();
        expect(r.inventory).toEqual(['key']);
        expect(r.itemsUsed).toEqual(['lamp']);
        expect(r.dialogsSeen).toEqual(['intro']);
    });

    it('reaches milestones of all four kinds, in declaration order, and only declared ones', () => {
        expect(build().milestones).toEqual(['door', 'lab', 'riddle', 'met']);
        const state = {...leakyState(), flags: {}, visited: {hall: true}};
        const r = project({
            state, progress: {run: 'r', puzzles: {}, itemsUsed: {}, dialogsSeen: {}},
            activity: null, catalogue, identity: {game: 'g'}, now: 1, revision: 1,
        });
        expect(r.milestones).toEqual(['riddle']); // only the engine's own solved key remains
    });

    it('marks a completed run', () => {
        const state = leakyState();
        const progress = {...leakyProgress(state), completedAt: 8000};
        const r = project({state, progress, activity: null, catalogue, identity: {game: 'g'}, now: 9000, revision: 4});
        expect(r.completed).toBe(true);
        expect(r.completedAt).toBe(8000);
        expect(r.activity).toBeNull();
    });
});

describe('size', () => {
    it('sheds per-puzzle detail, and says so, only if a report would exceed the ceiling', () => {
        const puzzles = Array.from({length: 500}, (_, i) => ({ref: `p${i}-${'x'.repeat(150)}`, attempts: 1, mistakes: 1, solved: false}));
        const wire = toWire({...build(), puzzles});
        expect(wireBytes(wire)).toBeLessThanOrEqual(WIRE_MAX_BYTES);
        expect(wire.truncated).toBe(true);
        expect(wire.progress.puzzlesTotal).toBe(3); // the counts still hold
    });

    it('stays under the ceiling even when the lists other than puzzles are what is large', () => {
        const long = (n) => Array.from({length: 500}, (_, i) => `${n}${i}-${'y'.repeat(180)}`);
        const wire = toWire({...build(), puzzles: [], inventory: long('i'), itemsUsed: long('u'), dialogsSeen: long('d'), milestones: long('m')});
        expect(wireBytes(wire)).toBeLessThanOrEqual(WIRE_MAX_BYTES);
        expect(wire.truncated).toBe(true);
        expect(checkReport(wire)).toEqual([]);
    });

    it('a finished run of every shipped demo task, all touched, stays under the target', () => {
        const read = (f) => JSON.parse(readFileSync(join(process.cwd(), 'games', 'demo', f), 'utf8'));
        const cat = buildCatalogue(read('scenes.json'), read('puzzles.json'), {dialogsDoc: read('dialogs.json')});
        const state = {
            inventory: cat.items.map(i => i.id), solved: {}, flags: {},
            visited: Object.fromEntries(cat.scenes.map(s => [s.id, true])), scene: cat.scenes.at(-1).id,
        };
        const progress = {
            run: 'r', startedAt: 1, sceneEnteredAt: 2, completedAt: 3, scene: state.scene,
            puzzles: Object.fromEntries(cat.tasks.map((t, i) => [t.id, {seq: i, attempts: 9, mistakes: 8, solved: true}])),
            itemsUsed: Object.fromEntries(cat.items.map((it, i) => [it.id, i])), dialogsSeen: {},
        };
        const wire = toWire(project({state, progress, activity: null, catalogue: cat, identity: {game: 'demo'}, now: 4, revision: 1}));
        expect(checkReport(wire)).toEqual([]);
        expect(wireBytes(wire)).toBeLessThan(WIRE_TARGET_BYTES);
    });

    it('the schema is the documented one (a change here is a contract change)', () => {
        expect(Object.keys(REPORT_SCHEMA.obj)).toEqual([
            'api', 'game', 'gameVersion', 'session', 'player', 'avatar', 'run', 'revision', 'startedAt', 'updatedAt',
            'completedAt', 'completed', 'position', 'activity', 'progress', 'inventory', 'itemsUsed',
            'dialogsSeen', 'puzzles', 'milestones', 'truncated',
        ]);
    });
});
