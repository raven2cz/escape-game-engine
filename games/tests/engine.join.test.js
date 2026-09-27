// "Kdo hraje?" (engine/join.js): the name and animal a pupil picks before a
// game in a lesson, which become the player the run is saved under and the name
// on the teacher's board.

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {boot} from '../../engine/boot.js';
import {askWhoPlays, cleanName, loadPlayer, savePlayer, forgetPlayer, mintPlayerId, NAME_MAX} from '../../engine/join.js';
import {AVATARS} from '../../engine/dashboard/avatars.js';

const SCENES = {
    meta: {id: 'join-test', version: '1.0.0', saveVersion: 1},
    startScene: 'room',
    scenes: [{id: 'room', title: 'Místnost', image: 'scenes/room.jpg', hotspots: []}],
};

beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    localStorage.clear();
    vi.stubGlobal('fetch', async (url) => {
        const name = String(url).split('?')[0].split('/').pop();
        if (name === 'scenes.json') return {ok: true, json: async () => SCENES};
        return {ok: false, status: 404, json: async () => ({})};
    });
});
afterEach(() => {
    vi.unstubAllGlobals();
});

/** Fill in the screen the way a pupil would. */
async function answer(name, avatar) {
    const overlay = await vi.waitFor(() => {
        const el = document.querySelector('.join-overlay');
        if (!el) throw new Error('no join screen yet');
        return el;
    });
    const input = overlay.querySelector('.join-name');
    input.value = name;
    input.dispatchEvent(new Event('input', {bubbles: true}));
    overlay.querySelector(`.join-avatar[data-avatar="${avatar}"]`).click();
    overlay.querySelector('.join-play').click();
}

describe('cleanName', () => {
    it('trims, collapses spaces, strips invisible and control characters, and caps the length', () => {
        expect(cleanName('  Anička   Nová  ')).toBe('Anička Nová');
        expect(cleanName('An​i‮č\u0007ka')).toBe('Anička');
        // Every format character, not a hand-picked list: word joiner, Arabic letter mark...
        expect(cleanName('\u2060')).toBe('');
        expect(cleanName('Ani\u061Cčka\u2060')).toBe('Anička');
        expect(cleanName('Anic\u030Cka')).toBe('Anička');              // combining háček, normalised
        expect(cleanName('A\u200B\u030A')).toBe('Å');                   // normalised after removal, not before
        expect([...cleanName('🦊'.repeat(40))]).toHaveLength(NAME_MAX);
        expect(cleanName('   ')).toBe('');
        expect(cleanName(null)).toBe('');
    });
});

describe('remembering the player', () => {
    it('per lesson and game; forgets on request; ignores anything malformed', () => {
        const id = mintPlayerId();
        savePlayer('7A', 'g', {id, name: 'Anička', avatar: 'fox'});
        expect(loadPlayer('7A', 'g')).toEqual({id, name: 'Anička', avatar: 'fox'});
        expect(loadPlayer('7B', 'g')).toBeNull();
        expect(loadPlayer('7A', 'other')).toBeNull();
        forgetPlayer('7A', 'g');
        expect(loadPlayer('7A', 'g')).toBeNull();
        localStorage.setItem('player:7A:g', JSON.stringify({id, name: 'X', avatar: 'dragon'}));
        expect(loadPlayer('7A', 'g')).toBeNull();
        localStorage.setItem('player:7A:g', JSON.stringify({name: 'X', avatar: 'fox'}));   // no id
        expect(loadPlayer('7A', 'g')).toBeNull();
        expect(mintPlayerId()).not.toBe(mintPlayerId());
        localStorage.setItem('player:7A:g', '{not json');
        expect(loadPlayer('7A', 'g')).toBeNull();
    });
});

describe('the screen', () => {
    it('every avatar in the catalogue has its picture shipped with the engine', async () => {
        const {existsSync} = await import('node:fs');
        const {join} = await import('node:path');
        for (const a of AVATARS) {
            expect(existsSync(join(process.cwd(), 'engine', 'avatars', a.file)), a.file).toBe(true);
        }
        expect(AVATARS.filter(a => a.kind === 'animal')).toHaveLength(16);
        expect(AVATARS.filter(a => a.kind === 'kid')).toHaveLength(16);
    });

    it('names the authors of the pictures on the screen (CC BY 4.0)', async () => {
        void askWhoPlays(document.body);
        expect(document.querySelector('.join-credits').textContent).toMatch(/Ashley Seo.*CC BY 4\.0/);
    });

    it('offers every avatar, and Hrát only once there is a name and an animal', async () => {
        const done = askWhoPlays(document.body);
        const overlay = document.querySelector('.join-overlay');
        expect(overlay.querySelector('.join-title').textContent).toBe('Kdo hraje?');
        expect(overlay.querySelectorAll('.join-avatar')).toHaveLength(AVATARS.length);
        const play = overlay.querySelector('.join-play');
        expect(play.disabled).toBe(true);
        const input = overlay.querySelector('.join-name');
        input.value = '   ';
        input.dispatchEvent(new Event('input'));
        overlay.querySelector('.join-avatar[data-avatar="owl"]').click();
        expect(play.disabled).toBe(true);                           // blank is not a name
        input.value = ' Jakub ';
        input.dispatchEvent(new Event('input'));
        expect(play.disabled).toBe(false);
        expect(overlay.querySelector('[data-avatar="owl"]').getAttribute('aria-checked')).toBe('true');
        play.click();
        await expect(done).resolves.toEqual({name: 'Jakub', avatar: 'owl'});
        expect(document.querySelector('.join-overlay')).toBeNull();
    });

    it('the pictures are one radio group: one tab stop, arrows move and choose', async () => {
        void askWhoPlays(document.body);
        const buttons = [...document.querySelectorAll('.join-avatar')];
        expect(buttons.filter(b => b.tabIndex === 0)).toHaveLength(1);
        buttons[0].focus();
        buttons[0].dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
        expect(document.activeElement).toBe(buttons[1]);
        expect(buttons[1].getAttribute('aria-checked')).toBe('true');
        expect(buttons.filter(b => b.tabIndex === 0)).toEqual([buttons[1]]);
        buttons[1].dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowLeft', bubbles: true}));
        buttons[0].dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowLeft', bubbles: true}));
        expect(document.activeElement).toBe(buttons.at(-1));             // wraps round
    });

    it('a name is only ever text', async () => {
        const done = askWhoPlays(document.body);
        await answer('<img src=x>', 'fox');
        const {name} = await done;
        expect(name).toBe('<img src=x>');
        expect(document.querySelector('img')).toBeNull();
    });
});

describe('boot() in a lesson', () => {
    it('asks who is playing when the link names a lesson but no player', async () => {
        const booting = boot({gameId: 'join-test', sessionId: '7A'});
        await answer('Anička', 'unicorn');
        const game = await booting;
        expect(game.teamId).toMatch(/^p-/);                              // the identity and save slot: an id
        expect(game.playerName).toBe('Anička');                          // the name is only a label
        expect(game.avatar).toBe('unicorn');
        expect(localStorage.getItem(`state:7A:join-test:${encodeURIComponent(game.teamId)}`)).not.toBeNull();
    });

    it('does not ask again on a reload of the same lesson', async () => {
        const id = mintPlayerId();
        savePlayer('7A', 'join-test', {id, name: 'Anička', avatar: 'unicorn'});
        const game = await boot({gameId: 'join-test', sessionId: '7A'});
        expect(document.querySelector('.join-overlay')).toBeNull();
        expect(game.teamId).toBe(id);
        expect(game.playerName).toBe('Anička');
    });

    it('does not ask when this tablet is already playing the lesson from before (no lesson ends)', async () => {
        // A session link with no player, saved by the engine before this screen existed.
        const first = await boot({gameId: 'join-test', sessionId: '7A', join: false});
        first.state.flags.halfway = true;
        first._saveState();
        const again = await boot({gameId: 'join-test', sessionId: '7A'});
        expect(document.querySelector('.join-overlay')).toBeNull();
        expect(again.teamId).toBeNull();
        expect(again.state.flags.halfway).toBe(true);                    // the lesson goes on
    });

    it('does not ask outside a lesson, or when the link already names the player', async () => {
        await boot({gameId: 'join-test'});
        expect(document.querySelector('.join-overlay')).toBeNull();
        const named = await boot({gameId: 'join-test', sessionId: '7A', teamId: ' Pe‮tr '});
        expect(document.querySelector('.join-overlay')).toBeNull();
        expect(named.teamId).toBe('Pe‮tr');                              // the identity is kept whole
        expect(named.playerName).toBe('Petr');                           // only the label is cleaned
    });

    it('an id from the link with nothing showable in it is no name, not a raw label', async () => {
        const sent = [];
        const game = await boot({gameId: 'join-test', sessionId: '7A', teamId: '\u200B\u202E\u2060',
            report: {enabled: true, send: (w) => { sent.push(w); }}});
        expect(game.playerName).toBeNull();
        game.reporter.flush();
        expect(sent.at(-1).player).toBeNull();
        expect(sent.at(-1).playerId).toBe('\u200B\u202E\u2060');      // the identity is still whole
    });

    it('a long opaque player id from the link is never shortened into another', async () => {
        const a = await boot({gameId: 'join-test', sessionId: '7A', teamId: `runtime-${'x'.repeat(40)}-1`});
        const b = await boot({gameId: 'join-test', sessionId: '7A', teamId: `runtime-${'x'.repeat(40)}-2`});
        expect(a.teamId).not.toBe(b.teamId);
    });

    it('Restart forgets the player, so the next child on the tablet is asked', async () => {
        savePlayer('7A', 'join-test', {id: mintPlayerId(), name: 'Anička', avatar: 'unicorn'});
        const game = await boot({gameId: 'join-test', sessionId: '7A'});
        game.restart = vi.fn();                                     // the real one reloads the page
        document.querySelector('[data-boot="restart"]').click();
        expect(loadPlayer('7A', 'join-test')).toBeNull();
        expect(game.restart).toHaveBeenCalledOnce();
    });

    it('the name and the animal are what the teacher sees', async () => {
        const sent = [];
        const booting = boot({
            gameId: 'join-test', sessionId: '7A',
            report: {enabled: true, send: (wire) => { sent.push(wire); }},
        });
        await answer('Anička', 'unicorn');
        const game = await booting;
        game.reporter.flush();
        expect(sent.at(-1)).toMatchObject({session: '7A', playerId: game.teamId, player: 'Anička', avatar: 'unicorn'});
    });

    it('two pupils with the same name are two players', async () => {
        const one = boot({gameId: 'join-test', sessionId: '7A'});
        await answer('Anička', 'fox');
        const first = await one;
        localStorage.removeItem('player:7A:join-test');                  // the second tablet
        const two = boot({gameId: 'join-test', sessionId: '7A'});
        await answer('Anička', 'cat');
        const second = await two;
        expect(first.playerName).toBe(second.playerName);
        expect(first.teamId).not.toBe(second.teamId);
    });
});

describe('a host that hands out the player (hosted runtime)', () => {
    const until = (fn) => vi.waitFor(() => {
        const v = fn();
        if (!v) throw new Error('not yet');
        return v;
    });

    it('the engine asks, the host registers and its id is the player; a reload does not register again', async () => {
        const register = vi.fn(async () => ({playerId: 'p-host-0123456789'}));
        const booting = boot({gameId: 'join-test', baseUrl: './g/', sessionId: 'L1', join: {register}});
        await answer('Modrý tygr', 'tiger');
        const game = await booting;
        expect(register).toHaveBeenCalledWith({name: 'Modrý tygr', avatar: 'tiger', key: expect.stringMatching(/^p-/)});
        expect(game.teamId).toBe('p-host-0123456789');
        expect(loadPlayer('L1', 'join-test')).toEqual({id: 'p-host-0123456789', name: 'Modrý tygr', avatar: 'tiger'});

        document.body.innerHTML = '';
        const again = vi.fn();
        const reloaded = await boot({gameId: 'join-test', baseUrl: './g/', sessionId: 'L1', join: {register: again}});
        expect(again).not.toHaveBeenCalled();
        expect(reloaded.teamId).toBe('p-host-0123456789');
    });

    it('a refusal is shown on the same screen with the answer kept; the next try can succeed', async () => {
        const register = vi.fn()
            .mockResolvedValueOnce({error: 'Hodina je plná. Řekni to učiteli.'})
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce({playerId: 'not-an-engine-id'})
            .mockResolvedValueOnce({playerId: 'p-host-9876543210'});
        const booting = boot({gameId: 'join-test', baseUrl: './g/', sessionId: 'L2', join: {register}});
        await answer('Liška', 'fox');
        const error1 = await until(() => document.querySelector('.join-error'));
        expect(error1.textContent).toBe('Hodina je plná. Řekni to učiteli.');
        expect(error1.getAttribute('role')).toBe('alert');
        // Kept: the pupil only presses Hrát again.
        expect(document.querySelector('.join-name').value).toBe('Liška');
        expect(document.querySelector('.join-avatar[data-avatar="fox"]').getAttribute('aria-checked')).toBe('true');
        expect(document.querySelector('.join-play').disabled).toBe(false);

        document.querySelector('.join-play').click();                                     // offline
        await until(() => register.mock.calls.length === 2 && document.querySelector('.join-error')?.textContent.includes('nepovedlo'));
        document.querySelector('.join-play').click();                                     // bad id
        await until(() => register.mock.calls.length === 3 && document.querySelector('.join-error'));
        document.querySelector('.join-play').click();                                     // ok
        const game = await booting;
        expect(game.teamId).toBe('p-host-9876543210');
        expect(document.querySelector('.join-overlay')).toBeNull();
    });

    it('a host can keep everything in sessionStorage, so nothing outlives the tab', async () => {
        sessionStorage.clear();
        const booting = boot({
            gameId: 'join-test', baseUrl: './g/', sessionId: 'L3', webStorage: sessionStorage,
            join: {register: async () => ({playerId: 'p-host-session-0001'})},
        });
        await answer('Sova', 'owl');
        const game = await booting;
        game._saveState();
        const keys = (st) => Array.from({length: st.length}, (_, i) => st.key(i)).sort();
        expect(keys(localStorage)).toEqual([]);
        expect(keys(sessionStorage)).toEqual([
            'join:player:L3:join-test',
            'player:L3:join-test',
            `state:L3:join-test:${encodeURIComponent('p-host-session-0001')}`,
        ]);
        expect(loadPlayer('L3', 'join-test', sessionStorage)?.id).toBe('p-host-session-0001');
    });

    it('restart: false leaves no Restart button for a pupil in a lesson', async () => {
        await boot({gameId: 'join-test', baseUrl: './g/', restart: false});
        expect(document.querySelector('[data-boot="restart"]')).toBeNull();
        document.body.innerHTML = '';
        await boot({gameId: 'join-test', baseUrl: './g/'});
        expect(document.querySelector('[data-boot="restart"]')).not.toBeNull();
    });

    it('the screen suggests a nickname and says what the teacher sees', async () => {
        const booting = boot({gameId: 'join-test', baseUrl: './g/', sessionId: 'L4'});
        const overlay = await until(() => document.querySelector('.join-overlay'));
        expect(overlay.querySelector('.join-name').placeholder).toBe('např. Modrý tygr');
        expect(overlay.querySelector('.join-hint').textContent).toContain('Stačí přezdívka');
        await answer('Koala', 'koala');
        await booting;
    });

    it('a host that does not answer counts as a failure, and every attempt carries the same key', async () => {
        const register = vi.fn()
            .mockReturnValueOnce(new Promise(() => {}))                // hangs
            .mockResolvedValueOnce({playerId: 'p-host-late-000001'});
        const booting = boot({gameId: 'join-test', baseUrl: './g/', sessionId: 'L5', join: {register, timeoutMs: 30}});
        await answer('Želva', 'turtle');
        const error = await until(() => document.querySelector('.join-error'));
        expect(error.textContent).toContain('nepovedlo');
        document.querySelector('.join-play').click();
        const game = await booting;
        expect(game.teamId).toBe('p-host-late-000001');
        const [first, second] = register.mock.calls.map(c => c[0].key);
        expect(first).toMatch(/^p-/);
        expect(second).toBe(first);
    });

    it('a reload during registration registers again with the same key', async () => {
        const hanging = vi.fn(() => new Promise(() => {}));
        boot({gameId: 'join-test', baseUrl: './g/', sessionId: 'L6', join: {register: hanging}});
        await answer('Kočka', 'cat');
        await until(() => hanging.mock.calls.length === 1);

        document.body.innerHTML = '';                                   // the reload
        const register = vi.fn(async () => ({playerId: 'p-host-same-000001'}));
        const booting = boot({gameId: 'join-test', baseUrl: './g/', sessionId: 'L6', join: {register}});
        await answer('Kočka', 'cat');
        await booting;
        expect(register.mock.calls[0][0].key).toBe(hanging.mock.calls[0][0].key);
    });

    it('a browser that refuses even to hand out localStorage still starts the game', async () => {
        const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
        Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); }});
        try {
            const local = await boot({gameId: 'join-test', baseUrl: './g/'});
            expect(local.state.scene).toBe('room');
            document.body.innerHTML = '';
            const booting = boot({
                gameId: 'join-test', baseUrl: './g/', sessionId: 'L7', webStorage: sessionStorage,
                join: {register: async () => ({playerId: 'p-host-private-0001'})},
            });
            await answer('Tučňák', 'penguin');
            expect((await booting).teamId).toBe('p-host-private-0001');
        } finally {
            Object.defineProperty(globalThis, 'localStorage', real);
        }
    });

    it('a run kept in sessionStorage leaves the old localStorage entry alone', async () => {
        localStorage.setItem('leeuwenhoek_escape_state', JSON.stringify({signature: 'join-test|1', scene: 'room'}));
        sessionStorage.clear();
        await boot({gameId: 'join-test', baseUrl: './g/', webStorage: sessionStorage});
        expect(localStorage.getItem('leeuwenhoek_escape_state')).not.toBeNull();
    });
});
