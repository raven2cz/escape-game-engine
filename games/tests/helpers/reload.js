// games/tests/helpers/reload.js
//
// A page reload, from the engine's point of view, is one thing: everything held
// in memory is gone and localStorage is not. Most of the defects in
// plans/OPEN-ITEMS.md only exist across that boundary, and until now there was
// no way to express one in a test.
//
// The rule this helper exists to enforce is in step 3 below. If any object from
// the first run reaches the second one, the harness will happily pass a test
// that a real reload would fail, which is exactly the bug class being tested.
// Three things could carry over, and all three are cut here:
//
//   1. the game data. `setSceneImage` mutates `this.data` in place (EI-006), so
//      a shared fixture object would make the change look persisted when it is
//      only remembered. Every boot gets its own deep copy.
//   2. the DOM. A leftover `sceneImage.src` or a rendered hotspot layer would
//      answer questions the new Game never actually answered. Every boot builds
//      the skeleton from scratch.
//   3. the Game instance and its state. A new Game is constructed and reads
//      nothing but what `_saveState()` wrote.
//
// What is deliberately *not* torn down: listeners the engine attaches to
// `document` and `window` (the Escape handler in the Game constructor, the
// resize handler in DialogUI). The engine has no teardown API and adding one is
// outside the scope of these fixes. They cannot affect an assertion, because
// the retired Game's overlay is detached with the old body and its Escape
// handler is a no-op unless a test dispatches Escape itself.

import { vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Game } from '../../../engine/engine.js';

/** The nodes index.html provides and the engine expects to find. */
export const GAME_DOM = `
    <main id="gameRoot">
      <div id="sceneContainer">
        <img id="sceneImage" alt="scene">
        <div id="hotspotLayer"></div>
        <div id="editorOverlay" class="hidden"></div>
      </div>
      <section id="uiBar">
        <div id="inventory"></div>
        <div id="msg"></div>
      </section>
    </main>
    <div id="modal" class="hidden">
      <div class="modal-content">
        <div id="modalTitle" class="modal-title"></div>
        <div id="modalBody" class="modal-body"></div>
        <div class="modal-actions">
          <button id="modalCancel">Zrušit</button>
          <button id="modalOk">OK</button>
        </div>
      </div>
    </div>`;

/** Replace the document body with a fresh skeleton and return the engine's DOM refs. */
export function mountDom() {
    document.body.innerHTML = GAME_DOM;
    return domRefs();
}

function domRefs() {
    return {
        sceneImage: document.getElementById('sceneImage'),
        hotspotLayer: document.getElementById('hotspotLayer'),
        inventoryRoot: document.getElementById('inventory'),
        messageBox: document.getElementById('msg'),
        modalRoot: document.getElementById('modal'),
        modalTitle: document.getElementById('modalTitle'),
        modalBody: document.getElementById('modalBody'),
        modalCancel: document.getElementById('modalCancel'),
        modalOk: document.getElementById('modalOk'),
    };
}

const deepCopy = (value) =>
    (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/**
 * Read the real data files of a shipped game, for regression tests that have to
 * name the game they protect.
 * @param {string} gameId directory name under games/
 */
export function loadGameFixtures(gameId) {
    const dir = join(process.cwd(), 'games', gameId);
    const read = (file) => {
        try {
            return JSON.parse(readFileSync(join(dir, file), 'utf8'));
        } catch {
            return null;
        }
    };
    return {
        scenes: read('scenes.json'),
        dialogs: read('dialogs.json'),
        puzzles: read('puzzles.json'),
    };
}

/**
 * Wait until `predicate` returns something truthy, or fail.
 * Used to stop at a point mid-run (a dialog on screen, say) that no promise
 * exposes, because the promise is precisely the one that never settles.
 */
export async function waitFor(predicate, { timeout = 1000, label = 'condition' } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
        const value = predicate();
        if (value) return value;
        if (Date.now() > deadline) throw new Error(`waitFor timed out waiting for ${label}`);
        await new Promise(res => setTimeout(res, 5));
    }
}

/**
 * @param {{scenes: object, dialogs?: object, puzzles?: object, files?: object}} fixtures
 *        Game data as plain objects. Copied on every fetch, never handed out.
 * @param {{baseUrl?: string, lang?: string, i18n?: object}} [options]
 */
export function createReloadHarness(fixtures, options = {}) {
    const baseUrl = options.baseUrl ?? './games/test/';
    const files = {
        'scenes.json': fixtures.scenes,
        ...(fixtures.dialogs ? { 'dialogs.json': fixtures.dialogs } : {}),
        ...(fixtures.puzzles ? { 'puzzles.json': fixtures.puzzles } : {}),
        ...(fixtures.files || {}),
    };

    let previous = null;
    let boots = 0;

    const installFetch = () => {
        vi.stubGlobal('fetch', async (url) => {
            const name = String(url).split('?')[0].split('/').pop();
            if (Object.prototype.hasOwnProperty.call(files, name)) {
                return { ok: true, status: 200, json: async () => deepCopy(files[name]) };
            }
            return { ok: false, status: 404, json: async () => ({}) };
        });
    };

    /** Build a Game the way index.html does, on a DOM and a data copy of its own. */
    const construct = (overrides = {}) => {
        mountDom();
        installFetch();

        const game = new Game({
            baseUrl,
            scenesUrl: baseUrl + 'scenes.json',
            dialogsUrl: files['dialogs.json'] ? baseUrl + 'dialogs.json' : null,
            lang: overrides.lang ?? options.lang ?? 'cs',
            i18n: overrides.i18n ?? options.i18n ?? { engine: {}, game: {} },
            ...domRefs(),
            ...(overrides.gameOpts || {}),
        });

        if (previous && previous.data && game.data && previous.data === game.data) {
            throw new Error('reload harness: the new Game shares its data with the retired one');
        }
        previous = game;
        boots++;
        return game;
    };

    return {
        /** Fresh Game, initialised. Everything from the previous one is gone. */
        async boot(overrides) {
            const game = construct(overrides);
            await game.init();
            return game;
        },

        /**
         * Fresh Game whose init() is started but not awaited, for stopping the
         * run at a point where the engine is blocked on the player. `ready`
         * settles when init() finishes, which for an interrupted run is never.
         */
        bootDetached(overrides) {
            const game = construct(overrides);
            const ready = game.init();
            // Nothing may await `ready` in an interrupted run, so keep node from
            // reporting it as an unhandled rejection if the run is abandoned.
            ready.catch(() => {});
            return { game, ready };
        },

        /** Same as boot(), but says out loud that this is the reload under test. */
        async reload(overrides) {
            if (!boots) throw new Error('reload harness: reload() before any boot()');
            return this.boot(overrides);
        },

        /** Fresh Game, not initialised, for tests that drive init() themselves. */
        construct,

        /** Raw persisted entries, to assert on what actually reached storage. */
        storageDump() {
            const out = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                out[key] = localStorage.getItem(key);
            }
            return out;
        },
    };
}
