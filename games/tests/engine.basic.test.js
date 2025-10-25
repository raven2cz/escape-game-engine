import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Game } from '../../engine/engine.js';

// Minimal DOM skeleton mirroring index.html nodes the engine expects.
function mountDom() {
    document.body.innerHTML = `
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
    </div>
  `;
}

const SCENES_FIXTURE = {
    meta: { id: 'test', name: 'Test Game' },
    items: [
        { id: 'note1', label: 'Note #1', icon: 'items/note1.png' }
    ],
    scenes: [
        {
            id: 's1',
            title: 'Scene One',
            image: 'scenes/scene1.jpg',
            hotspots: [
                { type: 'pickup', itemId: 'note1', rect: { x: 10, y: 10, w: 10, h: 10 } }
            ]
        }
    ],
    startScene: 's1'
};

describe('Game engine (smoke)', () => {
    beforeEach(() => {
        // Reset DOM and localStorage
        mountDom();
        localStorage.clear();

        // Stub fetch for scenes.json and for assets load checks.
        vi.stubGlobal('fetch', async (url) => {
            if (String(url).endsWith('scenes.json')) {
                return {
                    ok: true,
                    json: async () => SCENES_FIXTURE
                };
            }
            // For image fetches (not strictly needed because we don't load img via fetch),
            // return a trivial object.
            return { ok: true, json: async () => ({}) };
        });

        // Ensure images report dimensions so engine considers them "loaded".
        Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
            get() { return 1920; }
        });
        Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
            get() { return 1080; }
        });
        // Trigger load immediately on src set:
        Object.defineProperty(HTMLImageElement.prototype, 'src', {
            set(v) {
                this.setAttribute('src', v);
                // Simulate load event
                setTimeout(() => this.onload && this.onload(), 0);
            },
            get() { return this.getAttribute('src'); }
        });
    });

    it('initializes, loads scene, renders hotspot, and handles pickup', async () => {
        const game = new Game({
            baseUrl: './games/test/',
            scenesUrl: './games/test/scenes.json',
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

        await game.init();

        // Scene image set
        expect(document.getElementById('sceneImage').getAttribute('src'))
            .toBe('./games/test/' + SCENES_FIXTURE.scenes[0].image);

        // One hotspot rendered
        const hs = document.querySelectorAll('#hotspotLayer .hotspot');
        expect(hs.length).toBe(1);

        // Click hotspot -> pickup item
        hs[0].click();
        // Inventory should have the item
        const items = document.querySelectorAll('#inventory .item');
        expect(items.length).toBe(1);
        // Message updated (we don't assert exact text; just non-empty)
        expect(document.getElementById('msg').textContent.trim().length).toBeGreaterThan(0);
    });
});
