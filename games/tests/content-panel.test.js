// games/tests/content-panel.test.js
// Integration tests for the ContentPanel lifecycle.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ContentPanel } from '../../engine/content.js';

/* ------------------------------------------------------------------ */
/*  Test helpers                                                      */
/* ------------------------------------------------------------------ */

/** Minimal mock of the Game engine with just enough API for ContentPanel. */
function mockGame(contentDefs = {}) {
  const hotspotLayer = document.createElement('div');
  hotspotLayer.id = 'hotspotLayer';
  document.body.appendChild(hotspotLayer);

  return {
    hotspotLayer,
    data: { content: contentDefs },
    state: {
      contentShown: {},
    },
    i18n: { engine: {}, game: {} },

    _text(val, fb = '') {
      if (typeof val === 'string') {
        const m = val.match(/^@([^@]+)@(.*)$/s);
        if (m) return m[2]; // Return the fallback part
        return val;
      }
      return fb;
    },

    _resolveAsset(path) {
      return `./assets/${path}`;
    },

    _saveState: vi.fn(),
  };
}

/** Flush pending rAF + timeouts. */
async function flush(ms = 400) {
  await new Promise(r => setTimeout(r, ms));
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('ContentPanel', () => {
  let game;
  let panel;

  const CONTENT_DEF = {
    'test-panel': {
      id: 'test-panel',
      title: 'Test Title',
      format: 'markdown',
      body: '## Hello\n\nWorld.',
      panel: {
        rect: { x: 5, y: 5, w: 50, h: 90 },
        theme: 'glass',
        backdrop: 'dim',
        scrollable: true,
        animation: 'fade-slide',
      },
      buttons: { ok: { visible: true, label: 'OK' } },
      once: false,
    },
    'once-panel': {
      id: 'once-panel',
      title: 'Show Once',
      body: 'Only shown once.',
      once: true,
    },
    'i18n-panel': {
      id: 'i18n-panel',
      title: '@content.title@Fallback Title',
      body: '@content.body@**Fallback** body.',
    },
  };

  beforeEach(() => {
    game = mockGame(CONTENT_DEF);
    panel = new ContentPanel(game);
  });

  afterEach(() => {
    panel.close();
    game.hotspotLayer.remove();
  });

  /* ── Basic lifecycle ── */

  it('opens and renders a panel', async () => {
    const openPromise = panel.open('test-panel');

    // Panel should be mounted
    expect(panel.isOpen).toBe(true);
    const container = game.hotspotLayer.querySelector('.cp-container');
    expect(container).not.toBeNull();

    // Check DOM structure
    expect(container.querySelector('.cp-backdrop')).not.toBeNull();
    expect(container.querySelector('.cp-panel')).not.toBeNull();
    expect(container.querySelector('.cp-title').textContent).toBe('Test Title');
    expect(container.querySelector('.cp-content').innerHTML).toContain('<h2>Hello</h2>');
    expect(container.querySelector('.cp-content').innerHTML).toContain('<p>World.</p>');
    expect(container.querySelector('.cp-btn--ok').textContent).toBe('OK');

    // Close to resolve promise
    panel.close();
    await openPromise;
  });

  it('reports isOpen correctly', async () => {
    expect(panel.isOpen).toBe(false);
    const p = panel.open('test-panel');
    expect(panel.isOpen).toBe(true);
    panel.close();
    await flush();
    expect(panel.isOpen).toBe(false);
    await p;
  });

  it('resolves promise on close', async () => {
    let resolved = false;
    const p = panel.open('test-panel').then(() => { resolved = true; });

    expect(resolved).toBe(false);
    panel.close();
    await flush();
    expect(resolved).toBe(true);
    await p;
  });

  /* ── Theme and styling ── */

  it('applies glass theme class', async () => {
    const p = panel.open('test-panel');
    const panelEl = game.hotspotLayer.querySelector('.cp-panel');
    expect(panelEl.classList.contains('cp-panel--glass')).toBe(true);
    panel.close();
    await p;
  });

  it('applies backdrop class', async () => {
    const p = panel.open('test-panel');
    const backdrop = game.hotspotLayer.querySelector('.cp-backdrop');
    expect(backdrop.classList.contains('cp-backdrop--dim')).toBe(true);
    panel.close();
    await p;
  });

  it('positions panel via rect percentages', async () => {
    const p = panel.open('test-panel');
    const panelEl = game.hotspotLayer.querySelector('.cp-panel');
    expect(panelEl.style.left).toBe('5%');
    expect(panelEl.style.top).toBe('5%');
    expect(panelEl.style.width).toBe('50%');
    expect(panelEl.style.height).toBe('90%');
    panel.close();
    await p;
  });

  /* ── "once" behaviour ── */

  it('tracks "once" panels in state', async () => {
    const p = panel.open('once-panel');
    panel.close();
    await flush();
    await p;

    expect(game.state.contentShown['once-panel']).toBe(true);
    expect(game._saveState).toHaveBeenCalled();
  });

  it('skips "once" panels already shown', async () => {
    game.state.contentShown['once-panel'] = true;
    await panel.open('once-panel');

    // Should not have mounted anything
    expect(panel.isOpen).toBe(false);
    expect(game.hotspotLayer.querySelector('.cp-container')).toBeNull();
  });

  it('does not track non-once panels', async () => {
    const p = panel.open('test-panel');
    panel.close();
    await flush();
    await p;

    expect(game.state.contentShown['test-panel']).toBeUndefined();
  });

  /* ── i18n resolution ── */

  it('resolves i18n @key@fallback in title and body', async () => {
    const p = panel.open('i18n-panel');
    const title = game.hotspotLayer.querySelector('.cp-title');
    expect(title.textContent).toBe('Fallback Title');

    const content = game.hotspotLayer.querySelector('.cp-content');
    expect(content.innerHTML).toContain('<strong>Fallback</strong>');

    panel.close();
    await p;
  });

  /* ── Missing definition ── */

  it('warns and returns for unknown content ID', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await panel.open('nonexistent');

    expect(panel.isOpen).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('definition not found')
    );
    warn.mockRestore();
  });

  /* ── Keyboard handling ── */

  it('closes on Escape key', async () => {
    const p = panel.open('test-panel');
    expect(panel.isOpen).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
    expect(panel.isOpen).toBe(false);
    await p;
  });

  /* ── Close by backdrop click ── */

  it('closes on backdrop click', async () => {
    const p = panel.open('test-panel');
    const backdrop = game.hotspotLayer.querySelector('.cp-backdrop');
    backdrop.click();
    await flush();
    expect(panel.isOpen).toBe(false);
    await p;
  });

  /* ── Close by OK button click ── */

  it('closes on OK button click', async () => {
    const p = panel.open('test-panel');
    const btn = game.hotspotLayer.querySelector('.cp-btn--ok');
    btn.click();
    await flush();
    expect(panel.isOpen).toBe(false);
    await p;
  });

  /* ── Replaces previous panel ── */

  it('closes previous panel when opening a new one', async () => {
    const p1 = panel.open('test-panel');
    expect(panel.isOpen).toBe(true);

    const p2 = panel.open('i18n-panel');

    // New panel should be mounted
    const title = game.hotspotLayer.querySelector('.cp-title');
    expect(title.textContent).toBe('Fallback Title');

    panel.close();
    await flush();
    await Promise.all([p1, p2]);
  });

  /* ── Accessibility ── */

  it('sets role=dialog and aria-modal', async () => {
    const p = panel.open('test-panel');
    const container = game.hotspotLayer.querySelector('.cp-container');
    expect(container.getAttribute('role')).toBe('dialog');
    expect(container.getAttribute('aria-modal')).toBe('true');
    panel.close();
    await p;
  });

  it('sets aria-labelledby to title element', async () => {
    const p = panel.open('test-panel');
    const container = game.hotspotLayer.querySelector('.cp-container');
    const titleId = container.querySelector('.cp-title').id;
    expect(container.getAttribute('aria-labelledby')).toBe(titleId);
    panel.close();
    await p;
  });

  /* ── Scrollable body ── */

  it('adds scrollable class when enabled', async () => {
    const p = panel.open('test-panel');
    const body = game.hotspotLayer.querySelector('.cp-body');
    expect(body.classList.contains('cp-body--scrollable')).toBe(true);
    panel.close();
    await p;
  });
});
