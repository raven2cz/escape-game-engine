import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Game } from '../../engine/engine.js';

function mountDom() {
  document.body.innerHTML = `
    <main id="gameRoot">
      <div id="sceneContainer">
        <img id="sceneImage" alt="scene">
        <div id="hotspotLayer" style="width:1000px;height:500px;"></div>
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
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { get() { return 800; } });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { get() { return 600; } });
  Object.defineProperty(HTMLImageElement.prototype, 'complete', { get() { return true; } });
}

const SCENES = {
  meta: { id: 'test', version: '1.2.3' },
  heroes: { adam:{ id:'adam', name:'Adam' } },
  defaultHero: 'adam',
  scenes: [
    { id:'room', title:'t', image:'scenes/room.jpg', hotspots:[] },
    { id:'room2', title:'t', image:'scenes/room2.jpg', hotspots:[] },
  ],
  startScene: 'room'
};

describe('Engine helpers: _resolveAsset + persistence signature', () => {
  beforeEach(() => {
    mountDom();
    localStorage.clear();
    vi.stubGlobal('fetch', async (url) => {
      if (String(url).endsWith('scenes.json')) {
        return { ok:true, json: async () => SCENES };
      }
      return { ok:true, json: async () => ({}) };
    });
  });

  it('_resolveAsset respects baseUrl and absolute/relative paths', async () => {
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
    expect(game._resolveAsset('img.png')).toBe('./games/test/img.png');
    expect(game._resolveAsset('./img.png')).toBe('./img.png');
    expect(game._resolveAsset('/x/img.png')).toBe('/x/img.png');
    expect(game._resolveAsset('https://cdn/x.png')).toBe('https://cdn/x.png');
  });

  it('reuses saved state only when signature (game|version|lang) matches', async () => {
    // First run: create save
    const gameA = new Game({
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
    await gameA.init();
    gameA.state.inventory.push('golden_key');
    gameA.state.scene = 'room2';
    gameA._saveState();

    // Second run, same signature → loads
    const gameB = new Game({
      baseUrl: './games/test/',
      scenesUrl: './games/test/scenes.json',
      dialogsUrl: './games/test/dialogs.json',
      lang: 'cs', // same lang
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
    await gameB.init();
    expect(gameB.state.inventory.includes('golden_key')).toBe(true);
    expect(gameB.state.scene).toBe('room2');

    // Third run, different lang → signature mismatch → fresh state
    const gameC = new Game({
      baseUrl: './games/test/',
      scenesUrl: './games/test/scenes.json',
      dialogsUrl: './games/test/dialogs.json',
      lang: 'en', // changed
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
    await gameC.init();
    expect(gameC.state.inventory.includes('golden_key')).toBe(false);
    expect(gameC.state.scene).toBe('room'); // startScene
  });
});
