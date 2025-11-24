import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Game } from '../../engine/engine.js';
import { DialogUI } from '../../engine/dialogs.js';

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

describe('Hero mapping in dialogs + refresh on hero change', () => {
  beforeEach(() => {
    mountDom();
  });

  it('uses hero template with token replacement; after setHero + refresh, image updates', async () => {
    // Build a Game instance with minimal i18n
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

    // Preload dialogs data directly (bypass fetch)
    game.dialogsData = {
      characters: [
        {
          id: 'hero',
          name: '@character.hero@Hero',
          poses: {
            idle: 'assets/npc/{heroId}/idle.png',
            alt:  'assets/npc/hero/happy.png',
          }
        }
      ],
      dialogs: [
        {
          id: 'sample',
          title: 'T',
          left:  { characterId: 'hero', defaultPose: 'idle' },
          right: null,
          ui: { tapToNext: true },
          sequence: [
            { id: 's1', speaker: 'left', text: 'Hello' }
          ]
        }
      ]
    };

    // Also seed game heroes (for getHero())
    game.data = {
      heroes: {
        adam: { id:'adam', name:'Adam', assetsBase:'assets/npc/adam/' },
        eva:  { id:'eva',  name:'Eva',  assetsBase:'assets/npc/eva/'  },
      },
      defaultHero: 'eva'
    };
    game.state = { hero: { id:'eva', assetsBase:'assets/npc/eva/' } };

    // Open dialog (Store promise, do not await yet as it blocks)
    const ui = new DialogUI(game);
    const openPromise = ui.open('sample');

    // Wait a tick for render
    await new Promise(r => setTimeout(r, 10));

    // Should render hero image with eva in path
    const imgBefore = document.querySelector('.dlg-char.left .dlg-char-img');
    expect(imgBefore).toBeTruthy();
    expect(imgBefore.getAttribute('src')).toContain('/eva/');

    // Change hero via engine API
    game.dialogUI = ui;
    game.setHero('adam');

    // Close previous to resolve the promise
    await ui.close();
    await openPromise;

    // Reopen with new hero
    const openPromise2 = ui.open('sample');
    await new Promise(r => setTimeout(r, 10));

    const imgAfter = document.querySelector('.dlg-char.left .dlg-char-img');
    expect(imgAfter.getAttribute('src')).toContain('/adam/');

    // Clean up
    await ui.close();
    await openPromise2;
  });
});
