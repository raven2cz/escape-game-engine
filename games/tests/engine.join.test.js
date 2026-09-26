// "Kdo hraje?" (engine/join.js): the name and animal a pupil picks before a
// game in a lesson, which become the player the run is saved under and the name
// on the teacher's board.

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {boot} from '../../engine/boot.js';
import {askWhoPlays, cleanName, loadPlayer, savePlayer, forgetPlayer, NAME_MAX} from '../../engine/join.js';
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
        expect([...cleanName('🦊'.repeat(40))]).toHaveLength(NAME_MAX);
        expect(cleanName('   ')).toBe('');
        expect(cleanName(null)).toBe('');
    });
});

describe('remembering the player', () => {
    it('per lesson and game; forgets on request; ignores anything malformed', () => {
        savePlayer('7A', 'g', {name: 'Anička', avatar: 'fox'});
        expect(loadPlayer('7A', 'g')).toEqual({name: 'Anička', avatar: 'fox'});
        expect(loadPlayer('7B', 'g')).toBeNull();
        expect(loadPlayer('7A', 'other')).toBeNull();
        forgetPlayer('7A', 'g');
        expect(loadPlayer('7A', 'g')).toBeNull();
        localStorage.setItem('player:7A:g', JSON.stringify({name: 'X', avatar: 'dragon'}));
        expect(loadPlayer('7A', 'g')).toBeNull();
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
        expect(game.teamId).toBe('Anička');
        expect(game.avatar).toBe('unicorn');
        expect(localStorage.getItem(`state:7A:join-test:${encodeURIComponent('Anička')}`)).not.toBeNull(); // saved under the player
    });

    it('does not ask again on a reload of the same lesson', async () => {
        savePlayer('7A', 'join-test', {name: 'Anička', avatar: 'unicorn'});
        const game = await boot({gameId: 'join-test', sessionId: '7A'});
        expect(document.querySelector('.join-overlay')).toBeNull();
        expect(game.teamId).toBe('Anička');
    });

    it('does not ask outside a lesson, or when the link already names the player', async () => {
        await boot({gameId: 'join-test'});
        expect(document.querySelector('.join-overlay')).toBeNull();
        const named = await boot({gameId: 'join-test', sessionId: '7A', teamId: 'Petr'});
        expect(document.querySelector('.join-overlay')).toBeNull();
        expect(named.teamId).toBe('Petr');
    });

    it('Restart forgets the player, so the next child on the tablet is asked', async () => {
        savePlayer('7A', 'join-test', {name: 'Anička', avatar: 'unicorn'});
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
        expect(sent.at(-1)).toMatchObject({session: '7A', player: 'Anička', avatar: 'unicorn'});
    });
});
