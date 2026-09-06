// Regression test for EI-005.
//
// `?reset=1` was read on every start and never removed from the URL, so a
// reload in the middle of a lesson wiped the team's progress. Every demo link
// in the README carries the parameter, so this was the normal case, not an edge
// one.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Game } from '../../engine/engine.js';

const SCENES = {
    meta: { id: 'reset-test', name: 'Reset Test' },
    items: [],
    scenes: [
        { id: 'room', title: 'Místnost', image: 'scenes/room.jpg', hotspots: [] },
        { id: 'exit', title: 'Konec', image: 'scenes/exit.jpg', end: true },
    ],
    startScene: 'room',
};

function mountDom() {
    document.body.innerHTML = `
    <main id="gameRoot">
      <div id="sceneContainer">
        <img id="sceneImage" alt="scene">
        <div id="hotspotLayer"></div>
      </div>
      <section id="uiBar"><div id="inventory"></div><div id="msg"></div></section>
    </main>
    <div id="modal" class="hidden">
      <div class="modal-content">
        <div id="modalTitle" class="modal-title"></div>
        <div id="modalBody" class="modal-body"></div>
        <div class="modal-actions">
          <button id="modalCancel">Zrušit</button><button id="modalOk">OK</button>
        </div>
      </div>
    </div>`;
}

const newGame = () => new Game({
    baseUrl: './games/reset-test/',
    scenesUrl: './games/reset-test/scenes.json',
    lang: 'cs',
    i18n: { engine: {}, game: {} },
    sceneImage: document.getElementById('sceneImage'),
    hotspotLayer: document.getElementById('hotspotLayer'),
    inventoryRoot: document.getElementById('inventory'),
    messageBox: document.getElementById('msg'),
    modalRoot: document.getElementById('modal'),
    modalTitle: document.getElementById('modalTitle'),
    modalBody: document.getElementById('modalBody'),
    modalCancel: document.getElementById('modalCancel'),
    modalOk: document.getElementById('modalOk'),
});

describe('reset=1 handling', () => {
    beforeEach(() => {
        mountDom();
        localStorage.clear();
        history.replaceState(null, '', '/');
        vi.stubGlobal('fetch', async (url) => (
            String(url).endsWith('scenes.json')
                ? { ok: true, json: async () => SCENES }
                : { ok: true, json: async () => ({}) }
        ));
    });

    it('removes the parameter from the URL after using it once', async () => {
        history.replaceState(null, '', '/?reset=1&game=reset-test');

        await newGame().init();

        const params = new URLSearchParams(location.search);
        expect(params.get('reset')).toBeNull();
        // Anything else in the query has to survive: the runtime will put the
        // game and later the session there.
        expect(params.get('game')).toBe('reset-test');
    });

    it('writes the fresh start down straight away', async () => {
        // A reset that is only in memory is not a reset. init() does not clear
        // storage, it ignores what is there and builds a fresh state, so until
        // something writes that state down the old lesson is still the one on
        // disk: a teacher's reset link followed by a reload with nothing tapped
        // in between would hand the team back the game they had just left.
        //
        // This used to work by accident, because hero initialisation always
        // saved. It stopped applying to the five games that define no heroes
        // when EI-015 removed the invented one, so init() now saves explicitly.
        const first = newGame();
        await first.init();
        await first.goto('exit');

        mountDom();
        history.replaceState(null, '', '/?reset=1');
        await newGame().init();

        mountDom();
        history.replaceState(null, '', '/');
        const afterReload = newGame();
        await afterReload.init();

        expect(afterReload.state.scene).toBe('room');
    });

    it('does not wipe progress on a reload that follows a reset', async () => {
        history.replaceState(null, '', '/?reset=1');

        // First start consumes the reset and the team plays on.
        const game = newGame();
        await game.init();
        await game.goto('exit');
        expect(game.state.scene).toBe('exit');

        // Reload. The URL is whatever the address bar holds now, which is the
        // whole point: before the fix it still said reset=1.
        mountDom();
        const again = newGame();
        await again.init();
        expect(again.state.scene).toBe('exit');
    });
});
