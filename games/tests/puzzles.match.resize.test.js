// The match puzzle in `columns` mode draws SVG lines between the pairs the
// player has connected. Those lines are absolutely positioned, so anything that
// reflows the layout leaves them pointing at where the tokens used to be. A
// ResizeObserver watches the flow element and redraws them.
//
// ResizeObserver reached Safari in 13.4, which means iOS 13.4, March 2020. On an
// older iPad `new ResizeObserver(...)` throws a ReferenceError, and it throws
// while the puzzle is being mounted - so the puzzle does not open at all and the
// team is stuck on it. Four of the six games use columns mode, so this is not a
// corner of the product.
//
// The fallback is a window resize listener. It fires less often and knows less
// (a layout change with no window resize goes unnoticed), but a slightly stale
// line beats a puzzle that will not open. See EI-015's iPad question.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

describe('match puzzle in columns mode, on a browser without ResizeObserver', () => {
    let saved;

    beforeEach(() => {
        document.body.innerHTML = '';
        saved = globalThis.ResizeObserver;
    });

    afterEach(() => {
        globalThis.ResizeObserver = saved;
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('still opens', () => {
        // The iPad case: the constructor is simply not there.
        delete globalThis.ResizeObserver;

        expect(() => mount()).not.toThrow();
        expect(document.querySelector('.pz-kind-match')).not.toBeNull();
    });

    it('redraws its lines when the window is resized instead', async () => {
        delete globalThis.ResizeObserver;

        const runner = mount();
        const redraw = vi.spyOn(runner.puzzle, '_updateConnectionLines');

        window.dispatchEvent(new Event('resize'));
        await new Promise(res => setTimeout(res, 200)); // past the debounce

        expect(redraw).toHaveBeenCalled();
    });

    it('stops listening once the puzzle is closed', async () => {
        // A listener on `window` outlives the element it was added for, so it
        // has to be taken off explicitly or every puzzle opened in a lesson
        // leaves one behind, all of them redrawing lines that no longer exist.
        delete globalThis.ResizeObserver;

        const runner = mount();
        const redraw = vi.spyOn(runner.puzzle, '_updateConnectionLines');
        runner.unmount();

        window.dispatchEvent(new Event('resize'));
        await new Promise(res => setTimeout(res, 200));

        expect(redraw).not.toHaveBeenCalled();
    });

    it('prefers ResizeObserver when the browser has one', async () => {
        // The fallback must not replace the better mechanism on a current iPad.
        const observed = [];
        globalThis.ResizeObserver = class {
            constructor(cb) { this._cb = cb; }
            observe(el) { observed.push(el); }
            unobserve() {}
            disconnect() {}
        };

        const runner = mount();
        const redraw = vi.spyOn(runner.puzzle, '_updateConnectionLines');

        expect(observed).toHaveLength(1);

        window.dispatchEvent(new Event('resize'));
        await new Promise(res => setTimeout(res, 200));
        expect(redraw).not.toHaveBeenCalled();

        runner.unmount();
    });
});
