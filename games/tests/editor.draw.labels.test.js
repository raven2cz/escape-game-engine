import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Game } from '../../engine/engine.js';
import { Editor } from '../../engine/editor.js';

function mountDom() {
  document.body.innerHTML = `
    <main id="gameRoot">
      <div id="sceneContainer" style="position:relative;width:1000px;height:500px;">
        <img id="sceneImage" alt="scene">
        <div id="hotspotLayer" style="position:absolute;inset:0;"></div>
        <div id="editorOverlay" class="hidden"></div>
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

  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { get() { return 1000; } });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { get() { return 500; } });
  Object.defineProperty(HTMLImageElement.prototype, 'complete', { get() { return true; } });

  // For percent conversion
  const hs = document.getElementById('hotspotLayer');
  hs.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500 });
}

const SCENES = {
  meta: { id:'test', version:'1.0' },
  heroes: { adam:{ id:'adam', name:'Adam' } },
  defaultHero: 'adam',
  scenes: [
    {
      id:'r',
      title:'Room',
      image:'r.jpg',
      hotspots: [
        { type:'pickup', itemId:'x', rect:{ x: 10, y: 20, w: 10, h: 10 } },
        { type:'goTo',   target:'r', rect:{ x: 40, y: 50, w: 5,  h: 5  } },
      ]
    }
  ],
  startScene: 'r'
};

describe('Editor: enable/disable, draw rectangle, static labels for hotspots', () => {
  beforeEach(() => {
    mountDom();
    localStorage.clear();
    vi.stubGlobal('fetch', async (url) => {
      if (String(url).endsWith('scenes.json')) return { ok:true, json: async () => SCENES };
      return { ok:true, json: async () => ({}) };
    });
  });

  it('toggles classes and draws a box in % via pointer events; renders labels for existing hotspots', async () => {
    const game = new Game({
      baseUrl: './games/test/',
      scenesUrl: './games/test/scenes.json',
      lang: 'cs',
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
    await game.init();

    const editor = new Editor({
      game,
      overlay: document.getElementById('editorOverlay'),
      hotspotLayer: document.getElementById('hotspotLayer'),
    });

    editor.enable();
    expect(document.body.classList.contains('editor-on')).toBe(true);
    expect(document.getElementById('editorOverlay').classList.contains('hidden')).toBe(false);

    // Draw a rectangle (from 100,100 to 400,250)
    const hs = document.getElementById('hotspotLayer');
    hs.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 400, clientY: 250, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup',   { clientX: 400, clientY: 250, bubbles: true }));

    // Editor should store last rect in percentage
    expect(editor.rect).toBeTruthy();
    const r = editor.rect;
    expect(Math.round(r.x)).toBe(10);
    expect(Math.round(r.y)).toBe(20);
    expect(Math.round(r.w)).toBe(30);
    expect(Math.round(r.h)).toBe(30);

    // Static labels for hotspots rendered (class is '.hs-label' in current editor)
    const labels = document.querySelectorAll('.hs-label');
    expect(labels.length).toBeGreaterThanOrEqual(2);

    // Disable
    editor.disable();
    expect(document.body.classList.contains('editor-on')).toBe(false);
    expect(document.getElementById('editorOverlay').classList.contains('hidden')).toBe(true);
  });
});
