// A list puzzle runs other puzzles as its steps. It has to close the one it
// started.
//
// It did not keep hold of the runner it created, and its own unmount() only
// tidied its background overlay. Normal progression was safe, because each step
// unmounts the previous one as it resolves. Tearing the list down while a step
// was still open was not: the step's DOM went with the list's container, but
// anything the step had registered outside itself stayed - a window listener, a
// pending timer.
//
// Found by codex SOL reviewing the ResizeObserver fallback (EI-027), which is
// what such a step would leak.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPuzzleRunner } from '../../engine/puzzles/index.js';

const LIST = {
    id: 'sequence',
    kind: 'list',
    title: 'Postupně',
    steps: [
        { config: { id: 'first', kind: 'phrase', title: 'Jedna', solution: 'a' } },
        { config: { id: 'second', kind: 'phrase', title: 'Dvě', solution: 'b' } },
    ],
};

const mountList = () => {
    const layer = document.createElement('div');
    layer.id = 'hotspotLayer';
    document.body.appendChild(layer);

    const runner = createPuzzleRunner({
        ref: 'sequence',
        rect: { x: 0, y: 0, w: 100, h: 100 },
        puzzlesById: { sequence: LIST },
        i18n: (k, d = '') => d || k,
        engine: { data: { puzzles: {} } },
        onResolve: () => {},
    });
    runner.mountInto(layer);
    return runner;
};

describe('a list puzzle torn down while a step is open', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('closes the step it started', () => {
        const runner = mountList();
        const list = runner.puzzle;

        expect(list._activeRunner, 'the list should be holding its current step').toBeTruthy();

        let stepClosed = false;
        const step = list._activeRunner;
        const realUnmount = step.unmount;
        step.unmount = (...args) => { stepClosed = true; return realUnmount(...args); };

        runner.unmount();

        expect(stepClosed).toBe(true);
        expect(list._activeRunner).toBeNull();
    });

    it('survives a step that throws while closing', () => {
        // A half-built step must not stop the rest of the teardown.
        const runner = mountList();
        const list = runner.puzzle;
        list._activeRunner.unmount = () => { throw new Error('half-built'); };

        expect(() => runner.unmount()).not.toThrow();
        expect(list._activeRunner).toBeNull();
    });
});
