// EI-012: a saved state must not be trusted just because its signature matches.
//
// Any JSON whose signature matched was adopted wholesale, with no check that the
// fields the engine reads are there or have the right type. A state written by
// an older build is missing whatever was added since - `puzzleResults` is the
// concrete case, where _appendPuzzleResult fails on undefined.push - and a
// missing `flags`, `visited` or `solved` fails on the first navigation. The
// state is also the one thing a pupil can edit in devtools, so this doubles as
// an input validation gap.

import { describe, it, expect, beforeEach } from 'vitest';
import { createReloadHarness } from './helpers/reload.js';

const SCENES = {
    meta: { id: 'schema', version: '1.0.0' },
    startScene: 'start',
    items: [{ id: 'lamp', label: 'Lampa' }],
    scenes: [
        { id: 'start', title: 'Start', image: 'scenes/start.jpg', hotspots: [] },
        { id: 'deeper', title: 'Deeper', image: 'scenes/deeper.jpg', hotspots: [] },
    ],
};

const KEY = 'state:schema';
const SIGNATURE = 'schema|1.0.0';

const fullState = () => ({
    stateSchemaVersion: 1,
    signature: SIGNATURE,
    inventory: ['lamp'],
    solved: { 'solved:pz:x': true },
    flags: { lit: true },
    visited: { start: true },
    eventsFired: { intro: true },
    scene: 'deeper',
    useItemId: null,
    hero: null,
    puzzleResults: [],
    contentShown: {},
    sceneImages: {},
});

const store = (state) => localStorage.setItem(KEY, JSON.stringify(state));
const harness = () => createReloadHarness({ scenes: SCENES }, { baseUrl: './games/schema/' });

describe('EI-012: a saved state is checked before it is used', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('starts the game with every field in turn missing', async () => {
        for (const field of Object.keys(fullState())) {
            if (field === 'signature') continue; // without it, the state is not ours
            localStorage.clear();

            const state = fullState();
            delete state[field];
            store(state);

            const game = await harness().boot();
            expect(game.state.scene, `missing ${field}`).toBeTruthy();
            expect(Array.isArray(game.state.inventory), `missing ${field}`).toBe(true);
            expect(Array.isArray(game.state.puzzleResults), `missing ${field}`).toBe(true);
            for (const map of ['solved', 'flags', 'visited', 'eventsFired', 'contentShown', 'sceneImages']) {
                expect(game.state[map], `missing ${field} -> ${map}`).toBeTypeOf('object');
            }
        }
    });

    it('records a puzzle result on a state that predates puzzleResults', async () => {
        // The concrete failure: undefined.push, on a state written by a build
        // that did not have the field yet.
        const state = fullState();
        delete state.puzzleResults;
        store(state);

        const game = await harness().boot();
        expect(() => game._appendPuzzleResult({ ref: 'x', ok: true })).not.toThrow();
        expect(game.state.puzzleResults).toHaveLength(1);
    });

    it('falls back to the start scene when the saved one no longer exists', async () => {
        // A scene can be renamed or removed between two builds of the same game.
        // Keeping the name meant goto() reported "scene not found" and the game
        // sat there with no image and no hotspots.
        store({ ...fullState(), scene: 'a-scene-that-was-removed' });

        const game = await harness().boot();

        expect(game.state.scene).toBe('start');
        expect(game.currentScene.id).toBe('start');
        expect(game.state.inventory).toEqual(['lamp']);
    });

    it('replaces fields of the wrong type rather than trusting them', async () => {
        store({
            ...fullState(),
            inventory: 'lamp',
            flags: ['lit'],
            solved: 42,
            eventsFired: null,
            puzzleResults: { nope: true },
            useItemId: { id: 'lamp' },
        });

        const game = await harness().boot();

        expect(game.state.inventory).toEqual([]);
        expect(game.state.flags).toEqual({});
        expect(game.state.solved).toEqual({});
        expect(game.state.eventsFired).toEqual({});
        expect(game.state.puzzleResults).toEqual([]);
        expect(game.state.useItemId).toBeNull();
    });

    it('drops a scene image override that is not a path', async () => {
        store({ ...fullState(), scene: 'start', sceneImages: { start: 42, deeper: 'scenes/lit.jpg' } });

        const game = await harness().boot();

        expect(game.state.sceneImages).toEqual({ deeper: 'scenes/lit.jpg' });
        expect(game.sceneImage.getAttribute('src')).toBe('./games/schema/scenes/start.jpg');
    });

    it('survives a stored value that is not an object at all', async () => {
        localStorage.setItem(KEY, '"just a string"');
        const game = await harness().boot();
        expect(game.state.scene).toBe('start');
    });

    it('survives a truncated entry', async () => {
        localStorage.setItem(KEY, '{"signature":"schema|1.0.0","inventory":["la');
        const game = await harness().boot();
        expect(game.state.scene).toBe('start');
    });

    it('keeps what it can from a partial state', async () => {
        // Filling defaults must not mean throwing the lesson away.
        store({ signature: SIGNATURE, flags: { lit: true }, scene: 'deeper' });

        const game = await harness().boot();

        expect(game.state.flags.lit).toBe(true);
        expect(game.state.scene).toBe('deeper');
    });

    it('stamps the schema version on what it writes', async () => {
        const game = await harness().boot();
        expect(game._loadState().stateSchemaVersion).toBe(1);
    });

    it('stamps which engine wrote it', async () => {
        // Never read back - the whitelist drops it on load - but a stored state
        // that cannot say which engine produced it is a support call nobody can
        // answer.
        const game = await harness().boot();
        const stored = game._loadState();

        expect(stored.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
        expect(Number.isInteger(stored.engineApiVersion)).toBe(true);
    });
});
