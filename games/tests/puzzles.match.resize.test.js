// The match puzzle in `columns` mode draws SVG lines between the pairs the
// player has connected. Those lines are absolutely positioned, so anything that
// reflows the layout leaves them pointing at where the tokens used to be. A
// ResizeObserver watches the flow element and redraws them.
//
// What is tested here is the redraw itself. There was briefly a window.resize
// fallback for browsers without ResizeObserver, and it could never have run: the
// engine's own syntax has a higher floor than the observer does. EI-027 closed
// that as a product decision - the minimum is iPadOS 15 - and the fallback went
// with it.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPuzzleRunner } from '../../engine/puzzles/index.js';

const CONFIG = {
    id: 'pairs',
    kind: 'match',
    mode: 'columns',
    title: 'Spoj dvojice',
    tokens: [
        { id: 'a', text: 'Adam', pair: 'b' },
        { id: 'b', text: 'Eva', pair: 'a' },
    ],
};

const mount = () => {
    const layer = document.createElement('div');
    layer.id = 'hotspotLayer';
    document.body.appendChild(layer);

    const runner = createPuzzleRunner({
        ref: 'pairs',
        rect: { x: 0, y: 0, w: 100, h: 100 },
        puzzlesById: { pairs: CONFIG },
        i18n: (k, d = '') => d || k,
        onResolve: () => {},
    });
    runner.mountInto(layer);
    return runner;
};

describe('redrawing the connection lines', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('terminates when there is a pair on screen', async () => {
        // _updateConnectionLines() walked `_connectionLines` with Map.forEach,
        // deleting each entry and immediately having _drawConnectionLine() put
        // the same key back. A Map visits entries added during iteration, and a
        // delete followed by a set appends the key at the end, so the loop
        // visits it again, forever. It is synchronous and inside a
        // requestAnimationFrame, so it does not just fail: it takes the main
        // thread with it and the tablet stops responding.
        //
        // It needs a pair to exist first, which is why nothing caught it: with
        // no lines drawn the map is empty and the loop has nothing to spin on.
        // Rotating a tablet after connecting one pair is all it takes.
        const runner = mount();
        const puzzle = runner.puzzle;

        puzzle._drawConnectionLine('a', 'b', 'rgba(1,2,3,0.4)', 0);
        expect(puzzle._connectionLines.size).toBe(1);

        // Bound the damage: a runaway loop would spin the CPU and no test
        // timeout can interrupt it, so make the redraw itself give up loudly.
        const real = puzzle._drawConnectionLine.bind(puzzle);
        let calls = 0;
        puzzle._drawConnectionLine = (...args) => {
            if (++calls > 50) throw new Error(`_updateConnectionLines did not terminate (${calls} redraws for 1 pair)`);
            return real(...args);
        };

        puzzle._updateConnectionLines();
        await new Promise(res => requestAnimationFrame(res));

        expect(calls).toBe(1);
        expect(puzzle._connectionLines.size).toBe(1);
        expect(document.querySelectorAll('.pz-match-connections path')).toHaveLength(1);

        runner.unmount();
    });
});
