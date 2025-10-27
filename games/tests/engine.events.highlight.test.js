import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Game } from '../../engine/engine.js';

function mountDom() {
  document.body.innerHTML = `
    <main id="gameRoot">
      <div id="sceneContainer" style="width:1000px;height:500px;position:relative;">
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
}

const SCENES = {
  meta: { id:'test', version:'1.0' },
  heroes: { adam:{ id:'adam', name:'Adam' } },
  defaultHero: 'adam',
  scenes: [
    {
      id: 'a',
      title: 'A',
      image: 'a.jpg',
      hotspots: [ { type:'dialog', dialogId:'x', rect: { x:10, y:10, w:10, h:10 } } ]
    },
    { id: 'b', title: 'B', image: 'b.jpg', hotspots: [] }
  ],
  startScene: 'a',
  events: [
    { id:'hl-a', when: { on:'enterScene', scene:'a' }, then: { highlightHotspot: { sceneId:'a', rect:{ x:10, y:10, w:10, h:10 }, ms:3000 } } },
    { id:'toast-b', when: { on:'enterScene', scene:'b' }, then: { toast: { text: 'Hi' } } },
  ]
};

describe('Events: highlightHotspot + enterScene order', () => {
  beforeEach(() => {
    mountDom();
    localStorage.clear();
    vi.stubGlobal('fetch', async (url) => {
      if (String(url).endsWith('scenes.json')) return { ok:true, json: async () => SCENES };
      if (String(url).endsWith('dialogs.json')) return { ok:true, json: async () => ({ dialogs:[], characters:[] }) };
      return { ok:true, json: async () => ({}) };
    });
  });

  it('shows highlight box after scene image loads, and events run on enter', async () => {
    const game = new Game({
      baseUrl: './games/test/',
      scenesUrl: './games/test/scenes.json',
      dialogsUrl: './games/test/dialogs.json',
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
    await new Promise(r => setTimeout(r, 50)); // allow highlight to render

    
    // If not yet present, wait a bit more (CI timing guard)
    if (!document.querySelector('.hs-glow')) {
      await new Promise(r => setTimeout(r, 30));
    }
    
    // highlight rect should appear
    const glow = document.querySelector('.hs-glow');
    expect(glow).toBeTruthy();
    // style set in px (rect conversion)
    expect(glow.style.left).toBeTruthy();

    // navigate to B: event toast should be queued
    await game.goto('b');
    // Toasts rendered into .toast-container → assert container exists
    const tc = document.querySelector('.toast-container');
    expect(tc).toBeTruthy();
  });
});
