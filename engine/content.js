/**
 * @fileoverview Content Panel system for the escape-game-engine.
 *
 * Renders rich narrative content (Markdown / HTML / plain text) inside
 * styled, semi-transparent overlay panels displayed over scene backgrounds.
 *
 * Content panels are the engine's primary mechanism for room descriptions,
 * mission briefings, story text, and any translatable narrative content.
 *
 * Integration points:
 * - Event action:   `{ "openContent": "content-id" }`
 * - Hotspot type:   `{ "type": "content", "contentRef": "content-id" }`
 * - Scene property: `{ "content": { "ref": "id", "trigger": "enter" } }`
 *
 * @module content
 */

import { renderContent } from './content-renderer.js';

/* ------------------------------------------------------------------ */
/*  Default configuration                                             */
/* ------------------------------------------------------------------ */

/** @type {import('./content').PanelDefaults} */
const DEFAULTS = {
  rect:       { x: 3, y: 3, w: 45, h: 94 },
  theme:      'glass',
  backdrop:   'dim',
  scrollable: true,
  animation:  'fade-slide',
  format:     'markdown',
  once:       false,
  buttons: {
    ok: { visible: true, label: '@btn.continue@Pokračovat' },
  },
};

/** Z-index for the content panel container (below puzzles, above dialogs). */
const Z_INDEX = 7500;

/** Duration (ms) of the show / hide CSS transitions. */
const ANIM_MS = 300;

/* ------------------------------------------------------------------ */
/*  ContentPanel class                                                */
/* ------------------------------------------------------------------ */

/**
 * @typedef {Object} ContentDef
 * @property {string}  id                        - Unique identifier.
 * @property {string}  [title]                   - Panel heading (supports i18n `@key@fallback`).
 * @property {'markdown'|'html'|'text'} [format] - Body content format.
 * @property {string}  body                      - Body content (supports i18n).
 * @property {Object}  [panel]                   - Visual / layout options.
 * @property {Object}  [panel.rect]              - Position `{x,y,w,h}` in viewport %.
 * @property {string}  [panel.theme]             - Theme name: `glass` | `solid` | `minimal`.
 * @property {string}  [panel.backdrop]          - Backdrop style: `blur` | `dim` | `none`.
 * @property {boolean} [panel.scrollable]        - Allow vertical scrolling.
 * @property {string}  [panel.animation]         - Animation type: `fade` | `fade-slide` | `none`.
 * @property {Object}  [buttons]                 - Button config `{ ok: { visible, label } }`.
 * @property {boolean} [once]                    - Show only once per session.
 */

/**
 * Manages opening, rendering, and closing content overlay panels.
 *
 * Usage inside the engine:
 * ```js
 * this.contentPanel = new ContentPanel(this);
 * await this.contentPanel.open('intro-briefing');
 * ```
 */
export class ContentPanel {

  /**
   * @param {import('./engine').Game} game - Reference to the parent Game instance.
   */
  constructor(game) {
    /** @type {import('./engine').Game} */
    this.game = game;

    /**
     * Currently visible container element, or `null` when closed.
     * @type {HTMLElement|null}
     */
    this._container = null;

    /**
     * Promise resolve callback for the current `open()` call.
     * @type {Function|null}
     */
    this._resolve = null;

    /* Bind keyboard handler once so we can remove it later. */
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  /* ---------------------------------------------------------------- */
  /*  Public API                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Open a content panel by its definition ID.
   *
   * Reads the definition from `game.data.content[contentId]`, resolves
   * i18n values, renders the Markdown / HTML body, and displays the
   * panel with the configured animation.
   *
   * The returned promise resolves when the user dismisses the panel.
   *
   * @param {string} contentId   - Key in the `content` map of scenes.json.
   * @param {Object} [overrides] - Runtime overrides merged on top of the definition.
   * @returns {Promise<void>}
   */
  async open(contentId, overrides = {}) {
    const contentMap = this.game.data?.content || {};
    const def = contentMap[contentId];
    if (!def) {
      console.warn(`[ContentPanel] definition not found: "${contentId}"`);
      return;
    }

    // Respect "once" flag
    if (def.once && this.game.state.contentShown?.[contentId]) return;

    // Close any panel that is already open
    if (this._container) this._closeImmediate();

    const merged = this._mergeDefaults(def, overrides);

    return new Promise(resolve => {
      this._resolve = resolve;
      this._render(contentId, merged);
    });
  }

  /**
   * Close the currently open panel (if any), triggering the exit animation.
   */
  close() {
    if (!this._container) return;
    this._animateOut();
  }

  /**
   * Whether a content panel is currently visible.
   * @type {boolean}
   */
  get isOpen() {
    return !!this._container;
  }

  /* ---------------------------------------------------------------- */
  /*  Merge & resolve helpers                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Deep-merge a content definition with defaults and runtime overrides.
   *
   * @param {ContentDef} def       - Source definition from JSON.
   * @param {Object}     overrides - Runtime overrides.
   * @returns {ContentDef} Merged definition.
   * @private
   */
  _mergeDefaults(def, overrides) {
    const panel = {
      ...DEFAULTS,
      ...(def.panel || {}),
      ...(overrides.panel || {}),
      rect: {
        ...DEFAULTS.rect,
        ...(def.panel?.rect || {}),
        ...(overrides.panel?.rect || {}),
      },
    };

    const buttons = {
      ok: {
        ...DEFAULTS.buttons.ok,
        ...(def.buttons?.ok || {}),
        ...(overrides.buttons?.ok || {}),
      },
    };

    return {
      ...def,
      ...overrides,
      panel,
      buttons,
      format: overrides.format || def.format || DEFAULTS.format,
      once: overrides.once ?? def.once ?? DEFAULTS.once,
    };
  }

  /**
   * Resolve an i18n-capable string through the engine's `_text()` helper.
   *
   * @param {string} val      - Raw value (may contain `@key@fallback`).
   * @param {string} [fb=''] - Fallback if val is falsy.
   * @returns {string}
   * @private
   */
  _t(val, fb = '') {
    return this.game._text(val, fb);
  }

  /* ---------------------------------------------------------------- */
  /*  DOM construction                                                */
  /* ---------------------------------------------------------------- */

  /**
   * Build and mount the complete panel DOM tree.
   *
   * @param {string}     contentId - Definition ID (used for state tracking).
   * @param {ContentDef} def       - Merged definition.
   * @private
   */
  _render(contentId, def) {
    const { panel, buttons, format } = def;

    // ── Container ──
    const container = document.createElement('div');
    container.className = 'cp-container';
    container.style.zIndex = Z_INDEX;
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-modal', 'true');
    container.dataset.contentId = contentId;

    // ── Backdrop ──
    const backdrop = document.createElement('div');
    backdrop.className = `cp-backdrop cp-backdrop--${panel.backdrop}`;
    backdrop.addEventListener('click', () => this.close());
    container.appendChild(backdrop);

    // ── Panel ──
    const panelEl = document.createElement('div');
    panelEl.className = `cp-panel cp-panel--${panel.theme}`;
    Object.assign(panelEl.style, {
      left:   `${panel.rect.x}%`,
      top:    `${panel.rect.y}%`,
      width:  `${panel.rect.w}%`,
      height: `${panel.rect.h}%`,
    });
    container.appendChild(panelEl);

    // ── Header ──
    const title = this._t(def.title);
    if (title) {
      const header = document.createElement('div');
      header.className = 'cp-header';
      header.setAttribute('data-id', 'header');

      const h2 = document.createElement('h2');
      h2.className = 'cp-title';
      h2.id = `cp-title-${contentId}`;
      h2.textContent = title;
      container.setAttribute('aria-labelledby', h2.id);
      header.appendChild(h2);
      panelEl.appendChild(header);
    }

    // ── Body ──
    const body = document.createElement('div');
    body.className = 'cp-body';
    body.setAttribute('data-id', 'body');
    body.tabIndex = 0;
    if (panel.scrollable) body.classList.add('cp-body--scrollable');

    const content = document.createElement('div');
    content.className = 'cp-content';

    const rawBody = this._t(def.body);
    content.innerHTML = renderContent(rawBody, format);

    // Resolve relative image paths within rendered content
    content.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src');
      if (src && !src.startsWith('http') && !src.startsWith('data:')) {
        img.src = this.game._resolveAsset(src);
      }
    });

    body.appendChild(content);
    panelEl.appendChild(body);

    // ── Footer ──
    if (buttons.ok?.visible !== false) {
      const footer = document.createElement('div');
      footer.className = 'cp-footer';
      footer.setAttribute('data-id', 'footer');

      const okBtn = document.createElement('button');
      okBtn.className = 'cp-btn cp-btn--ok';
      okBtn.type = 'button';
      okBtn.textContent = this._t(buttons.ok.label, 'OK');
      okBtn.addEventListener('click', () => this.close());
      footer.appendChild(okBtn);

      panelEl.appendChild(footer);
    }

    // ── Mount ──
    this._container = container;
    this._contentId = contentId;
    this._def = def;

    (this.game.hotspotLayer || document.body).appendChild(container);

    document.addEventListener('keydown', this._onKeyDown);

    // Trigger enter animation on next frame
    requestAnimationFrame(() => {
      panelEl.classList.add('cp-panel--visible');
      backdrop.classList.add('cp-backdrop--visible');
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Animation & teardown                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Animate the panel out, then remove from DOM and resolve the promise.
   * @private
   */
  _animateOut() {
    if (!this._container) return;

    const panel = this._container.querySelector('.cp-panel');
    const backdrop = this._container.querySelector('.cp-backdrop');

    if (panel)    panel.classList.remove('cp-panel--visible');
    if (backdrop) backdrop.classList.remove('cp-backdrop--visible');

    const cleanup = () => this._closeImmediate();

    // Wait for CSS transition to finish, with a safety timeout
    if (this._def?.panel?.animation === 'none') {
      cleanup();
    } else {
      setTimeout(cleanup, ANIM_MS + 50);
    }
  }

  /**
   * Immediately remove the panel from DOM and resolve the open() promise.
   * @private
   */
  _closeImmediate() {
    if (!this._container) return;

    document.removeEventListener('keydown', this._onKeyDown);

    this._container.remove();

    // Track "once" in game state
    if (this._def?.once && this._contentId) {
      if (!this.game.state.contentShown) this.game.state.contentShown = {};
      this.game.state.contentShown[this._contentId] = true;
      this.game._saveState();
    }

    this._container = null;
    this._contentId = null;
    this._def = null;

    if (this._resolve) {
      const r = this._resolve;
      this._resolve = null;
      r();
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Keyboard handling                                               */
  /* ---------------------------------------------------------------- */

  /**
   * Handle keyboard events while panel is open.
   *
   * - **Escape** closes the panel.
   * - **Tab** is trapped within the panel for accessibility.
   *
   * @param {KeyboardEvent} e
   * @private
   */
  _onKeyDown(e) {
    if (!this._container) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }

    // Trap focus within the panel
    if (e.key === 'Tab') {
      const focusable = this._container.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last  = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
}
