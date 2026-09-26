// EI-010: the dashboard catalogue and the signals seam.
//
// The catalogue is what every "solved of total" on the board stands on, so the
// task rules are pinned here one by one, and against the shipped demo game.

import {describe, it, expect, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {GameSignals, SIGNALS} from '../../engine/dashboard/signals.js';
import {
    buildCatalogue, reachableTasks, validateDashboardMeta, collectFlags, plainText,
} from '../../engine/dashboard/catalogue.js';

const read = (game, file) => {
    try {
        return JSON.parse(readFileSync(join(process.cwd(), 'games', game, file), 'utf8'));
    } catch {
        return null;
    }
};

describe('GameSignals', () => {
    it('reaches every subscriber of a signal, and * subscribers with the name', () => {
        const s = new GameSignals();
        const a = vi.fn();
        const b = vi.fn();
        const any = vi.fn();
        s.on(SIGNALS.ITEM_USED, a);
        s.on(SIGNALS.ITEM_USED, b);
        s.on('*', any);
        s.emit(SIGNALS.ITEM_USED, {id: 'key'});
        expect(a).toHaveBeenCalledWith({id: 'key'}, SIGNALS.ITEM_USED);
        expect(b).toHaveBeenCalledOnce();
        expect(any).toHaveBeenCalledWith({id: 'key'}, SIGNALS.ITEM_USED);
    });

    it('stops delivering after unsubscribe', () => {
        const s = new GameSignals();
        const fn = vi.fn();
        const off = s.on(SIGNALS.RUN_STARTED, fn);
        off();
        s.emit(SIGNALS.RUN_STARTED);
        expect(fn).not.toHaveBeenCalled();
    });

    it('a subscriber that throws stops neither the others nor the emitter', () => {
        const s = new GameSignals();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const after = vi.fn();
        s.on(SIGNALS.SCENE_ENTERED, () => { throw new Error('broken board'); });
        s.on(SIGNALS.SCENE_ENTERED, after);
        expect(() => s.emit(SIGNALS.SCENE_ENTERED, {scene: 'x'})).not.toThrow();
        expect(after).toHaveBeenCalledOnce();
        warn.mockRestore();
    });
});

describe('plainText and collectFlags', () => {
    it('resolves @key@fallback to the fallback and passes plain strings through', () => {
        expect(plainText('@scene.lab@Laboratoř')).toBe('Laboratoř');
        expect(plainText('Sklep')).toBe('Sklep');
        expect(plainText({key: 'k'})).toBe('k');
        expect(plainText(null)).toBe('');
    });

    it('finds every flag any action can set, in all three spellings', () => {
        const flags = collectFlags({
            a: {setFlags: 'one'},
            b: [{then: {setFlags: ['two', 3]}}],
            c: {deep: {onEnd: {setFlags: {three: true, four: false}}}},
        });
        expect([...flags].sort()).toEqual(['four', 'one', 'three', 'two']);
    });
});

describe('reachable tasks', () => {
    const doc = {
        scenes: [
            {id: 's1', hotspots: [
                {type: 'puzzle', puzzleRef: 'leaf-a'},
                {type: 'puzzle', puzzle: {ref: 'list-1'}},
                {type: 'goTo', target: 's2'},
            ]},
            {id: 's2', hotspots: [
                {type: 'puzzle', puzzleRef: 'leaf-b'},      // also a step of list-1
                {type: 'puzzle', puzzleRef: 'missing'},     // names nothing
            ]},
        ],
        events: [{id: 'e', then: {openPuzzle: {ref: 'from-event'}}}],
    };
    const puzzles = {
        'leaf-a': {kind: 'phrase', title: 'A'},
        'leaf-b': {kind: 'quiz', title: 'B'},
        'from-event': {kind: 'code'},
        'orphan': {kind: 'cloze'},
        'list-1': {kind: 'list', steps: [
            {ref: 'leaf-b'},
            {config: {kind: 'quiz', title: 'Inline'}},
            {config: {kind: 'list', steps: [{config: {kind: 'order'}}]}},
        ]},
        'loop': {kind: 'list', steps: [{ref: 'loop'}]},
    };

    it('counts leaves reached from hotspots, events and list steps, once each, in reach order', () => {
        const ids = reachableTasks(doc, puzzles).map(t => t.id);
        expect(ids).toEqual(['leaf-a', 'leaf-b', 'list-1#1', 'list-1#2#0', 'from-event']);
    });

    it('never counts a list container, an unreachable puzzle or a reference to nothing', () => {
        const ids = reachableTasks(doc, puzzles).map(t => t.id);
        expect(ids).not.toContain('list-1');
        expect(ids).not.toContain('orphan');
        expect(ids).not.toContain('missing');
    });

    it('an event whose then is a list is never executed, so its puzzle is not reachable', () => {
        const d = {scenes: [], events: [{id: 'e', then: [{openPuzzle: {ref: 'leaf-a'}}]}]};
        expect(reachableTasks(d, puzzles)).toEqual([]);
    });

    it('survives a list that contains itself', () => {
        const d = {scenes: [{id: 's', hotspots: [{type: 'puzzle', puzzleRef: 'loop'}]}]};
        expect(reachableTasks(d, puzzles)).toEqual([]);
    });

    it('records the parent of a list step', () => {
        const byId = Object.fromEntries(reachableTasks(doc, puzzles).map(t => [t.id, t]));
        expect(byId['list-1#1'].parent).toBe('list-1');
        expect(byId['leaf-a'].parent).toBeNull();
    });
});

describe('buildCatalogue', () => {
    const doc = {
        meta: {id: 'g', version: '2.0.0', dashboard: {
            labels: {scenes: {s2: 'Druhá místnost'}, tasks: {'leaf-a': 'Heslo'}},
            milestones: [
                {id: 'door', label: 'Dveře otevřeny', flag: 'door_open'},
                {id: 'lab', label: 'V laboratoři', scene: 's2'},
            ],
        }},
        items: [{id: 'key', label: '@item.key@Klíč'}],
        scenes: [
            {id: 's1', title: '@s1@Chodba', hotspots: [{type: 'puzzle', puzzleRef: 'leaf-a', onSuccess: {setFlags: ['door_open']}}]},
            {id: 's2', title: 'Lab', end: true},
        ],
    };

    it('is not ready, with unknown task totals, until the puzzles are known', () => {
        const c = buildCatalogue(doc, null);
        expect(c.ready).toBe(false);
        expect(c.tasks).toBeNull();
        expect(c.totals).toEqual({scenes: 2, tasks: null});
    });

    it('uses puzzles defined inside scenes.json when there is no puzzles.json', () => {
        const c = buildCatalogue({...doc, puzzles: {'leaf-a': {kind: 'phrase'}}}, null);
        expect(c.ready).toBe(true);
        expect(c.totals.tasks).toBe(1);
    });

    it('labels from meta.dashboard first, then the game text, then the id', () => {
        const c = buildCatalogue(doc, {'leaf-a': {kind: 'phrase', title: 'Hádanka'}});
        expect(c.scenes).toEqual([
            {id: 's1', label: 'Chodba', end: false},
            {id: 's2', label: 'Druhá místnost', end: true},
        ]);
        expect(c.tasks[0].label).toBe('Heslo');
        expect(c.items).toEqual([{id: 'key', label: 'Klíč'}]);
    });

    it('uses the engine text resolver when given one', () => {
        const c = buildCatalogue(doc, {}, {text: (v) => `T(${plainText(v)})`});
        expect(c.scenes[0].label).toBe('T(Chodba)');
    });

    it('carries declared milestones and switches the sections on by what exists', () => {
        const c = buildCatalogue(doc, {'leaf-a': {kind: 'phrase'}});
        expect(c.milestones.map(m => [m.id, m.type, m.ref])).toEqual([['door', 'flag', 'door_open'], ['lab', 'scene', 's2']]);
        expect(c.show).toEqual({items: true, milestones: true});
        expect(c.errors).toEqual([]);
        expect(Object.isFrozen(c)).toBe(true);
    });

    it('lets a game switch a section off explicitly', () => {
        const d = {...doc, meta: {...doc.meta, dashboard: {show: {items: false}}}};
        expect(buildCatalogue(d, {}).show).toEqual({items: false, milestones: false});
    });
});

describe('validateDashboardMeta', () => {
    const known = {
        scenes: new Set(['s1']), tasks: new Set(['t1']), items: new Set(['i1']),
        dialogs: new Set(['d1']), flags: new Set(['f1']),
    };

    it('accepts every milestone source', () => {
        const {dashboard, errors} = validateDashboardMeta({milestones: [
            {id: 'a', label: 'A', flag: 'f1'},
            {id: 'b', label: 'B', scene: 's1'},
            {id: 'c', label: 'C', task: 't1'},
            {id: 'd', label: 'D', dialog: 'd1'},
        ]}, known);
        expect(errors).toEqual([]);
        expect(dashboard.milestones.map(m => m.type)).toEqual(['flag', 'scene', 'task', 'dialog']);
    });

    it.each([
        [{milestones: [{id: 'a', label: 'A'}]}, /exactly one of/],
        [{milestones: [{id: 'a', label: 'A', flag: 'f1', scene: 's1'}]}, /exactly one of/],
        [{milestones: [{id: 'a', label: 'A', flag: 'nope'}]}, /names nothing/],
        [{milestones: [{id: 'a b', label: 'A', flag: 'f1'}]}, /plain id/],
        [{milestones: [{id: 'a', label: '', flag: 'f1'}]}, /label/],
        [{milestones: [{id: 'a', label: 'A', flag: 'f1'}, {id: 'a', label: 'B', scene: 's1'}]}, /declared twice/],
        [{milestones: [{id: 'a', label: 'A', flag: 'f1', colour: 'red'}]}, /not a known field/],
        [{labels: {scenes: {nope: 'X'}}}, /names nothing/],
        [{labels: {rooms: {}}}, /not a known group/],
        [{show: {grid: true}}, /not a known switch/],
        [{show: {items: 'yes'}}, /true or false/],
        [{colour: 'red'}, /not a known setting/],
        ['everything', /must be an object/],
    ])('refuses %j', (raw, pattern) => {
        const {errors} = validateDashboardMeta(raw, known);
        expect(errors.join('\n')).toMatch(pattern);
    });

    it('drops a milestone with an unknown field entirely, not just reports it', () => {
        const {dashboard, errors} = validateDashboardMeta({milestones: [{id: 'm', label: 'M', flag: 'f1', colour: 'red'}]}, known);
        expect(errors).toHaveLength(1);
        expect(dashboard.milestones).toEqual([]);
    });

    it('without the dialogs, a flag or dialog it cannot see yet is accepted, not refused', () => {
        const c = buildCatalogue({meta: {id: 'g', dashboard: {milestones: [
            {id: 'a', label: 'A', flag: 'set_in_a_dialog'}, {id: 'b', label: 'B', dialog: 'intro'},
        ]}}, scenes: [{id: 's'}]}, {});
        expect(c.milestones.map(m => m.id)).toEqual(['a', 'b']);
        const withDialogs = buildCatalogue({meta: {id: 'g', dashboard: {milestones: [{id: 'a', label: 'A', flag: 'nope'}]}}, scenes: [{id: 's'}]}, {}, {dialogsDoc: {dialogs: []}});
        expect(withDialogs.milestones).toEqual([]);
    });

    it('keeps the valid entries when some are not', () => {
        const {dashboard} = validateDashboardMeta({milestones: [
            {id: 'good', label: 'Good', flag: 'f1'},
            {id: 'bad', label: 'Bad', flag: 'nope'},
        ]}, known);
        expect(dashboard.milestones.map(m => m.id)).toEqual(['good']);
    });

    it('accepts a reference it cannot check yet (catalogue not loaded)', () => {
        const {errors} = validateDashboardMeta({milestones: [{id: 'x', label: 'X', task: 'later'}]}, {...known, tasks: null});
        expect(errors).toEqual([]);
    });
});

describe('the shipped demo game', () => {
    // Measured, not assumed. A list container is not a task and a list step
    // that is also a hotspot counts once, so the demo (the old leeuwenhoek)
    // has 9 tasks: 10 reachable puzzles, one of which is list-lab-demo, whose
    // five steps are also hotspots. EI-010-EVIDENCE said 10 because it counted
    // the container; this test is what keeps that number honest.
    it('has 22 scenes and 9 reachable tasks, with the showcase clozes excluded', () => {
        const c = buildCatalogue(read('demo', 'scenes.json'), read('demo', 'puzzles.json'), {dialogsDoc: read('demo', 'dialogs.json')});
        expect(c.totals).toEqual({scenes: 22, tasks: 9});
        expect(c.tasks.map(t => t.id)).not.toContain('list-lab-demo');
        expect(c.tasks.some(t => t.id.startsWith('cloze-capital'))).toBe(false);
        expect(c.errors).toEqual([]);
    });
});
