// EI-010: every built-in puzzle kind, through the real runner, against the
// evaluation contract. The dashboard's mistake counter is only as good as the
// status each kind reports, so each kind is pinned here on its own: removing a
// `status: 'wrong'` from any kind, or counting an empty submission, fails this.
//
// Internal state is set directly (the maps each kind keeps) rather than by
// simulating drags and line-drawing; what is under test is what onOk reports,
// not the kind's input handling, which has its own tests.

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {createPuzzleRunner} from '../../engine/puzzles/index.js';
import {GameSignals, SIGNALS} from '../../engine/dashboard/signals.js';

let engine;
let events;

beforeEach(() => {
    document.body.innerHTML = '<div id="hotspotLayer"></div>';
    const signals = new GameSignals();
    events = [];
    signals.on('*', (payload, name) => {
        if (name === SIGNALS.PUZZLE_EVALUATED || name === SIGNALS.PUZZLE_SOLVED) events.push([name, payload.ok]);
    });
    engine = {
        signals,
        i18n: {engine: {}, game: {}},
        _t: (key, def) => def || key,
        _resolveAsset: (p) => p,
        toast: () => {},
        hotspotLayer: document.getElementById('hotspotLayer'),
        modalRoot: null,
        data: {puzzles: {}},
    };
});
afterEach(() => {
    document.body.innerHTML = '';
});

const flush = () => new Promise(r => setTimeout(r, 0));
const counted = () => events.filter(([n]) => n === SIGNALS.PUZZLE_EVALUATED).map(([, ok]) => ok);
const solved = () => events.filter(([n]) => n === SIGNALS.PUZZLE_SOLVED).length;

const pairs = (p, list) => {
    p._pairs.clear();
    for (const [a, b] of list) { p._pairs.set(a, b); p._pairs.set(b, a); }
};

/**
 * For each kind: a config, and how to put the puzzle into each answer state.
 * `partial` is an answer begun but not finished; kinds without one (phrase,
 * code, a quiz that does not say how many to pick) have `partial` absent.
 */
const KINDS = {
    phrase: {
        config: {kind: 'phrase', solution: 'ano'},
        untouched: (p) => { p._els.input.value = ''; },
        wrong: (p) => { p._els.input.value = 'ne'; },
        wrong2: (p) => { p._els.input.value = 'nevím'; },
        correct: (p) => { p._els.input.value = 'ano'; },
        locked: null,
    },
    code: {
        config: {kind: 'code', solution: '1234'},
        untouched: (p) => { p._els.input.value = ''; },
        wrong: (p) => { p._els.input.value = '9999'; },
        wrong2: (p) => { p._els.input.value = '0000'; },
        correct: (p) => { p._els.input.value = '1234'; },
        locked: (p) => { p._els.input.value = '1234'; p._locked = true; },
    },
    quiz: {
        config: {kind: 'quiz', tokens: [{id: 'a', text: 'A'}, {id: 'b', text: 'B'}], solutionIds: ['a']},
        untouched: (p) => { p._selected.clear(); },
        wrong: (p) => { p._selected.clear(); p._selected.add('b'); },
        wrong2: (p) => { p._selected.clear(); p._selected.add('a'); p._selected.add('b'); },
        correct: (p) => { p._selected.clear(); p._selected.add('a'); },
        locked: (p) => { p._selected.add('a'); p._locked = true; },
    },
    choice: {
        config: {kind: 'choice', tokens: [
            {id: 'q1', text: 'Otázka?', choices: [{value: 'Ano', label: 'Ano'}, {value: 'Ne', label: 'Ne'}, {value: 'Možná', label: 'Možná'}], solution: 'Ano'},
            {id: 'q2', text: 'Druhá?', choices: [{value: 'Ano', label: 'Ano'}, {value: 'Ne', label: 'Ne'}], solution: 'Ne'},
        ]},
        untouched: (p) => { p._valueMap.clear(); },
        partial: (p) => { p._valueMap.clear(); p._valueMap.set('q1', 'Ne'); },
        wrong: (p) => { p._valueMap.set('q1', 'Ne'); p._valueMap.set('q2', 'Ne'); },
        wrong2: (p) => { p._valueMap.set('q1', 'Možná'); p._valueMap.set('q2', 'Ne'); },
        correct: (p) => { p._valueMap.set('q1', 'Ano'); p._valueMap.set('q2', 'Ne'); },
        locked: null,
    },
    cloze: {
        config: {kind: 'cloze', text: 'Ahoj {gap1}, ty {gap2}', tokens: [{id: 't1', text: 'světe'}, {id: 't2', text: 'měsíci'}, {id: 't3', text: 'slunce'}, {id: 't4', text: 'krásný'}], solution: {gap1: 't1', gap2: 't4'}},
        untouched: (p) => { p._placements.clear(); },
        partial: (p) => { p._placements.clear(); p._placements.set('gap1', 't2'); },
        wrong: (p) => { p._placements.set('gap1', 't2'); p._placements.set('gap2', 't4'); },
        wrong2: (p) => { p._placements.set('gap1', 't3'); p._placements.set('gap2', 't4'); },
        correct: (p) => { p._placements.set('gap1', 't1'); p._placements.set('gap2', 't4'); },
        locked: null,
    },
    group: {
        config: {kind: 'group', groups: [{id: 'a', label: 'A'}, {id: 'b', label: 'B'}], tokens: [{id: '1', text: 'Jedna'}, {id: '2', text: 'Dva'}], solutions: {1: 'a', 2: 'a'}},
        untouched: (p) => { p._inGroup.clear(); },
        partial: (p) => { p._inGroup.clear(); p._inGroup.set('1', 'b'); },
        wrong: (p) => { p._inGroup.clear(); p._inGroup.set('1', 'b'); p._inGroup.set('2', 'a'); },
        wrong2: (p) => { p._inGroup.clear(); p._inGroup.set('1', 'b'); p._inGroup.set('2', 'b'); },
        correct: (p) => { p._inGroup.clear(); p._inGroup.set('1', 'a'); p._inGroup.set('2', 'a'); },
        locked: null,
    },
    match: {
        config: {kind: 'match', mode: 'columns', tokens: [
            {id: 'a', text: 'A', side: 'left'}, {id: 'b', text: 'B', side: 'right'},
            {id: 'c', text: 'C', side: 'left'}, {id: 'd', text: 'D', side: 'right'},
            {id: 'e', text: 'E', side: 'left'}, {id: 'f', text: 'F', side: 'right'},
        ], pairs: [['a', 'b'], ['c', 'd'], ['e', 'f']]},
        untouched: (p) => { p._pairs.clear(); },
        partial: (p) => { pairs(p, [['a', 'd']]); },
        wrong: (p) => { pairs(p, [['a', 'd'], ['c', 'b'], ['e', 'f']]); },
        wrong2: (p) => { pairs(p, [['a', 'f'], ['c', 'd'], ['e', 'b']]); },
        correct: (p) => { pairs(p, [['a', 'b'], ['c', 'd'], ['e', 'f']]); },
        locked: null,
    },
    order: {
        config: {kind: 'order', tokens: [{id: 'x', text: 'X'}, {id: 'y', text: 'Y'}, {id: 'z', text: 'Z'}], solution: ['x', 'y', 'z']},
        untouched: (p) => { p._ordered = []; },
        partial: (p) => { p._ordered = ['x', 'y']; },
        wrong: (p) => { p._ordered = ['y', 'x', 'z']; },
        wrong2: (p) => { p._ordered = ['z', 'y', 'x']; },
        correct: (p) => { p._ordered = ['x', 'y', 'z']; },
        locked: null,
    },
};

function run(kind, {blockUntilSolved, showErrorToast = false}) {
    const resolved = [];
    const runner = createPuzzleRunner({
        ref: `pz-${kind}`,
        config: {id: `pz-${kind}`, ...KINDS[kind].config},
        engine,
        instanceOptions: {blockUntilSolved, showErrorToast},
        onResolve: (r) => resolved.push(r.ok),
    });
    runner.mountInto(engine.hotspotLayer);
    const container = engine.hotspotLayer.querySelector('.pz-container');
    const press = async (state) => {
        if (state) KINDS[kind][state](runner.puzzle);
        await runner.puzzle.onOk();
        await flush();
    };
    const change = () => container.dispatchEvent(new Event('input', {bubbles: true}));
    return {runner, resolved, press, change};
}

describe.each(Object.keys(KINDS))('%s', (kind) => {
    const spec = KINDS[kind];

    it.runIf(!!spec.partial)('a partly answered submission is not an answer yet: nothing counted, no marks, stays open', async () => {
        const toasts = [];
        engine.toast = (msg) => toasts.push(msg);
        const {press, resolved} = run(kind, {blockUntilSolved: false, showErrorToast: true});
        await press('partial');
        expect(counted()).toEqual([]);
        expect(resolved).toEqual([]);
        expect(engine.hotspotLayer.querySelector('.is-wrong, .is-correct, .wrong, .correct')).toBeNull();
        expect(toasts).toEqual(['Nejdřív dokonči všechny odpovědi.']);  // a hint, not a verdict
    });

    it.runIf(!!spec.untouched)('an untouched submission is not an answer: nothing counted, puzzle stays open', async () => {
        const {press, resolved} = run(kind, {blockUntilSolved: false});
        await press('untouched');
        expect(counted()).toEqual([]);
        expect(resolved).toEqual([]);
    });

    it('a held wrong answer is one mistake; the same answer again is not another; a different one is', async () => {
        const {press, resolved} = run(kind, {blockUntilSolved: true});
        await press('wrong');
        expect(counted()).toEqual([false]);
        expect(resolved).toEqual([]);                 // held open
        await press('wrong');                          // pressed again, nothing changed
        expect(counted()).toEqual([false]);
        await press('wrong2');                         // a different wrong answer
        expect(counted()).toEqual([false, false]);
        await press('wrong');                          // back to the first: different from the last
        expect(counted()).toEqual([false, false, false]);
    });

    it('interacting without changing the answer is not a new attempt', async () => {
        const {press, change} = run(kind, {blockUntilSolved: true});
        await press('wrong');
        change();                                      // tapped around, typed and deleted...
        await press('wrong');                          // ...and submitted the same answer
        expect(counted()).toEqual([false]);
    });

    it('a quick correction right after a wrong answer is never swallowed', async () => {
        const {press, resolved} = run(kind, {blockUntilSolved: true});
        await press('wrong');
        await press('correct');                        // no pause, no change event
        expect(counted()).toEqual([false, true]);
        expect(solved()).toBe(1);
        expect(resolved).toEqual([true]);
    });

    it('a wrong answer on a puzzle that does not hold is a mistake and closes it unsolved', async () => {
        const {press, resolved} = run(kind, {blockUntilSolved: false});
        await press('wrong');
        expect(counted()).toEqual([false]);
        expect(solved()).toBe(0);
        expect(resolved).toEqual([false]);
    });

    it('a correct answer is counted and solves it', async () => {
        const {press, resolved} = run(kind, {blockUntilSolved: true});
        await press('correct');
        expect(counted()).toEqual([true]);
        expect(solved()).toBe(1);
        expect(resolved).toEqual([true]);
    });

    it.runIf(!!spec.locked)('a press refused by the lock is not an answer', async () => {
        const {press, resolved} = run(kind, {blockUntilSolved: true});
        await press('locked');
        expect(counted()).toEqual([]);
        expect(resolved).toEqual([]);
    });
});

describe('what SOL found in the incomplete rules', () => {
    it('order: a distractor placed instead of a missing token is still unfinished', async () => {
        const runner = createPuzzleRunner({
            ref: 'pz-o', config: {id: 'pz-o', kind: 'order', tokens: [{id: 'a'}, {id: 'b'}, {id: 'x'}], solution: ['a', 'b']},
            engine, instanceOptions: {blockUntilSolved: true, showErrorToast: false}, onResolve: () => {},
        });
        runner.mountInto(engine.hotspotLayer);
        runner.puzzle._ordered = ['a', 'x'];
        await runner.puzzle.onOk(); await flush();
        expect(counted()).toEqual([]);
    });

    it('match: the solutions {a: b} spelling is understood like pairs', async () => {
        const resolved = [];
        const runner = createPuzzleRunner({
            ref: 'pz-m', config: {id: 'pz-m', kind: 'match', mode: 'columns', solutions: {a: 'b'},
                tokens: [{id: 'a', text: 'A', side: 'left'}, {id: 'b', text: 'B', side: 'right'}]},
            engine, instanceOptions: {blockUntilSolved: true, showErrorToast: false}, onResolve: (r) => resolved.push(r.ok),
        });
        runner.mountInto(engine.hotspotLayer);
        pairs(runner.puzzle, [['a', 'b']]);
        await runner.puzzle.onOk(); await flush();
        expect(resolved).toEqual([true]);
    });

    it('the unfinished hint follows the puzzle own showErrorToast option', async () => {
        const toasts = [];
        engine.toast = (m) => toasts.push(m);
        const runner = createPuzzleRunner({
            ref: 'pz-p', config: {id: 'pz-p', kind: 'phrase', solution: 'ano', options: {showErrorToast: false}},
            engine, instanceOptions: {}, onResolve: () => {},
        });
        runner.mountInto(engine.hotspotLayer);
        runner.puzzle._els.input.value = '';
        await runner.puzzle.onOk(); await flush();
        expect(toasts).toEqual([]);
    });
});

describe('match answers', () => {
    it('two different pairings never look like the same answer, whatever the ids contain', async () => {
        const runner = createPuzzleRunner({
            ref: 'pz-match-ids',
            config: {id: 'pz-match-ids', kind: 'match', mode: 'columns', pairs: [['ok', 'x']], tokens: [
                {id: 'ok', text: 'OK', side: 'left'}, {id: 'x', text: 'X', side: 'right'},
                {id: 'a|b', text: 'A|B', side: 'left'}, {id: 'c', text: 'C', side: 'right'},
                {id: 'a', text: 'A', side: 'left'}, {id: 'b|c', text: 'B|C', side: 'right'},
            ]},
            engine,
            instanceOptions: {blockUntilSolved: true, showErrorToast: false},
            onResolve: () => {},
        });
        runner.mountInto(engine.hotspotLayer);
        // 'ok' has to be paired for the answer to be complete; the rest carry the tricky ids.
        const pair = (a, b) => pairs(runner.puzzle, [['ok', 'x'], [a, b]]);
        pair('a|b', 'c');                               // joined with '|': "a|b|c"
        await runner.puzzle.onOk(); await flush();
        pair('a', 'b|c');                               // joined with '|': also "a|b|c"
        await runner.puzzle.onOk(); await flush();
        expect(counted()).toEqual([false, false]);
    });
});

describe('list', () => {
    it('the container itself is never evaluated or solved; its steps are, under <list>#<index>', async () => {
        const opened = [];
        engine.signals.on(SIGNALS.PUZZLE_OPENED, ({ref}) => opened.push(ref));
        const runner = createPuzzleRunner({
            ref: 'series',
            config: {id: 'series', kind: 'list', summary: {show: false}, steps: [
                {config: {kind: 'phrase', solution: 'ano'}},
            ]},
            engine,
            instanceOptions: {blockUntilSolved: true},
            onResolve: () => {},
        });
        runner.mountInto(engine.hotspotLayer);
        expect(opened).toEqual(['series#0']);
        const step = engine.hotspotLayer.querySelectorAll('.pz-container')[1];
        step.querySelector('.pz-input').value = 'ano';
        step.querySelector('.pz-btn--ok').click();
        await flush();
        await flush();
        expect(counted()).toEqual([true]);
        expect(events.filter(([n]) => n === SIGNALS.PUZZLE_SOLVED)).toHaveLength(1);
    });
});

describe('group: where the unsorted tokens start', () => {
    const mount = (groups, n, layout = undefined) => {
        engine.hotspotLayer.innerHTML = '';
        const runner = createPuzzleRunner({
            ref: 'spread',
            config: {id: 'spread', kind: 'group', groups, layout,
                tokens: Array.from({length: n}, (_, i) => ({id: `t${i}`, text: `Token ${i}`})), solutions: {}},
            engine,
            instanceOptions: {},
            onResolve: () => {},
        });
        runner.mountInto(engine.hotspotLayer);
        return [...engine.hotspotLayer.querySelectorAll('.pz-kind-group .pz-token')]
            .map(el => ({left: parseFloat(el.style.left), top: parseFloat(el.style.top)}));
    };

    it('groups side by side: the tokens line up down the middle, apart and on the board', () => {
        // One spot for all of them hid every label but the top one (Volta, eight tokens).
        const pos = mount([{id: 'a', label: 'A'}, {id: 'b', label: 'B'}], 8);
        expect(pos.every(p => p.left === 50)).toBe(true);
        const tops = pos.map(p => p.top);
        expect(new Set(tops).size).toBe(8);
        expect(Math.min(...tops)).toBeGreaterThanOrEqual(15);
        expect(Math.max(...tops)).toBeLessThanOrEqual(90);
        // ...and no closer than the height of a token on a small board.
        const gaps = tops.slice(1).map((t, i) => t - tops[i]);
        expect(Math.min(...gaps)).toBeGreaterThanOrEqual(10);
    });

    it('groups stacked: across the middle; a single token sits in the centre', () => {
        const stacked = mount([{id: 'a'}, {id: 'b'}, {id: 'c'}], 4, {direction: 'horizontal'});
        expect(stacked.every(p => p.top === 50)).toBe(true);
        const lefts = stacked.map(p => p.left);
        expect(new Set(lefts).size).toBe(4);
        expect(Math.min(...lefts)).toBeGreaterThanOrEqual(10);
        expect(Math.max(...lefts)).toBeLessThanOrEqual(90);
        expect(mount([{id: 'a'}, {id: 'b'}], 1)).toEqual([{left: 50, top: 53}]);
    });

    it('a manual layout keeps the tokens in the centre, since only the author knows where the free space is', () => {
        const groups = [{id: 'a', rect: {x: 0, y: 0, w: 100, h: 40}}, {id: 'b', rect: {x: 0, y: 60, w: 100, h: 40}}];
        expect(mount(groups, 3, {mode: 'manual'})).toEqual([{left: 50, top: 50}, {left: 50, top: 50}, {left: 50, top: 50}]);
    });
});
