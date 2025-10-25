import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Game } from '../../engine/engine.js';

// Minimal DOM skeleton matching index.html parts the engine expects.
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

// Scenes fixture: room with (1) dumb hotspot (no acceptItems), (2) door requiring golden_key,
// and an exit scene to navigate to on success.
const SCENES_FIXTURE = {
    meta: { id: 'use-test', name: 'Use Mode Test' },
    items: [
        { id: 'golden_key', label: 'Zlatý klíč', icon: 'items/golden_key.png' }
    ],
    scenes: [
        {
            id: 'room',
            title: 'Místnost',
            image: 'scenes/room.jpg',
            hotspots: [
                {
                    // Wrong target for using items: it doesn't accept anything
                    type: 'goTo',
                    target: 'room', // no-op to stay
                    rect: { x: 5, y: 5, w: 10, h: 10 }
                },
                {
                    // Correct target: accepts golden_key and goes to exit
                    type: 'goTo',
                    target: 'exit',
                    rect: { x: 20, y: 5, w: 10, h: 10 },
                    acceptItems: [{ id: 'golden_key', consume: false }],
                    onApply: { message: 'Dveře se odemkly.', goTo: 'exit' }
                }
            ]
        },
        {
            id: 'exit',
            title: 'Hotovo',
            image: 'scenes/exit.jpg',
            end: true
        }
    ],
    startScene: 'room',
    settings: {
        hints: { acceptNeed: true }
    }
};

// Helper to get all current toasts text (engine renders them into .toast-container)
function getToastsText() {
    const cont = document.querySelector('.toast-container');
    if (!cont) return '';
    return Array.from(cont.querySelectorAll('.toast'))
        .map(n => n.textContent.trim())
        .join(' | ');
}

describe('Use-mode flow', () => {
    beforeEach(() => {
        mountDom();
        localStorage.clear();

        // Stub fetch for scenes.json
        vi.stubGlobal('fetch', async (url) => {
            if (String(url).endsWith('scenes.json')) {
                return { ok: true, json: async () => SCENES_FIXTURE };
            }
            return { ok: true, json: async () => ({}) };
        });

        // Make <img> "load" instantly with valid dimensions
        Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
            get() { return 1920; }
        });
        Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
            get() { return 1080; }
        });
        Object.defineProperty(HTMLImageElement.prototype, 'src', {
            set(v) {
                this.setAttribute('src', v);
                setTimeout(() => this.onload && this.onload(), 0);
            },
            get() { return this.getAttribute('src'); }
        });
    });

    it('selects item, rejects wrong hotspot (toast + exit use), applies on correct hotspot (goTo exit), and supports ESC/toggle-off', async () => {
        const game = new Game({
            baseUrl: './games/use-test/',
            scenesUrl: './games/use-test/scenes.json',
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

        // Give player the golden key directly (simulate pickup) and re-render inventory
        game.state.inventory.push('golden_key');
        game._renderInventory();

        // Open the item and press "Use" via API shortcut (enterUseMode),
        // we don't open modal in test to keep it simple.
        game.enterUseMode('golden_key');
        expect(game.state.useItemId).toBe('golden_key');
        // Selected class present
        expect(document.querySelector('#inventory .item.selected')).toBeTruthy();

        // Click WRONG hotspot (index 0) -> should toast "not applicable" and exit use mode
        const hs = document.querySelectorAll('#hotspotLayer .hotspot');
        expect(hs.length).toBe(2);
        hs[0].click();

        // use-mode off
        expect(game.state.useItemId).toBe(null);
        // toast mentions not applicable (CS)
        expect(getToastsText()).toMatch(/nelze použít/i);

        // Re-enter use mode again
        game.enterUseMode('golden_key');
        expect(game.state.useItemId).toBe('golden_key');

        // Click CORRECT hotspot (index 1) -> onApply -> goTo exit
        hs[1].click();

        // After apply, use-mode should be off and scene should change to "exit"
        expect(game.state.useItemId).toBe(null);
        expect(game.state.scene).toBe('exit');

        // ESC cancels use-mode
        // Re-enter use mode and send Escape
        await game.goto('room');
        game.enterUseMode('golden_key');
        expect(game.state.useItemId).toBe('golden_key');

        const ev = new KeyboardEvent('keydown', { key: 'Escape' });
        document.dispatchEvent(ev);
        expect(game.state.useItemId).toBe(null);

        // Toggle-off by clicking the same item again
        // First enter use mode via inspect shortcut:
        game.enterUseMode('golden_key');
        expect(game.state.useItemId).toBe('golden_key');

        // Click the selected inventory item -> should exit use mode (no modal)
        const invItem = document.querySelector('#inventory .item');
        invItem.click();
        expect(game.state.useItemId).toBe(null);
    });
});
