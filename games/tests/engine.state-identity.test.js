// EI-002 step one: saved state gets an identity.
//
// There was one localStorage entry, `leeuwenhoek_escape_state`, for every game
// and every team on the device, and the signature included the language. So
// opening a second game destroyed the first one's progress, and switching the
// language behaved like switching to a different game and destroyed it too.
//
// A tablet in a classroom is shared, by two teams in the same lesson and by
// different classes in the same week. This is step one: namespace the key per
// game and put persistence behind an injectable storage interface. Run and team
// identity is step two and belongs to the hosted runtime, because the identity
// has to come from there.

import { describe, it, expect, beforeEach } from 'vitest';
import { createReloadHarness } from './helpers/reload.js';

const LEGACY_KEY = 'leeuwenhoek_escape_state';

const gameData = (id) => ({
    meta: { id, version: '1.0.0' },
    startScene: 'start',
    scenes: [
        { id: 'start', title: 'Start', image: 'scenes/start.jpg', hotspots: [] },
        { id: 'deeper', title: 'Deeper', image: 'scenes/deeper.jpg', hotspots: [] },
    ],
});

const alpha = () => createReloadHarness({ scenes: gameData('alpha') }, { baseUrl: './games/alpha/' });
const beta = () => createReloadHarness({ scenes: gameData('beta') }, { baseUrl: './games/beta/' });

describe('EI-002: saved state has an identity', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('keeps two games on one tablet apart', async () => {
        const a = await alpha().boot();
        a.state.inventory.push('alpha_key');
        await a.goto('deeper');

        // The class moves on to the other game and back.
        const b = await beta().boot();
        b.state.inventory.push('beta_key');
        await b.goto('deeper');

        const aAgain = await alpha().boot();
        expect(aAgain.state.inventory).toEqual(['alpha_key']);
        expect(aAgain.state.scene).toBe('deeper');

        const bAgain = await beta().boot();
        expect(bAgain.state.inventory).toEqual(['beta_key']);
    });

    it('stores each game under its own key', async () => {
        const harness = alpha();
        await harness.boot();

        expect(Object.keys(harness.storageDump())).toEqual(['state:alpha']);
    });

    it('keeps progress when the language changes', async () => {
        // The language does not change what a team has done. It used to be part
        // of the signature, so picking a different one looked like a different
        // game and wiped the lesson.
        const harness = alpha();

        const cs = await harness.boot({ lang: 'cs' });
        cs.state.inventory.push('alpha_key');
        await cs.goto('deeper');

        const en = await harness.boot({ lang: 'en' });
        expect(en.state.inventory).toEqual(['alpha_key']);
        expect(en.state.scene).toBe('deeper');
    });

    it('still starts fresh when the game version changes', async () => {
        // Dropping the language from the signature must not drop the version.
        // A saved state from an older build of the same game can name scenes
        // and items that no longer exist.
        const harness = alpha();
        const first = await harness.boot();
        first.state.inventory.push('alpha_key');
        await first.goto('deeper');

        const republished = createReloadHarness(
            { scenes: { ...gameData('alpha'), meta: { id: 'alpha', version: '2.0.0' } } },
            { baseUrl: './games/alpha/' },
        );
        const second = await republished.boot();

        expect(second.state.inventory).toEqual([]);
        expect(second.state.scene).toBe('start');
    });

    it('adopts a state left under the old key, once', async () => {
        // Somebody may be in the middle of a lesson when this ships.
        localStorage.setItem(LEGACY_KEY, JSON.stringify({
            signature: 'alpha|1.0.0|cs',
            inventory: ['alpha_key'],
            solved: {}, flags: {}, visited: {}, eventsFired: {},
            scene: 'deeper', useItemId: null, hero: null,
            puzzleResults: [], contentShown: {},
        }));

        const harness = alpha();
        const adopted = await harness.boot();
        expect(adopted.state.inventory).toEqual(['alpha_key']);
        expect(adopted.state.scene).toBe('deeper');
        expect(localStorage.getItem(LEGACY_KEY)).toBeNull();

        const later = await harness.boot();
        expect(later.state.inventory).toEqual(['alpha_key']);
    });

    it('does not adopt another game\'s state left under the old key', async () => {
        localStorage.setItem(LEGACY_KEY, JSON.stringify({
            signature: 'beta|1.0.0|cs',
            inventory: ['beta_key'],
            scene: 'deeper',
        }));

        const started = await alpha().boot();

        expect(started.state.inventory).toEqual([]);
        expect(started.state.scene).toBe('start');
        // Left in place: beta is still entitled to it.
        expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
    });

    it('can be given somewhere else to store the state', async () => {
        // The seam the hosted runtime needs: the authoritative copy will live in
        // a Durable Object with localStorage as a local cache.
        const box = { value: null };
        const storage = {
            load: () => box.value,
            save: (state) => { box.value = JSON.parse(JSON.stringify(state)); },
            clear: () => { box.value = null; },
        };

        const harness = alpha();
        const first = await harness.boot({ gameOpts: { storage } });
        first.state.inventory.push('alpha_key');
        first._saveState();

        expect(box.value.inventory).toEqual(['alpha_key']);
        expect(localStorage.length).toBe(0);

        const second = await harness.boot({ gameOpts: { storage } });
        expect(second.state.inventory).toEqual(['alpha_key']);
    });
});
