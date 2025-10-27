import { describe, it, expect, beforeEach } from 'vitest';
import { Game } from '../../engine/engine.js';
import { openOrderModal, openMatchModal } from '../../engine/puzzles.js';

function mountDom() {
  document.body.innerHTML = `
    <div id="modal" class="hidden">
      <div id="modalTitle"></div>
      <div id="modalBody"></div>
      <button id="modalCancel">X</button>
      <button id="modalOk">OK</button>
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

describe('Puzzles: order + match', () => {
  beforeEach(() => mountDom());

  it('order puzzle solves when chosen sequence equals solution (supports object tokens)', async () => {
    const game = makeGame();
    const p = openOrderModal(game, {
      title: 'Order',
      prompt: 'Arrange:',
      tokens: [
        { text:'Na', key:'chem.na', matchKey:'Na' },
        { text:'K',  key:'chem.k',  matchKey:'K'  },
        { text:'Cl', key:'chem.cl', matchKey:'Cl' },
      ],
      solution: ['Na','Cl','K']
    });

    const body = document.getElementById('modalBody');
    // Click tokens in order: Na, Cl, K
    function clickToken(txt) {
      const btn = Array.from(body.querySelectorAll('button')).find(b => b.textContent.trim() === txt);
      btn.click();
    }
    clickToken('Na'); clickToken('Cl'); clickToken('K');

    // Confirm
    document.getElementById('modalOk').click();
    const ok = await p;
    expect(ok).toBe(true);
  });

  it('match puzzle requires all pairs to be matched; partial matches are not enough', async () => {
    const game = makeGame();
    const p = openMatchModal(game, {
      title: 'Match',
      prompt: 'Pairs:',
      pairs: [
        [ { text:'Na', matchKey:'Na' }, { text:'Sodium', matchKey:'Na' } ],
        [ { text:'K',  matchKey:'K'  }, { text:'Potassium', matchKey:'K' } ],
      ]
    });

    const body = document.getElementById('modalBody');

    function clickBtnByText(txt) {
      const btn = Array.from(body.querySelectorAll('button')).find(b => b.textContent.trim() === txt);
      btn.click();
    }

    // Make exactly one correct pair and leave the other unmatched
    clickBtnByText('Na'); clickBtnByText('Sodium');

    document.getElementById('modalOk').click();
    const ok = await p;
    expect(ok).toBe(false); // not all pairs matched
  });
});
