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

/**
 * For each kind: a config, and how to put the puzzle into each answer state.
 * `untouched: null` means the kind has no "nothing answered" state (order: the
 * starting arrangement is itself an answer).
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
        config: {kind: 'choice', tokens: [{id: 'q1', text: 'Otázka?', choices: [{value: 'Ano', label: 'Ano'}, {value: 'Ne', label: 'Ne'}, {value: 'Možná', label: 'Možná'}], solution: 'Ano'}]},
        untouched: (p) => { p._valueMap.clear(); },
        wrong: (p) => { p._valueMap.set('q1', 'Ne'); },
        wrong2: (p) => { p._valueMap.set('q1', 'Možná'); },
        correct: (p) => { p._valueMap.set('q1', 'Ano'); },
        locked: null,
    },
    cloze: {
        config: {kind: 'cloze', text: 'Ahoj {gap1}', tokens: [{id: 't1', text: 'světe'}, {id: 't2', text: 'měsíci'}, {id: 't3', text: 'slunce'}], solution: {gap1: 't1'}},
        untouched: (p) => { p._placements.clear(); },
        wrong: (p) => { p._placements.set('gap1', 't2'); },
        wrong2: (p) => { p._placements.set('gap1', 't3'); },
        correct: (p) => { p._placements.set('gap1', 't1'); },
        locked: null,
    },
    group: {
        config: {kind: 'group', groups: [{id: 'a', label: 'A'}, {id: 'b', label: 'B'}], tokens: [{id: '1', text: 'Jedna'}, {id: '2', text: 'Dva'}], solutions: {1: 'a', 2: 'a'}},
        untouched: (p) => { p._inGroup.clear(); },
        wrong: (p) => { p._inGroup.clear(); p._inGroup.set('1', 'b'); },
        wrong2: (p) => { p._inGroup.clear(); p._inGroup.set('1', 'b'); p._inGroup.set('2', 'b'); },
        correct: (p) => { p._inGroup.clear(); p._inGroup.set('1', 'a'); p._inGroup.set('2', 'a'); },
        locked: null,
    },
    match: {
        config: {kind: 'match', mode: 'columns', tokens: [{id: 'a', text: 'A', side: 'left'}, {id: 'b', text: 'B', side: 'right'}, {id: 'c', text: 'C', side: 'right'}, {id: 'd', text: 'D', side: 'right'}], pairs: [['a', 'b']]},
        untouched: (p) => { p._pairs.clear(); },
        wrong: (p) => { p._pairs.clear(); p._pairs.set('a', 'c'); p._pairs.set('c', 'a'); },
        wrong2: (p) => { p._pairs.clear(); p._pairs.set('a', 'd'); p._pairs.set('d', 'a'); },
        correct: (p) => { p._pairs.clear(); p._pairs.set('a', 'b'); p._pairs.set('b', 'a'); },
        locked: null,
    },
    order: {
        config: {kind: 'order', tokens: [{id: 'x', text: 'X'}, {id: 'y', text: 'Y'}, {id: 'z', text: 'Z'}], solution: ['x', 'y', 'z']},
        untouched: null,
        wrong: (p) => { p._ordered = ['y', 'x', 'z']; },
        wrong2: (p) => { p._ordered = ['z', 'y', 'x']; },
        correct: (p) => { p._ordered = ['x', 'y', 'z']; },
        locked: null,
    },
};

function run(kind, {blockUntilSolved}) {
    const resolved = [];
    const runner = createPuzzleRunner({
        ref: `pz-${kind}`,
        config: {id: `pz-${kind}`, ...KINDS[kind].config},
        engine,
        instanceOptions: {blockUntilSolved, showErrorToast: false},
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
        const pair = (a, b) => { runner.puzzle._pairs.clear(); runner.puzzle._pairs.set(a, b); runner.puzzle._pairs.set(b, a); };
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
