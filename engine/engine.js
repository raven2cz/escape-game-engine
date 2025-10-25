// engine/engine.js
// Engine core with multi-game + i18n plumbing.
// - Supports baseUrl for per-game assets
// - i18n via opts.i18n { engine: {...}, game: {...} } and opts.lang
// - _text(val): string | {key} resolver with fallback to raw string
// - _t(key, fallback, params): lookup in game → engine → fallback
// - Asset paths auto-prefixed with baseUrl unless absolute

import { openPhraseModal, openCodeModal, openOrderModal, openMatchModal } from './puzzles.js';

export class Game {
  constructor(opts) {
    // DOM
    this.sceneImage = opts.sceneImage;
    this.hotspotLayer = opts.hotspotLayer;
    this.inventoryRoot = opts.inventoryRoot;
    this.messageBox = opts.messageBox;
    this.modalRoot = opts.modalRoot;
    this.modalTitle = opts.modalTitle;
    this.modalBody = opts.modalBody;
    this.modalCancel = opts.modalCancel;
    this.modalOk = opts.modalOk;

    // Data sources
    this.baseUrl = opts.baseUrl || './';
    this.scenesUrl = opts.scenesUrl;     // should already include baseUrl prefix from caller
    this.lang = (opts.lang || 'cs').toLowerCase();
    this.i18n = opts.i18n || { engine: {}, game: {} };

    // State
    this.data = null;
    this.state = null;
    this.currentScene = null;
    this._modalResolve = null;
    this._pendingHighlights = {};

    // Toast container
    this.toastRoot = document.createElement('div');
    this.toastRoot.className = 'toast-container';
    document.body.appendChild(this.toastRoot);

    // Modal controls
    this.modalCancel.addEventListener('click', () => this._closeModal(false));
    this.modalOk.addEventListener('click', () => this._closeModal(true));

    // ESC cancels use-mode
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.state?.useItemId) {
        this.exitUseMode();
        e.preventDefault();
      }
    });
  }

  // --- i18n helpers ---------------------------------------------------------

  /** Interpolate params: 'Hello {name}' + {name:'A'} -> 'Hello A' */
  _fmt(str, params) {
    if (!params) return str;
    return String(str).replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? `{${k}}`));
  }

  /** Lookup translation by key in game → engine → fallback text */
  _t(key, fallback = '', params = null) {
    const g = this.i18n?.game?.[key];
    const e = this.i18n?.engine?.[key];
    const raw = (g != null ? g : (e != null ? e : fallback));
    return this._fmt(raw, params);
  }

  /** Resolve string | {key} using i18n; if plain string, return as-is */
  _text(val, fallback = '') {
    if (val && typeof val === 'object' && val.key) {
      return this._t(String(val.key), fallback);
    }
    return (val != null ? String(val) : String(fallback));
  }

  /** Prefix relative asset path with baseUrl */
  _resolveAsset(path) {
    if (!path) return path;
    const s = String(path);
    if (/^(?:https?:)?\/\//i.test(s)) return s;   // absolute URL
    if (s.startsWith('./') || s.startsWith('/')) return s; // already rooted
    return this.baseUrl.replace(/\/+$/, '/') + s.replace(/^\/+/, '');
  }

  // --- lifecycle ------------------------------------------------------------

  async init() {
    this.data = await fetch(this.scenesUrl, { cache: 'no-cache' }).then(r => r.json());
    this.modalRoot.classList.add('hidden');

    // Support top-level "meta" block (name, description, author, version, tags, languages, ...).
    // Not used at runtime yet, but reserved for future game listing UI.
    this.meta = this.data?.meta || {};

    const saved = this._loadState();
    this.state = saved || {
      inventory: [],
      solved: {},
      flags: {},
      visited: {},
      eventsFired: {},
      scene: this.data.startScene || this.data.scenes[0]?.id,
      useItemId: null
    };
    if (!this.state.flags) this.state.flags = {};
    if (!this.state.eventsFired) this.state.eventsFired = {};

    await this.goto(this.state.scene, { noSave: true });
    this._renderInventory();
  }

  restart() { localStorage.removeItem('leeuwenhoek_escape_state'); location.reload(); }

  async goto(sceneId, opts = {}) {
    const scene = this.data.scenes.find(s => s.id === sceneId);
    if (!scene) return this._msg(this._t('engine.sceneNotFound', 'Scéna nebyla nalezena: {id}', { id: sceneId }));

    this.currentScene = scene;
    this.state.scene = sceneId;
    this.state.visited[sceneId] = true;
    if (!opts.noSave) this._saveState();

    this.sceneImage.src = this._resolveAsset(scene.image);
    await new Promise(res => { if (this.sceneImage.complete && this.sceneImage.naturalWidth) res(); else this.sceneImage.onload = () => res(); });

    this._renderHotspots();
    this._msg(this._text(scene.title) || '');

    // Highlights queued for this scene
    this._drainHighlightsForScene(sceneId);
    // Fire enterScene events
    await this._processEvents({ on: 'enterScene', scene: sceneId });

    if (scene.end) this._msg(this._t('engine.endCongrats', '🎉 Gratulujeme! Našel si cestu ven!'));
  }

  // --- use mode ------------------------------------------------------------

  enterUseMode(itemId) {
    if (!itemId) return;
    this.state.useItemId = itemId;
    document.body.classList.add('use-on');
    this._renderInventory();
    const name = this._itemLabel(itemId);
    this.toast(this._t('engine.use.selected', 'Vybráno k použití: {name}. Klepni na cíl.', { name }), 4000);
  }

  exitUseMode() {
    if (!this.state.useItemId) return;
    this.state.useItemId = null;
    document.body.classList.remove('use-on');
    this._renderInventory();
    this.toast(this._t('engine.use.cleared', 'Režim použití vypnut.'), 1800);
  }

  _removeItemFromInventory(id) {
    const i = this.state.inventory.indexOf(id);
    if (i >= 0) {
      this.state.inventory.splice(i, 1);
      this._renderInventory();
    }
  }

  // --- renderers ------------------------------------------------------------

  _renderHotspots() {
    this.hotspotLayer.innerHTML = '';
    (this.currentScene.hotspots || []).forEach((h, idx) => {
      const el = document.createElement('button');
      el.className = 'hotspot';
      el.setAttribute('data-index', String(idx));
      el.style.left = h.rect.x + '%';
      el.style.top = h.rect.y + '%';
      el.style.width = h.rect.w + '%';
      el.style.height = h.rect.h + '%';

      const reqItemsFail = h.requireItems && !this._hasAll(h.requireItems);
      const reqFlagsFail = h.requireFlags && !this._hasAllFlags(h.requireFlags);
      if (reqItemsFail || reqFlagsFail) el.classList.add('require');

      el.addEventListener('click', (e) => {
        if (document.body.classList.contains('editor-on')) {
          e.preventDefault(); e.stopPropagation(); return;
        }
        e.preventDefault();
        this._activateHotspot(h).catch(err => this._msg(String(err)));
      });

      this.hotspotLayer.appendChild(el);
    });
  }

  async _activateHotspot(h) {
    // If user is in use-mode but this hotspot doesn't accept items at all
    if (this.state.useItemId && !h.acceptItems) {
      this.toast(this._t('engine.use.notApplicable', 'Tento předmět tady nelze použít.'), 2500);
      this.exitUseMode();
      return;
    }
    if (h.requireItems && !this._hasAll(h.requireItems)) {
      this._msg(this._t('engine.missingItems', 'Něco ti chybí…'));
      return;
    }
    if (h.requireFlags && !this._hasAllFlags(h.requireFlags)) {
      this._msg(this._t('engine.needUnlock', 'Nejprve musíš něco odemknout…'));
      return;
    }

    // Accept-Items gate: explicit usage of selected item to hotspot
    if (h.acceptItems && Array.isArray(h.acceptItems)) {
      const selected = this.state.useItemId;

      const accepts = h.acceptItems.map(x => (typeof x === 'string' ? { id: x, consume: false } : x));
      const match = selected ? accepts.find(a => a.id === selected) : null;

      if (!match) {
        // If player actually selected an item, tell them it's not applicable here and exit use-mode.
        if (selected) {
          this.toast(this._t('engine.use.notApplicable', 'Tento předmět tady nelze použít.'), 2500);
          this.exitUseMode();
          return;
        }

        // No item selected → optional hint (as before)
        const allowHint =
          (h.showNeedHint !== false) &&
          (this.data?.settings?.hints?.acceptNeed !== false);

        if (allowHint) {
          const need = accepts.map(a => this._itemLabel(a.id)).filter(Boolean).join(', ');
          this.toast(this._t('engine.use.needItem', 'Potřebuješ použít: {need}.', { need }), 3500);
        }
        return;
      }

      // Apply selected item (match found)
      if (match.consume) this._removeItemFromInventory(match.id);
      this.exitUseMode();

      // onApply action
      if (h.onApply) {
        await this._applyOnSuccess(h.onApply);
      } else {
        this.toast(this._t('engine.use.applied', 'Předmět byl použit.'), 2200);
      }
      return;
    }

    if (h.type === 'goTo') {
      await this.goto(h.target);
      return;
    }
    if (h.type === 'pickup') {
      if (!this.state.inventory.includes(h.itemId)) {
        this.state.inventory.push(h.itemId);
        this._renderInventory();
        this._msg(this._t('engine.pickedUp', 'Sebráno: {name}', { name: this._itemLabel(h.itemId) }));
        await this._stateChanged();
      } else {
        this._msg(this._t('engine.alreadyHave', 'Už máš: {name}', { name: this._itemLabel(h.itemId) }));
      }
      return;
    }
    if (h.type === 'puzzle') {
      const solvedKey = 'vyřešeno:' + (h.key || (this.currentScene.id + ':' + JSON.stringify(h.rect)));
      if (this.state.solved[solvedKey]) {
        await this._applyOnSuccess(h.onSuccess);
        return;
      }
      const kind = h.puzzle?.kind;
      let ok = false;
      if (kind === 'phrase') ok = await openPhraseModal(this, h.puzzle);
      else if (kind === 'code') ok = await openCodeModal(this, h.puzzle);
      else if (kind === 'order') ok = await openOrderModal(this, h.puzzle);
      else if (kind === 'match') ok = await openMatchModal(this, h.puzzle);
      else throw new Error('Unknown puzzle kind: ' + kind);

      if (!ok) throw new Error(this._t('engine.puzzleFailed', 'Puzzle nevyřešeno.'));
      this._msg(this._t('engine.solved', 'Vyřešeno!'));
      this.state.solved[solvedKey] = true;
      this._saveState();
      await this._applyOnSuccess(h.onSuccess);
      return;
    }
    this._msg('Unknown hotspot type: ' + h.type);
  }

  async _applyOnSuccess(actions) {
    if (!actions) return;
    if (actions.message) this._msg(this._text(actions.message));

    let changed = false;

    if (actions.giveItem) {
      const give = Array.isArray(actions.giveItem) ? actions.giveItem : [actions.giveItem];
      let added = 0;
      for (const id of give) {
        if (!this.state.inventory.includes(id)) { this.state.inventory.push(id); added++; changed = true; }
      }
      if (added) this._renderInventory();
    }

    if (actions.setFlags) {
      if (Array.isArray(actions.setFlags)) {
        for (const f of actions.setFlags) { if (!this.state.flags[f]) { this.state.flags[f] = true; changed = true; } }
      } else {
        for (const [k, v] of Object.entries(actions.setFlags)) {
          if (!!this.state.flags[k] !== !!v) { this.state.flags[k] = !!v; changed = true; }
        }
      }
    }

    if (actions.clearFlags && Array.isArray(actions.clearFlags)) {
      for (const f of actions.clearFlags) {
        if (this.state.flags[f]) { delete this.state.flags[f]; changed = true; }
      }
    }

    if (changed) {
      this._renderHotspots();
      await this._stateChanged();
      this._drainHighlightsForScene(this.currentScene.id);
    }
    if (actions.goTo) await this.goto(actions.goTo);
  }

  async _stateChanged() {
    this._saveState();
    await this._processEvents({ on: 'stateChange' });
  }

  _renderInventory() {
    this.inventoryRoot.innerHTML = '';
    (this.state.inventory || []).forEach(id => {
      const item = this._itemById(id); if (!item) return;
      const wrap = document.createElement('button');
      wrap.type = 'button';
      wrap.className = 'item';
      if (this.state.useItemId === id) wrap.classList.add('selected');
      wrap.title = 'Inspect';

      if (item.icon) {
        const img = document.createElement('img');
        img.src = this._resolveAsset(item.icon);
        img.alt = item.label || id;
        wrap.appendChild(img);
      }
      const span = document.createElement('span');
      span.textContent = this._text(item.label) || id;
      wrap.appendChild(span);

      wrap.addEventListener('click', () => {
        // If this item is already selected for use → toggle off (do not open modal)
        if (this.state.useItemId === id) {
          this.exitUseMode();
          return;
        }
        this._inspectItem(item);
      });
      this.inventoryRoot.appendChild(wrap);
    });
  }

  async _inspectItem(item) {
    const body = document.createElement('div');
    body.style.display = 'grid';
    body.style.gap = '10px';

    if (item.icon) {
      const img = document.createElement('img');
      img.src = this._resolveAsset(item.icon);
      img.alt = this._text(item.label) || item.id;
      img.style.width = '100%';
      img.style.maxHeight = '40vh';
      img.style.objectFit = 'contain';
      body.appendChild(img);
    }
    if (item.meta?.word) {
      const w = document.createElement('div');
      w.textContent = String(item.meta.word);
      w.style.fontSize = '1.4rem';
      w.style.fontWeight = '700';
      w.style.textAlign = 'center';
      body.appendChild(w);
    }
    if (item.meta?.description) {
      const d = document.createElement('div');
      d.textContent = String(item.meta.description);
      body.appendChild(d);
    }

    // Inline actions row (Use + Close)
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.justifyContent = 'flex-end';

    const btnUse = document.createElement('button');
    btnUse.textContent = this._t('engine.use.button', 'Použít');
    btnUse.addEventListener('click', () => {
      this.enterUseMode(item.id);
      this._closeModal(true);
    });

    const btnClose = document.createElement('button');
    btnClose.textContent = this._t('engine.modal.cancel', 'Zavřít');
    btnClose.addEventListener('click', () => this._closeModal(false));

    row.appendChild(btnUse);
    row.appendChild(btnClose);
    body.appendChild(row);

    await this.openModal({
      title: this._text(item.label) || item.id,
      body,
      okLabel: this._t('engine.modal.ok', 'OK'),
      cancelLabel: this._t('engine.modal.cancel', 'Zavřít')
    });
  }

  _itemLabel(id) { return this._itemById(id)?.label ? this._text(this._itemById(id).label) : id; }
  _itemById(id) { return (this.data.items || []).find(i => i.id === id); }
  _hasAll(list) { return (list || []).every(x => this.state.inventory.includes(x)); }
  _hasAllFlags(list) { return (list || []).every(f => !!this.state.flags[f]); }

  _msg(t) { this.messageBox.textContent = t; }

  // --- Modal ---------------------------------------------------------------

  openModal({ title, body, okLabel = 'OK', cancelLabel = 'Zrušit' }) {
    this.modalTitle.textContent = title || '';
    this.modalBody.innerHTML = '';
    this.modalBody.appendChild(body);
    this.modalRoot.classList.remove('hidden');
    this.modalOk.textContent = okLabel;
    this.modalCancel.textContent = cancelLabel;
    return new Promise(res => { this._modalResolve = res; });
  }
  _closeModal(ok) {
    this.modalRoot.classList.add('hidden');
    const r = this._modalResolve; this._modalResolve = null;
    if (r) r(ok);
  }

  // --- Highlight helpers ---------------------------------------------------

  _rectPercentToPx(rect) {
    const w = this.hotspotLayer.clientWidth;
    const h = this.hotspotLayer.clientHeight;
    const px = (p, total) => (p / 100) * total;
    return { left: px(rect.x, w), top: px(rect.y, h), width: px(rect.w, w), height: px(rect.h, h) };
  }

  _showHighlightRect(rectPct, ms = 3500, { outline = false } = {}) {
    const box = this._rectPercentToPx(rectPct);
    const el = document.createElement('div');
    el.className = 'hs-glow' + (outline ? ' outline' : '');
    el.style.left = box.left + 'px';
    el.style.top = box.top + 'px';
    el.style.width = box.width + 'px';
    el.style.height = box.height + 'px';
    this.hotspotLayer.appendChild(el);
    setTimeout(() => el.remove(), Math.max(500, ms | 0));
  }

  _enqueueOrShowHighlight({ sceneId, rect, ms = 3500, outline = false }) {
    if (!sceneId || sceneId === this.currentScene?.id) {
      this._showHighlightRect(rect, ms, { outline });
    } else {
      this._pendingHighlights[sceneId] = this._pendingHighlights[sceneId] || [];
      this._pendingHighlights[sceneId].push({ rect, ms, outline });
    }
  }

  _drainHighlightsForScene(sceneId) {
    const list = this._pendingHighlights[sceneId];
    if (!list || !list.length) return;
    let delay = 0;
    list.forEach(({ rect, ms, outline }) => {
      setTimeout(() => this._showHighlightRect(rect, ms, { outline }), delay);
      delay += 200;
    });
    this._pendingHighlights[sceneId] = [];
  }

  // --- Toasts --------------------------------------------------------------

  toast(text, ms = 5000) {
    const wrap = document.createElement('div');
    wrap.className = 'toast';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');
    wrap.textContent = text;
    this.toastRoot.appendChild(wrap);
    setTimeout(() => {
      wrap.classList.add('hide');
      setTimeout(() => wrap.remove(), 350);
    }, Math.max(500, ms | 0));
  }

  // --- Events dispatcher ----------------------------------------------------

  async _processEvents(trigger) {
    const events = this.data.events || [];
    for (const ev of events) {
      if (!ev || !ev.id) continue;
      if (ev.once && this.state.eventsFired?.[ev.id]) continue;

      const w = ev.when || {};
      if (w.on && w.on !== trigger.on) continue;
      if (w.scene && w.scene !== (trigger.scene || this.state.scene)) continue;
      if (w.requireItems && !this._hasAll(w.requireItems)) continue;
      if (w.requireFlags && !this._hasAllFlags(w.requireFlags)) continue;
      if (w.missingItems && (w.missingItems.some(x => this.state.inventory.includes(x)))) continue;

      const act = ev.then || {};

      // Toast
      if (act.toast && act.toast.text) {
        this.toast(this._text(act.toast.text), act.toast.ms ?? 5000);
      }

      // Scene image change (await if we are on that scene)
      if (act.setSceneImage && act.setSceneImage.sceneId && act.setSceneImage.image) {
        const sc = this.data.scenes.find(s => s.id === act.setSceneImage.sceneId);
        if (sc) {
          sc.image = this._resolveAsset(act.setSceneImage.image);
          if (this.currentScene?.id === sc.id) {
            this.sceneImage.src = sc.image;
            await new Promise(res => {
              if (this.sceneImage.complete && this.sceneImage.naturalWidth) res();
              else this.sceneImage.onload = () => res();
            });
          }
        }
      }

      // Glow highlight
      if (act.highlightHotspot && act.highlightHotspot.rect) {
        const h = act.highlightHotspot;
        this._enqueueOrShowHighlight({
          sceneId: h.sceneId || (w.scene || this.state.scene),
          rect: h.rect,
          ms: h.ms ?? 3500,
          outline: !!h.outline
        });
      }

      // setFlags
      if (act.setFlags) {
        let changed = false;
        if (Array.isArray(act.setFlags)) {
          for (const f of act.setFlags) { if (!this.state.flags[f]) { this.state.flags[f] = true; changed = true; } }
        } else {
          for (const [k, v] of Object.entries(act.setFlags)) {
            if (!!this.state.flags[k] !== !!v) { this.state.flags[k] = !!v; changed = true; }
          }
        }
        if (changed) this._saveState();
      }

      // mark once-fired
      if (ev.once) {
        this.state.eventsFired = this.state.eventsFired || {};
        this.state.eventsFired[ev.id] = true;
        this._saveState();
      }
    }
  }

  // --- persistence ----------------------------------------------------------

  _saveState() { localStorage.setItem('leeuwenhoek_escape_state', JSON.stringify(this.state)); }
  _loadState() { try { const raw = localStorage.getItem('leeuwenhoek_escape_state'); return raw ? JSON.parse(raw) : null; } catch { return null; } }
}
