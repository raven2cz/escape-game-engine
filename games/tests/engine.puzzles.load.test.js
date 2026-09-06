// EI-030: a dropped puzzles.json must not become a cached failure.
//
// Puzzles live in a separate file from the scenes, fetched lazily the first
// time a puzzle is opened. On a school network a request is dropped now and
// then, and a drop is not an error anyone sees - the same fact behind EI-003.
//
// The bug: a failed fetch left the parsed body as `{}`, which fell through to
// the "bare map" shape and was stored as `this.data.puzzles = {}`. The guard at
// the top of the loader accepts an empty object as "already loaded", so every
// later call returned it without retrying. Result: every puzzle in the game
// became unopenable for the rest of the run, and only a reload cleared it -
// which nobody knew to do, because nothing said why the puzzle would not open.
//
// The tests are on the loader itself, because that is where the caching lives.
// The `attempt` counters are the point: they distinguish "retried" from
// "cached the failure", which is the whole of EI-030.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Game } from '../../engine/engine.js';

// The loader needs only `baseUrl`, `data` and `fetch`. `data` is what `init()`
// leaves behind - the parsed scenes.json, which has no `puzzles` key, so
// `this.data.puzzles` starts undefined exactly as in a real run.
const makeGame = () => {
    // The constructor wires listeners onto the modal buttons, so those two refs
    // have to be real elements. Nothing else is touched before the loader runs.
    const game = new Game({
        baseUrl: './games/test/',
        i18n: { engine: {}, game: {} },
        modalCancel: document.createElement('button'),
        modalOk: document.createElement('button'),
    });
    game.data = {};
    return game;
};

const PUZZLES = { 'pz-1': { id: 'pz-1', kind: 'quiz' } };

describe('EI-030: loading puzzles.json', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('retries after a dropped request instead of caching the failure', async () => {
        let attempt = 0;
        vi.stubGlobal('fetch', async () => {
            attempt++;
            if (attempt === 1) throw new Error('network dropped');
            return { ok: true, json: async () => PUZZLES };
        });

        const game = makeGame();

        await game._ensurePuzzlesLoaded();               // the drop
        expect(game.data.puzzles?.['pz-1']).toBeUndefined();

        await game._ensurePuzzlesLoaded();               // the next puzzle-open
        expect(game.data.puzzles?.['pz-1']).toBeTruthy(); // and now it is there
        expect(attempt).toBe(2);                          // it really did retry
    });

    it('retries after a non-200, too', async () => {
        // A dropped request that is refused rather than lost arrives as a 503 or
        // a 404 from a proxy. Same outcome, same fix.
        let attempt = 0;
        vi.stubGlobal('fetch', async () => {
            attempt++;
            if (attempt === 1) return { ok: false, status: 503, json: async () => ({}) };
            return { ok: true, json: async () => PUZZLES };
        });

        const game = makeGame();
        await game._ensurePuzzlesLoaded();
        await game._ensurePuzzlesLoaded();

        expect(game.data.puzzles?.['pz-1']).toBeTruthy();
        expect(attempt).toBe(2);
    });

    it('caches a genuinely empty puzzles.json rather than refetching forever', async () => {
        // The other half of the fix: it must not turn "loaded and empty" into
        // "never loaded". A game with no puzzles, or a puzzles.json that is `{}`,
        // is a valid and final answer - fetching it again would spin on every
        // puzzle-open for a game that has none.
        let attempt = 0;
        vi.stubGlobal('fetch', async () => {
            attempt++;
            return { ok: true, json: async () => ({}) };
        });

        const game = makeGame();
        await game._ensurePuzzlesLoaded();
        await game._ensurePuzzlesLoaded();

        expect(attempt).toBe(1);
        expect(game.data.puzzles).toEqual({});
    });

    it('loads a successful map on the first try, unchanged', async () => {
        // The happy path stays exactly as it was: one fetch, map stored, no
        // second request.
        let attempt = 0;
        vi.stubGlobal('fetch', async () => {
            attempt++;
            return { ok: true, json: async () => PUZZLES };
        });

        const game = makeGame();
        await game._ensurePuzzlesLoaded();
        await game._ensurePuzzlesLoaded();

        expect(game.data.puzzles?.['pz-1']).toBeTruthy();
        expect(attempt).toBe(1);
    });
});
