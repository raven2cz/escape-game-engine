import { describe, it, expect, beforeEach } from 'vitest';
import { Game } from '../../engine/engine.js';
import { createPuzzleRunner } from '../../engine/puzzles/index.js';

function mountDom() {
  document.body.innerHTML = `
    <div id="gameRoot" style="position:relative;width:1000px;height:600px;">
        <div id="hotspotLayer" style="position:absolute;inset:0;"></div>
    </div>`;
}

function makeGame() {
  return new Game({
    baseUrl: './games/test/',
    scenesUrl: './games/test/scenes.json',
    dialogsUrl: './games/test/dialogs.json',
    lang: 'cs',
    i18n: { engine:{}, game:{} },
    sceneImage: document.createElement('img'),
    hotspotLayer: document.getElementById('hotspotLayer'),
    inventoryRoot: document.createElement('div'),
    messageBox: document.createElement('div'),
    modalRoot: document.createElement('div'),
    modalTitle: document.createElement('div'),
    modalBody: document.createElement('div'),
    modalCancel: document.createElement('button'),
    modalOk: document.createElement('button'),
  });
}

describe('Puzzles 2.0: order + match specific logic', () => {
  beforeEach(() => mountDom());

  it('order puzzle solves when chosen sequence equals solution', async () => {
    const game = makeGame();
    let result = null;

    const runner = createPuzzleRunner({
      config: {
        kind: 'order',
        title: 'Order',
        tokens: [
          { id: 'na', text: 'Na' },
          { id: 'k', text: 'K' },
          { id: 'cl', text: 'Cl' }
        ],
        solution: ['na','cl','k']
      },
      engine: game,
      onResolve: (res) => { result = res; }
    });

    runner.mountInto(document.getElementById('hotspotLayer'));

    // Simulate clicks
    const shuffled = document.querySelector('.pz-area-shuffled');

    // Helper to click token by ID
    const clickId = (id) => shuffled.querySelector(`[data-id="${id}"]`)?.click();

    clickId('na');
    clickId('cl');
    clickId('k');

    // Confirm
    document.querySelector('.pz-btn--ok').click();

    await new Promise(r => setTimeout(r, 10));
    expect(result).toBeTruthy();
    expect(result.ok).toBe(true);
  });

  it('match puzzle requires all pairs to be matched', async () => {
    const game = makeGame();
    let result = null;

    const runner = createPuzzleRunner({
      config: {
        kind: 'match',
        mode: 'columns',
        tokens: [
          { id: 'a', text: 'A', side: 'left' },
          { id: 'aa', text: 'AA', side: 'right' },
          { id: 'b', text: 'B', side: 'left' },
          { id: 'bb', text: 'BB', side: 'right' }
        ],
        pairs: [ ['a', 'aa'], ['b', 'bb'] ]
      },
      // FIX: Explicitly set blockUntilSolved to true to test blocking behavior
      instanceOptions: {
        blockUntilSolved: true
      },
      engine: game,
      onResolve: (res) => { result = res; }
    });

    runner.mountInto(document.getElementById('hotspotLayer'));

    // Find tokens
    const tokens = Array.from(document.querySelectorAll('.pz-token'));
    const getById = (id) => tokens.find(t => t.getAttribute('data-id') === id);

    // Match pair A-AA
    getById('a').click();
    getById('aa').click();

    // Leave B-BB unmatched and submit
    document.querySelector('.pz-btn--ok').click();

    await new Promise(r => setTimeout(r, 10));

    // Should fail and BLOCK (result stays null) because blockUntilSolved is true
    expect(result).toBeNull();

    // The puzzle container should still be there
    expect(document.querySelector('.pz-container')).toBeTruthy();
  });
});
