import { describe, it, expect, beforeEach } from 'vitest';
import { Game } from '../../engine/engine.js';
import { createPuzzleRunner } from '../../engine/puzzles/index.js';

function mountDom() {
  document.body.innerHTML = `
    <div id="gameRoot" style="position:relative;width:1000px;height:600px;">
        <div id="hotspotLayer" style="position:absolute;inset:0;"></div>
    </div>`;
}

describe('Puzzles 2.0: phrase + code specific logic', () => {
  beforeEach(() => mountDom());

  function makeGame() {
    return new Game({
      baseUrl: './games/test/',
      scenesUrl: './games/test/scenes.json',
      lang: 'cs',
      i18n: { engine:{}, game:{} },
      hotspotLayer: document.getElementById('hotspotLayer'),
      // Dummies
      sceneImage: document.createElement('img'),
      inventoryRoot: document.createElement('div'),
      messageBox: document.createElement('div'),
      modalRoot: document.createElement('div'),
      modalTitle: document.createElement('div'),
      modalBody: document.createElement('div'),
      modalCancel: document.createElement('button'),
      modalOk: document.createElement('button'),
    });
  }

  it('phrase puzzle normalizes input (diacritics/case)', async () => {
    const game = makeGame();
    let result = null;

    const runner = createPuzzleRunner({
      config: {
        kind: 'phrase',
        title: 'Phrase',
        solution: 'eureka'
      },
      engine: game,
      onResolve: (res) => { result = res; }
    });

    runner.mountInto(document.getElementById('hotspotLayer'));

    // Fill input with variant (accents + case) and confirm
    const input = document.querySelector('input');
    input.value = 'ÉuréKa';
    document.querySelector('.pz-btn--ok').click();

    await new Promise(r => setTimeout(r, 10));
    expect(result.ok).toBe(true);
  });

  it('code puzzle supports masked input', async () => {
    const game = makeGame();
    let result = null;

    const runner = createPuzzleRunner({
      config: {
        kind: 'code',
        title: 'Code',
        solution: '4815'
      },
      engine: game,
      onResolve: (res) => { result = res; }
    });

    runner.mountInto(document.getElementById('hotspotLayer'));

    const input = document.querySelector('input');
    expect(input.getAttribute('type')).toBe('password'); // masked

    input.value = '4815';
    document.querySelector('.pz-btn--ok').click();

    await new Promise(r => setTimeout(r, 10));
    expect(result.ok).toBe(true);
  });
});
