// boot() is the one copy of "put a game on a page".
//
// It exists because the hosted runtime must generate its own HTML - it injects
// the session, the team and the game id - so whatever index.html does inline, the
// runtime copies. The copy then stops tracking the engine, silently, and an
// engine release that changes boot never reaches production.
//
// So the thing worth testing is that boot() really owns all of it: the DOM the
// engine takes by reference, the stylesheets, the i18n, the wiring. A caller
// that has to supply any of those is a caller that will get it wrong.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { boot } from '../../engine/boot.js';

const SCENES = {
    meta: { id: 'boot-test', version: '1.0.0', saveVersion: 1 },
    startScene: 'room',
    scenes: [{ id: 'room', title: 'Místnost', image: 'scenes/room.jpg', hotspots: [], end: true }],
};

const stubFetch = (i18n = null) => vi.stubGlobal('fetch', async (url) => {
    const name = String(url).split('?')[0].split('/').pop();
    if (name === 'scenes.json') return { ok: true, json: async () => SCENES };
    if (name === 'cs.json' || name === 'en.json') {
        return i18n ? { ok: true, json: async () => i18n } : { ok: false, status: 404, json: async () => ({}) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
});

describe('boot()', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        document.head.innerHTML = '';
        localStorage.clear();
        stubFetch();
    });

    it('builds the DOM the engine needs, from nothing', async () => {
        // The caller supplies an empty page. If any of these has to come from
        // the caller, the runtime has to know about it, which is the fork.
        const game = await boot({ gameId: 'boot-test' });

        for (const id of ['sceneContainer', 'sceneImage', 'hotspotLayer', 'inventory',
                          'msg', 'modal', 'modalTitle', 'modalBody', 'modalCancel', 'modalOk']) {
            expect(document.getElementById(id), id).not.toBeNull();
        }
        expect(game.currentScene.id).toBe('room');
    });

    it('clears the loading shell it booted into', async () => {
        // The other half of EI-027. The shell's ES5 fallback decides "the engine
        // never started" by looking for #boot-status, so boot() taking the page
        // over has to remove it - and it does that by replacing the body, not by
        // knowing the element exists.
        //
        // This is here rather than in boot.shell.test.js because it is the join
        // between the two: a boot() that appended instead of replacing would
        // leave a live game with a failure message written over it ten seconds
        // in, and neither file alone would notice.
        document.body.innerHTML = '<div id="boot-status">Načítám hru…</div>';

        await boot({ gameId: 'boot-test' });

        expect(document.getElementById('boot-status')).toBeNull();
    });

    it('clears it before it awaits anything', async () => {
        // Ten seconds is generous, but a school connection can spend them on one
        // fetch. The element has to go while the page is still being set up, not
        // after the game data has arrived - otherwise the message is a race
        // against the network rather than a report that nothing ran.
        document.body.innerHTML = '<div id="boot-status">Načítám hru…</div>';

        let clearedBeforeFirstFetch = null;
        vi.stubGlobal('fetch', async (url) => {
            if (clearedBeforeFirstFetch === null) {
                clearedBeforeFirstFetch = document.getElementById('boot-status') === null;
            }
            const name = String(url).split('?')[0].split('/').pop();
            if (name === 'scenes.json') return { ok: true, json: async () => SCENES };
            return { ok: false, status: 404, json: async () => ({}) };
        });

        await boot({ gameId: 'boot-test' });

        expect(clearedBeforeFirstFetch).toBe(true);
    });

    it('passes the lesson and team identity through to the game', async () => {
        // EI-002 step two. boot() is the only path the hosted runtime has into
        // the engine, so an option it drops is an option that does not exist.
        // Asserted through the key that gets written rather than through the
        // property, because the key is what actually separates two classes.
        await boot({ gameId: 'boot-test', sessionId: 'p2', teamId: 'red' });

        expect(localStorage.getItem('state:p2:boot-test:red')).not.toBeNull();
        expect(localStorage.getItem('state:boot-test')).toBeNull();
    });

    it('keeps the old key when no identity is given', async () => {
        await boot({ gameId: 'boot-test' });

        expect(localStorage.getItem('state:boot-test')).not.toBeNull();
    });

    it('brings its own stylesheets, resolved against the engine', async () => {
        await boot({ gameId: 'boot-test' });

        const hrefs = [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => l.href);
        expect(hrefs.some(h => h.endsWith('/styles/style.css'))).toBe(true);
        expect(hrefs.some(h => h.endsWith('/styles/puzzles.css'))).toBe(true);
        expect(hrefs.some(h => h.endsWith('/styles/content.css'))).toBe(true);
        // And the game's own overrides, last so they win.
        expect(hrefs.some(h => h.includes('boot-test') && h.endsWith('game.css'))).toBe(true);
    });

    it('does not add a stylesheet twice', async () => {
        await boot({ gameId: 'boot-test' });
        await boot({ gameId: 'boot-test' });

        const style = [...document.querySelectorAll('link[rel="stylesheet"]')]
            .filter(l => l.href.endsWith('/styles/style.css'));
        expect(style).toHaveLength(1);
    });

    it('does not load the editor unless asked', async () => {
        // 53 kB a tablet has no use for, and a visible Edit button in a
        // classroom is an invitation.
        await boot({ gameId: 'boot-test' });

        const button = document.querySelector('[data-boot="editor"]');
        expect(button.classList.contains('hidden')).toBe(true);
        expect(document.getElementById('editorOverlay')).not.toBeNull();
    });

    it('offers the editor when asked', async () => {
        await boot({ gameId: 'boot-test', editor: true });

        const button = document.querySelector('[data-boot="editor"]');
        expect(button.classList.contains('hidden')).toBe(false);
        expect(button.textContent.length).toBeGreaterThan(0);
    });

    it('takes its chrome from the dictionary, not from hardcoded Czech', async () => {
        await boot({ gameId: 'boot-test', lang: 'en' });

        expect(document.querySelector('[data-boot="title"]').textContent).toBe('Escape game');
        expect(document.getElementById('modalOk').textContent).toBe('OK');
        expect(document.getElementById('modalCancel').textContent).toBe('Close');
    });

    it('lets a game override the chrome through its own i18n', async () => {
        stubFetch({ 'engine.appTitle': 'Tajná laboratoř' });
        await boot({ gameId: 'boot-test' });

        expect(document.querySelector('[data-boot="title"]').textContent).toBe('Tajná laboratoř');
    });

    it('passes an injected storage through to the engine', async () => {
        // The seam the runtime needs: it keeps the authoritative copy.
        const box = { value: null };
        const storage = {
            load: () => box.value,
            save: (s) => { box.value = JSON.parse(JSON.stringify(s)); },
            clear: () => { box.value = null; },
        };

        await boot({ gameId: 'boot-test', storage });

        expect(box.value).not.toBeNull();
        expect(box.value.signature).toBe('boot-test|1');
        expect(localStorage.length).toBe(0);
    });

    it('serves a game from wherever the runtime puts it', async () => {
        const game = await boot({ gameId: 'boot-test', baseUrl: '/g/games-2026.09.1/boot-test/' });
        expect(game.baseUrl).toBe('/g/games-2026.09.1/boot-test/');
    });

    it('refuses to start without a game', async () => {
        await expect(boot({})).rejects.toThrow(/gameId/);
    });

    it('builds into a given root rather than the body', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);

        await boot({ gameId: 'boot-test', root: host });

        expect(host.querySelector('#sceneContainer')).not.toBeNull();
    });
});

describe('boot() and a game that stops on its first dialog', () => {
    const WITH_INTRO = {
        meta: { id: 'boot-test', version: '1.0.0', saveVersion: 1 },
        startScene: 'room',
        scenes: [{ id: 'room', title: 'Místnost', image: 'scenes/room.jpg', hotspots: [], end: true }],
        events: [{
            id: 'intro',
            once: true,
            when: { on: 'enterScene', scene: 'room' },
            then: { openDialog: { id: 'hello' } },
        }],
    };
    const DIALOGS = {
        meta: { id: 'boot-test' },
        characters: [],
        dialogs: [{ id: 'hello', typewriter: false, sequence: [{ speaker: 'left', text: 'Ahoj' }] }],
    };

    beforeEach(() => {
        document.body.innerHTML = '';
        document.head.innerHTML = '';
        localStorage.clear();
        vi.stubGlobal('fetch', async (url) => {
            const name = String(url).split('?')[0].split('/').pop();
            if (name === 'scenes.json') return { ok: true, json: async () => WITH_INTRO };
            if (name === 'dialogs.json') return { ok: true, json: async () => DIALOGS };
            return { ok: false, status: 404, json: async () => ({}) };
        });
    });

    it('hands over the game before it waits for the player', async () => {
        // Most games open a dialog on their first scene, and init() does not
        // return until it is closed. Waiting for boot() to resolve would mean
        // window.__game stays undefined for as long as a pupil reads the intro,
        // which is exactly when somebody wants to look at it.
        let handedOver = null;
        const started = boot({ gameId: 'boot-test', onGame: (g) => { handedOver = g; } });

        await new Promise(res => setTimeout(res, 50));

        expect(handedOver).not.toBeNull();
        expect(handedOver.dialogUI.active?.id).toBe('hello');

        // And the promise really is still outstanding, which is the point.
        let settled = false;
        started.then(() => { settled = true; });
        await new Promise(res => setTimeout(res, 20));
        expect(settled).toBe(false);

        await handedOver.dialogUI.close();
        await started;
    });
});
