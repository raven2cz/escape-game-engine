import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Game } from '../../engine/engine.js';

function mountDom() {
    document.body.innerHTML = `
    <main id="gameRoot">
      <div id="sceneContainer">
        <img id="sceneImage" alt="scene">
        <div id="hotspotLayer"></div>
      </div>
      <section id="uiBar">
        <div id="inventory"></div>
        <div id="msg"></div>
      </section>
      <div id="modal" class="hidden">
        <div id="modalTitle"></div>
        <div id="modalBody"></div>
        <button id="modalCancel">X</button>
        <button id="modalOk">OK</button>
      </div>
    </main>`;
}

describe('Engine: Hotspot States', () => {
    beforeEach(() => {
        mountDom();
    });

    it('renders default state when no flags match', () => {
        const game = new Game({
            baseUrl: './', scenesUrl: 's.json', lang: 'cs',
            i18n: { engine:{}, game:{} },
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

        game.state = { flags: {} };
        game.currentScene = {
            hotspots: [
                {
                    rect: { x: 10, y: 10, w: 10, h: 10 },
                    states: [
                        {
                            requireFlags: ['solved'],
                            cssClass: 'state-success',
                            content: 'OK'
                        }
                    ]
                }
            ]
        };

        game._renderHotspots();

        const el = document.querySelector('.hotspot');
        expect(el).toBeTruthy();
        // Flag 'solved' is missing, so class should NOT be there
        expect(el.classList.contains('state-success')).toBe(false);
        expect(el.textContent).not.toContain('OK');
    });

    it('applies state when flags match (priority list)', () => {
        const game = new Game({
            baseUrl: './', scenesUrl: 's.json', lang: 'cs',
            i18n: { engine:{}, game:{} },
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

        game.state = { flags: { 'solved': true } };
        game.currentScene = {
            hotspots: [
                {
                    rect: { x: 10, y: 10, w: 10, h: 10 },
                    states: [
                        {
                            requireFlags: ['solved'],
                            cssClass: 'state-success',
                            content: 'DONE'
                        }
                    ]
                }
            ]
        };

        game._renderHotspots();

        const el = document.querySelector('.hotspot');
        expect(el.classList.contains('state-success')).toBe(true);
        expect(el.querySelector('.hs-content').textContent).toBe('DONE');
    });
});
