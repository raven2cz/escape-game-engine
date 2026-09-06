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
        history.replaceState(null, '', '/');
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

    // A real legacy state always has a hero: the old init() set one on the first
    // start and saved it. Getting that wrong in the fixture hides the whole
    // defect, because a null hero makes init() save for its own reasons.
    const legacyState = () => ({
        signature: 'alpha|1.0.0|cs',
        inventory: ['alpha_key'],
        solved: {}, flags: {}, visited: {}, eventsFired: {},
        scene: 'deeper', useItemId: null,
        hero: { id: 'adam', gender: 'm', name: 'Adam', assetsBase: 'assets/npc/adam/' },
        puzzleResults: [], contentShown: {},
    });

    it('signs a game that declares no saveVersion exactly as before', async () => {
        // The change to _signature() must be a no-op for a game that has not
        // opted in, or shipping it would itself have been the wipe it exists to
        // prevent.
        const game = await alpha().boot();
        expect(game.state.signature).toBe('alpha|1.0.0');
    });

    it('keeps progress when only meta.version changes', async () => {
        // The point of the split. A typo fix must not end a lesson.
        const versioned = (version) => createReloadHarness(
            { scenes: { ...gameData('alpha'), meta: { id: 'alpha', version, saveVersion: 1 } } },
            { baseUrl: './games/alpha/' },
        );

        const first = await versioned('1.0.0').boot();
        first.state.inventory.push('alpha_key');
        await first.goto('deeper');

        const republished = await versioned('1.1.0').boot();

        expect(republished.state.inventory).toEqual(['alpha_key']);
        expect(republished.state.scene).toBe('deeper');
    });

    it('starts over when saveVersion changes', async () => {
        // And the other half: bumping it still means everyone starts again,
        // which is the whole reason it is a separate field with a name that
        // says so.
        const saved = (saveVersion) => createReloadHarness(
            { scenes: { ...gameData('alpha'), meta: { id: 'alpha', version: '1.0.0', saveVersion } } },
            { baseUrl: './games/alpha/' },
        );

        const first = await saved(1).boot();
        first.state.inventory.push('alpha_key');
        await first.goto('deeper');

        const breaking = await saved(2).boot();

        expect(breaking.state.inventory).toEqual([]);
        expect(breaking.state.scene).toBe('start');
    });

    it('treats saveVersion 0 as a version, not as absent', async () => {
        const game = await createReloadHarness(
            { scenes: { ...gameData('alpha'), meta: { id: 'alpha', version: '9.9.9', saveVersion: 0 } } },
            { baseUrl: './games/alpha/' },
        ).boot();

        expect(game.state.signature).toBe('alpha|0');
    });

    it('adopts a state left under the old key, once', async () => {
        // Somebody may be in the middle of a lesson when this ships.
        localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyState()));

        const harness = alpha();
        const adopted = await harness.boot();
        expect(adopted.state.inventory).toEqual(['alpha_key']);
        expect(adopted.state.scene).toBe('deeper');
        expect(localStorage.getItem(LEGACY_KEY)).toBeNull();

        const later = await harness.boot();
        expect(later.state.inventory).toEqual(['alpha_key']);
    });

    it('writes an adopted state down before anything else can happen', async () => {
        // Adoption deletes the old entry, so until the new one is written the
        // team's progress exists only in memory. A tablet that reloads twice in
        // a row - which is exactly what a pupil does when a game looks stuck -
        // would lose the lesson at the second reload.
        localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyState()));

        const harness = alpha();
        await harness.boot();

        expect(JSON.parse(localStorage.getItem('state:alpha')).inventory).toEqual(['alpha_key']);
    });

    it('does not adopt the old key when the caller brought its own storage', async () => {
        // The legacy key is a localStorage artefact of the unhosted engine. A
        // runtime that supplies per-team storage must not have whatever was left
        // on the tablet handed to it.
        localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyState()));
        const storage = { load: () => null, save: () => {}, clear: () => {} };

        const started = await alpha().boot({ gameOpts: { storage } });

        expect(started.state.inventory).toEqual([]);
        expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
    });

    it('does not let a reset be undone by what is under the old key', async () => {
        // reset=1 skips adoption but used to leave the old entry in place, so
        // the next start found it and adopted the lesson the teacher had just
        // reset away.
        localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyState()));
        history.replaceState(null, '', '/?reset=1');

        const harness = alpha();
        const fresh = await harness.boot();
        expect(fresh.state.inventory).toEqual([]);
        expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    });

    // restart() ends in location.reload(), which jsdom cannot do and reports on
    // stderr as "Not implemented: navigation to another Document". That line is
    // this test saying the engine did the right thing, not a failure.
    it('clears the old key on restart too', async () => {
        // restart() used to clear only the namespaced key, so the next start
        // adopted whatever was still under the old one.
        const harness = alpha();
        const game = await harness.boot();
        localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyState()));

        game.restart();

        expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
        expect(localStorage.getItem('state:alpha')).toBeNull();
    });

    it('never removes another game\'s entry from the old key', async () => {
        // Discarding has to check ownership just as adopting does. A teacher
        // opening game B with a reset link, or a team restarting game B, must
        // not take game A's lesson with it.
        localStorage.setItem(LEGACY_KEY, JSON.stringify({ ...legacyState(), signature: 'beta|1.0.0|cs' }));
        history.replaceState(null, '', '/?reset=1');

        const game = await alpha().boot();
        expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();

        game.restart();
        expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
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

// EI-002 step two: the identity of the lesson and the team.
//
// Step one made the key per game, which stops two games overwriting each other.
// It does nothing about the case that actually happens: a trolley iPad on which
// 7.A plays in the first period and 7.B in the second, on the same game. 7.B
// resumes 7.A's inventory, flags and scene, and the intro is skipped because it
// is already in `eventsFired` - which does not look like resumed progress, it
// looks like a broken game.
//
// The engine cannot detect that a new lesson began. There is no signal for it in
// the browser, and a guess - a timer, a date change - would end a double period
// or a lesson that spans a break. So the identity is supplied: `?session=` in the
// link the class is given today, and the hosted runtime directly once it exists.
// The engine's job is to use it if it is there and to behave exactly as before if
// it is not, because most links will not have one.

const withIds = (ids) => ({ gameOpts: ids });

describe('EI-002 step two: run and team identity', () => {
    beforeEach(() => {
        localStorage.clear();
        history.replaceState(null, '', '/');
    });

    it('gives the next lesson its own slot', async () => {
        // 7.A, first period.
        const first = await alpha().boot(withIds({ sessionId: 'p1' }));
        first.state.inventory.push('key_7a');
        await first.goto('deeper');

        // 7.B, second period, same tablet, same game, same link but a new
        // session. Nobody pressed anything.
        const second = await alpha().boot(withIds({ sessionId: 'p2' }));

        expect(second.state.inventory).toEqual([]);
        expect(second.state.scene).toBe('start');

        // And 7.A's lesson is still there, which matters when a period is split
        // over a break and the class comes back to it.
        const back = await alpha().boot(withIds({ sessionId: 'p1' }));
        expect(back.state.inventory).toEqual(['key_7a']);
        expect(back.state.scene).toBe('deeper');
    });

    it('keeps two teams in one lesson apart', async () => {
        const red = await alpha().boot(withIds({ sessionId: 'p1', teamId: 'red' }));
        red.state.inventory.push('red_key');
        red._saveState();

        const blue = await alpha().boot(withIds({ sessionId: 'p1', teamId: 'blue' }));
        expect(blue.state.inventory).toEqual([]);

        const redAgain = await alpha().boot(withIds({ sessionId: 'p1', teamId: 'red' }));
        expect(redAgain.state.inventory).toEqual(['red_key']);
    });

    it('leaves the key alone when nobody supplies an identity', async () => {
        // The back-compatibility case, and the one that matters most: shipping
        // this must not end a lesson that is running. Most links have no session
        // in them and the key has to be byte-identical to the old one.
        const harness = alpha();
        await harness.boot();

        expect(Object.keys(harness.storageDump())).toEqual(['state:alpha']);
    });

    it('does not confuse a missing session with a missing team', async () => {
        // `state:a:alpha` would have to mean both, if the key only included the
        // parts that were present. It does not: all four segments, always, with
        // an empty one for whichever is absent.
        const harness = alpha();
        await harness.boot(withIds({ sessionId: 'a' }));
        await harness.boot(withIds({ teamId: 'a' }));

        // Both wrote, and to two different places. storageDump() is the whole
        // store, so this asserts on the keys themselves rather than on whichever
        // one happens to have been written first.
        expect(Object.keys(harness.storageDump()).sort())
            .toEqual(['state::alpha:a', 'state:a:alpha:']);
    });

    it('does not let a colon in an id reach another slot', async () => {
        // An id is a string from a caller, and a runtime may well use something
        // URL-shaped. Unencoded, session `p1:red` and session `p1` team `red`
        // would be the same key, and one team would resume the other's lesson.
        const harness = alpha();
        await harness.boot(withIds({ sessionId: 'p1:red' }));
        await harness.boot(withIds({ sessionId: 'p1', teamId: 'red' }));

        expect(Object.keys(harness.storageDump()).sort())
            .toEqual(['state:p1%3Ared:alpha:', 'state:p1:alpha:red']);
    });

    it('treats a blank identity as none at all', async () => {
        // An empty query parameter is what `?session=` gives, and a link built
        // by string concatenation produces that easily. It has to mean "no
        // session", not "a session whose name is nothing".
        const harness = alpha();
        await harness.boot(withIds({ sessionId: '', teamId: '   ' }));

        expect(Object.keys(harness.storageDump())).toEqual(['state:alpha']);
    });

    it('does not adopt the device-wide leftover into a lesson', async () => {
        // Adoption exists so that the step-one upgrade did not end a running
        // lesson. Into an identified run it would do the opposite of what this
        // item is for: import the previous class's progress, silently, looking
        // exactly like resumed progress.
        localStorage.setItem(LEGACY_KEY, JSON.stringify({
            signature: 'alpha|1.0.0|cs',
            scene: 'deeper',
            inventory: ['someone_elses_key'],
            flags: {},
            eventsFired: {},
            hero: null,
        }));

        const game = await alpha().boot(withIds({ sessionId: 'p2' }));

        expect(game.state.inventory).toEqual([]);
        expect(game.state.scene).toBe('start');
        // And it is left where it was, because the run it belongs to may still
        // be resumed by a tablet opening the link without a session.
        expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
    });

    it('restarts one team without touching the other', async () => {
        const red = await alpha().boot(withIds({ sessionId: 'p1', teamId: 'red' }));
        red.state.inventory.push('red_key');
        red._saveState();

        const blue = await alpha().boot(withIds({ sessionId: 'p1', teamId: 'blue' }));
        blue.state.inventory.push('blue_key');
        blue._saveState();

        blue.storage.clear();

        const redAgain = await alpha().boot(withIds({ sessionId: 'p1', teamId: 'red' }));
        expect(redAgain.state.inventory).toEqual(['red_key']);
    });
});
