import { describe, it, expect, beforeEach } from 'vitest';
import { Game } from '../../engine/engine.js';
import { openPhraseModal, openCodeModal } from '../../engine/puzzles.js';

function mountDom() {
  document.body.innerHTML = `
    <div id="modal" class="hidden">
      <div id="modalTitle"></div>
      <div id="modalBody"></div>
      <button id="modalCancel">X</button>
      <button id="modalOk">OK</button>
    </div>`;
}

describe('Puzzles: phrase + code', () => {
  beforeEach(() => mountDom());

  function makeGame() {
    return new Game({
      baseUrl: './games/test/',
      scenesUrl: './games/test/scenes.json',
      dialogsUrl: './games/test/dialogs.json',
      lang: 'cs',
      i18n: { engine:{}, game:{} },
      // Only modal refs are needed for this unit
      sceneImage: document.createElement('img'),
      hotspotLayer: document.createElement('div'),
      inventoryRoot: document.createElement('div'),
      messageBox: document.createElement('div'),
      modalRoot: document.getElementById('modal'),
      modalTitle: document.getElementById('modalTitle'),
      modalBody: document.getElementById('modalBody'),
      modalCancel: document.getElementById('modalCancel'),
      modalOk: document.getElementById('modalOk'),
    });
  }

  it('phrase puzzle normalizes input (diacritics/case) and honors background wrapper', async () => {
    const game = makeGame();
    const promise = openPhraseModal(game, {
      title: '@x@Phrase',
      prompt: '@x@Enter the phrase:',
      solution: 'eureka',
      background: 'assets/ui/bg-lab.png'
    });

    // Modal is open; background wrapper applied
    const body = document.getElementById('modalBody');
    // Find background layer via style attribute
    const hasBgLayer = !!Array.from(body.querySelectorAll('div')).find(d => String(d.style.background || '').includes('url("assets/ui/bg-lab.png")'));
    expect(hasBgLayer).toBe(true);

    // Fill input with variant (accents + case) and confirm
    const input = body.querySelector('input');
    input.value = 'ÉuréKa';
    document.getElementById('modalOk').click();

    const ok = await promise;
    expect(ok).toBe(true);
  });

  it('code puzzle supports masked input', async () => {
    const game = makeGame();
    const p = openCodeModal(game, {
      title: 'Code',
      prompt: 'Enter code:',
      solution: '4815162342',
      mask: 'password'
    });
    const input = document.querySelector('#modalBody input');
    expect(input.getAttribute('type')).toBe('password'); // masked
    input.value = '4815162342';
    document.getElementById('modalOk').click();
    const ok = await p;
    expect(ok).toBe(true);
  });
});
