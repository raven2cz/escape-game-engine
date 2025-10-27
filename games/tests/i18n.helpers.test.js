import { describe, it, expect } from 'vitest';
import { fmt, t, text } from '../../engine/i18n-helpers.js';
import { Game } from '../../engine/engine.js';

// Minimal DOM for Game (modal + msg etc. even if unused here)
function mountDom() {
  document.body.innerHTML = `
    <main id="gameRoot">
      <div id="sceneContainer">
        <img id="sceneImage" alt="scene">
        <div id="hotspotLayer" style="width:800px;height:450px;"></div>
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
}

describe('i18n helpers (fmt, t, text) and Game._t/_text', () => {
  it('fmt replaces parameters', () => {
    expect(fmt('Hello {name}, {what}!', { name: 'Ada', what: 'world' })).toBe('Hello Ada, world!');
    expect(fmt('No param {x}', {})).toBe('No param {x}');
  });

  it('t() resolves keys with fallbacks and params', () => {
    const i18n = {
      game:   { 'g.hello': 'Hi {name}', 'shared': 'GameShared' },
      engine: { 'e.hello': 'Engine {name}', 'shared': 'EngineShared' },
    };
    expect(t(i18n, 'g.hello', 'F', { name: 'Bob' })).toBe('Hi Bob');
    expect(t(i18n, 'e.hello', 'F', { name: 'Kit' })).toBe('Engine Kit');
    expect(t(i18n, 'missing', 'Fallback {x}', { x: 'Y' })).toBe('Fallback Y');
    // prefer game over engine on same key
    expect(t(i18n, 'shared', 'F')).toBe('GameShared');
  });

  it('text() supports "@key@fallback", pure key objects and raw strings', () => {
    const i18n = { game: { 'k': 'VV' }, engine: {} };
    expect(text(i18n, '@k@Fallback')).toBe('VV');
    expect(text(i18n, '@missing@FB')).toBe('FB');
    expect(text(i18n, { key: 'k' })).toBe('VV');
    expect(text(i18n, 'Raw')).toBe('Raw');
  });

  it('Game._t and _text prefer game → engine → fallback and support params', async () => {
    mountDom();
    const game = new Game({
      baseUrl: './games/x/',
      scenesUrl: './games/x/scenes.json',
      dialogsUrl: './games/x/dialogs.json',
      lang: 'cs',
      i18n: {
        game:   { 'a.b': 'GG {n}', 'onlyGame': 'Only G' },
        engine: { 'a.b': 'EE {n}', 'onlyEngine': 'Only E' },
      },
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

    expect(game._t('a.b', 'X', { n: 42 })).toBe('GG 42');       // game wins
    expect(game._t('onlyEngine', 'X')).toBe('Only E');          // fallback to engine
    expect(game._t('missing', 'Fallback')).toBe('Fallback');    // fallback string

    expect(game._text('@a.b@F', { n: 'Z' })).toBe('GG {n}'); // current engine doesn't fmt params in "@key@fallback"      // @key@fallback
    expect(game._text({ key: 'onlyEngine' })).toBe('Only E');   // object key
    expect(game._text('Raw')).toBe('Raw');                      // raw string passthrough
  });
});
