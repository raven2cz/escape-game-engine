// games/tests/dialogs.test.js
// Dialogs integration tests (Vitest + JSDOM)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Game } from '../../engine/engine.js';

// --- DOM scaffold matching engine needs ---
function buildDom() {
    const sceneImage = document.createElement('img');
    sceneImage.id = 'sceneImage';

    // Make the image look already loaded so engine.goto() doesn't await onload forever
    Object.defineProperty(sceneImage, 'naturalWidth',  { value: 1600, configurable: true });
    Object.defineProperty(sceneImage, 'naturalHeight', { value: 900,  configurable: true });
    Object.defineProperty(sceneImage, 'complete',      { value: true, configurable: true });

    const hotspotLayer = document.createElement('div');
    hotspotLayer.id = 'hotspotLayer';
    hotspotLayer.style.position = 'relative';
    hotspotLayer.style.width = '1000px';
    hotspotLayer.style.height = '562px'; // ~16:9

    const inventory = document.createElement('div'); inventory.id = 'inventory';
    const msg = document.createElement('div'); msg.id = 'msg';

    const modal = document.createElement('div'); modal.id = 'modal';
    const modalTitle = document.createElement('div'); modalTitle.id = 'modalTitle';
    const modalBody = document.createElement('div'); modalBody.id = 'modalBody';
    const modalCancel = document.createElement('button'); modalCancel.id = 'modalCancel';
    const modalOk = document.createElement('button'); modalOk.id = 'modalOk';

    const root = document.createElement('div');
    root.appendChild(sceneImage);
    root.appendChild(hotspotLayer);
    root.appendChild(inventory);
    root.appendChild(msg);
    root.appendChild(modal);
    modal.appendChild(modalTitle);
    modal.appendChild(modalBody);
    modal.appendChild(modalCancel);
    modal.appendChild(modalOk);
    document.body.appendChild(root);

    return {
        sceneImage,
        hotspotLayer,
        inventoryRoot: inventory,
        messageBox: msg,
        modalRoot: modal,
        modalTitle,
        modalBody,
        modalCancel,
        modalOk,
    };
}

// --- Small helper to mimic fetch(JSON) ---
function makeJsonResponse(obj) {
    return {
        ok: true,
        status: 200,
        json: async () => obj,
    };
}

describe('Dialogs integration', () => {
    let fetchCalls;

    beforeEach(() => {
        fetchCalls = [];

        // Mock fetch for scenes.json & dialogs.json
        global.fetch = vi.fn(async (url) => {
            fetchCalls.push(String(url));

            if (String(url).includes('/scenes.json')) {
                // Minimal scenes: welcome triggers openDialog; room has dialog hotspot
                return makeJsonResponse({
                    meta: { id: 'test', languages: ['cs'] },
                    items: [],
                    scenes: [
                        {
                            id: 'welcome',
                            title: 'Welcome',
                            image: 'http://x/assets/welcome.jpg',
                            hotspots: [],
                        },
                        {
                            id: 'room',
                            title: 'Room',
                            image: 'http://x/assets/room.jpg',
                            hotspots: [
                                {
                                    type: 'dialog',
                                    dialogId: 'npc.greeter',
                                    rect: { x: 10, y: 10, w: 20, h: 20 },
                                },
                            ],
                        },
                    ],
                    events: [
                        {
                            id: 'e1',
                            once: true,
                            when: { on: 'enterScene', scene: 'welcome' },
                            then: { openDialog: 'intro.welcome' },
                        },
                    ],
                    startScene: 'welcome',
                });
            }

            if (String(url).includes('/dialogs.json')) {
                return makeJsonResponse({
                    characters: [
                        { id: 'npc1', name: 'NPC', images: { neutral: 'http://x/c.png' } },
                    ],
                    dialogs: [
                        { id: 'intro.welcome', steps: [{ who: 'npc1', say: 'Hi!' }] },
                        { id: 'npc.greeter', steps: [{ who: 'npc1', say: 'Hello!' }] },
                    ],
                });
            }

            // Any other JSON (not used here)
            return makeJsonResponse({});
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        document.body.innerHTML = '';
        document.body.className = ''; // remove e.g. 'editor-on', 'use-on'
    });

    it('opens dialog via events.then.openDialog on enterScene', async () => {
        const dom = buildDom();

        const openCalls = [];
        const game = new Game({
            baseUrl: 'http://x/game/',
            scenesUrl: 'http://x/game/scenes.json',
            dialogsUrl: 'http://x/game/dialogs.json',
            lang: 'cs',
            i18n: { engine: {}, game: {} },
            ...dom,
        });

        // Stub dialogUI.open() to capture call
        game.dialogUI = {
            open: vi.fn(async (id) => { openCalls.push(id); }),
        };

        await game.init();

        expect(openCalls).toContain('intro.welcome');

        const scenesFetches = fetchCalls.filter(u => u.includes('/scenes.json'));
        const dialogFetches = fetchCalls.filter(u => u.includes('/dialogs.json'));
        expect(scenesFetches).toHaveLength(1);
        expect(dialogFetches).toHaveLength(1); // lazy-loaded exactly once
    });

    it('opens dialog by clicking a dialog hotspot', async () => {
        const dom = buildDom();

        const openCalls = [];
        const game = new Game({
            baseUrl: 'http://x/game/',
            scenesUrl: 'http://x/game/scenes.json',
            dialogsUrl: 'http://x/game/dialogs.json',
            lang: 'cs',
            i18n: { engine: {}, game: {} },
            ...dom,
        });

        game.dialogUI = {
            open: vi.fn(async (id) => { openCalls.push(id); }),
        };

        await game.init();
        await game.goto('room');

        // Ensure nothing blocks clicks (no editor mode)
        document.body.classList.remove('editor-on');

        const btn = dom.hotspotLayer.querySelector('.hotspot[data-index="0"]');
        expect(btn).toBeTruthy();

        async function waitUntil(fn, { timeout = 1000, interval = 10 } = {}) {
            const t0 = Date.now();
            // eslint-disable-next-line no-constant-condition
            while (true) {
                try {
                    fn();
                    return; // assertion prošla
                } catch (e) {
                    if (Date.now() - t0 > timeout) throw e;
                    await new Promise(r => setTimeout(r, interval));
                }
            }
        }

        btn.click();

        await waitUntil(() => {
            expect(openCalls).toContain('npc.greeter');
        });

        const dialogFetches = fetchCalls.filter(u => u.includes('/dialogs.json'));
        expect(dialogFetches.length).toBeLessThanOrEqual(1); // cached
    });
});
