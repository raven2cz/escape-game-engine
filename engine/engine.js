// engine/engine.js
import { openPhraseModal, openCodeModal, openOrderModal, openMatchModal } from './puzzles.js';

export function normalizeText(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export class Game {
  constructor(opts) {
    this.sceneImage = opts.sceneImage;
    this.hotspotLayer = opts.hotspotLayer;
    this.inventoryRoot = opts.inventoryRoot;
    this.messageBox = opts.messageBox;
    this.modalRoot = opts.modalRoot;
    this.modalTitle = opts.modalTitle;
    this.modalBody = opts.modalBody;
    this.modalCancel = opts.modalCancel;
    this.modalOk = opts.modalOk;
    this.scenesUrl = opts.scenesUrl;

    this.data = null;
    this.state = null;
    this.currentScene = null;
    this._modalResolve = null;

    // Toast container (neblokující bannery)
    this.toastRoot = document.createElement('div');
    this.toastRoot.className = 'toast-container';
    document.body.appendChild(this.toastRoot);

    this.modalCancel.addEventListener('click', () => this._closeModal(false));
    this.modalOk.addEventListener('click', () => this._closeModal(true));
  }

  async init() {
    this.data = await fetch(this.scenesUrl).then(r => r.json());
    this.modalRoot.classList.add('hidden');
    const saved = this._loadState();
    this.state = saved || {
      inventory: [],
      solved: {},
      flags: {},
      visited: {},
      eventsFired: {},   // <- přidáno pro jednorázové eventy
      scene: this.data.startScene || this.data.scenes[0]?.id
    };
    if (!this.state.flags) this.state.flags = {};
    if (!this.state.eventsFired) this.state.eventsFired = {};
    await this.goto(this.state.scene, { noSave: true });
    this._renderInventory();
  }

  restart() { localStorage.removeItem('leeuwenhoek_escape_state'); location.reload(); }

  async goto(sceneId, opts = {}) {
    const scene = this.data.scenes.find(s => s.id === sceneId);
    if (!scene) return this._msg(`Scene not found: ${sceneId}`);
    this.currentScene = scene;
    this.state.scene = sceneId;
    this.state.visited[sceneId] = true;
    if (!opts.noSave) this._saveState();
    this.sceneImage.src = scene.image;
    await new Promise(res => { if (this.sceneImage.complete) res(); else this.sceneImage.onload = () => res(); });
    this._renderHotspots();
    this._msg(scene.title || '');

    // Spusť "enterScene" eventy pro právě otevřenou scénu
    await this._processEvents({ on: 'enterScene', scene: sceneId });

    if (scene.end) this._msg('🎉 Gratulujeme! Našel jsi preparát!');
  }

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
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        e.preventDefault();
        this._activateHotspot(h).catch(err => this._msg(String(err)));
      });
      this.hotspotLayer.appendChild(el);
    });
  }

  async _activateHotspot(h) {
    if (h.requireItems && !this._hasAll(h.requireItems)) { this._msg('You are missing something…'); return; }
    if (h.requireFlags && !this._hasAllFlags(h.requireFlags)) { this._msg('Something needs to be unlocked first…'); return; }
    if (h.type === 'goTo') { await this.goto(h.target); return; }
    if (h.type === 'pickup') {
      if (!this.state.inventory.includes(h.itemId)) {
        // přidáme item, vykreslíme inventář, vyvoláme stateChange eventy
        this.state.inventory.push(h.itemId);
        this._renderInventory();
        this._msg('Picked up: ' + this._itemLabel(h.itemId));
        await this._stateChanged();
      } else {
        this._msg('You already have: ' + this._itemLabel(h.itemId));
      }
      return;
    }
    if (h.type === 'puzzle') {
      const solvedKey = 'solved:' + (h.key || (this.currentScene.id + ':' + JSON.stringify(h.rect)));
      if (this.state.solved[solvedKey]) { await this._applyOnSuccess(h.onSuccess); return; }
      const kind = h.puzzle?.kind;
      let ok = false;
      if (kind === 'phrase') ok = await openPhraseModal(this, h.puzzle);
      else if (kind === 'code') ok = await openCodeModal(this, h.puzzle);
      else if (kind === 'order') ok = await openOrderModal(this, h.puzzle);
      else if (kind === 'match') ok = await openMatchModal(this, h.puzzle);
      else throw new Error('Unknown puzzle kind: ' + kind);
      if (!ok) throw new Error('Puzzle failed.');
      this._msg('Solved!');
      this.state.solved[solvedKey] = true;
      this._saveState();
      await this._applyOnSuccess(h.onSuccess);
      return;
    }
    this._msg('Unknown hotspot type: ' + h.type);
  }

  async _applyOnSuccess(actions) {
    if (!actions) return;
    if (actions.message) this._msg(actions.message);

    let changed = false;

    if (actions.giveItem) {
      const give = Array.isArray(actions.giveItem) ? actions.giveItem : [actions.giveItem];
      let added = 0;
      for (const id of give) {
        if (!this.state.inventory.includes(id)) { this.state.inventory.push(id); added++; changed = true; }
      }
      if (added) { this._renderInventory(); }
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
      // uložit a přepočítat eventy; hotspoty překreslíme, pokud se tím odemkly/zamkly
      await this._stateChanged();
      this._renderHotspots();
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
      const wrap = document.createElement('button'); wrap.type = 'button'; wrap.className = 'item'; wrap.title = 'Inspect';
      if (item.icon) { const img = document.createElement('img'); img.src = item.icon; img.alt = item.label || id; wrap.appendChild(img); }
      const span = document.createElement('span'); span.textContent = item.label || id; wrap.appendChild(span);
      wrap.addEventListener('click', () => this._inspectItem(item)); this.inventoryRoot.appendChild(wrap);
    });
  }

  async _inspectItem(item) {
    const body = document.createElement('div'); body.style.display = 'grid'; body.style.gap = '10px';
    if (item.icon) { const img = document.createElement('img'); img.src = item.icon; img.alt = item.label || item.id; img.style.width = '100%'; img.style.maxHeight = '40vh'; img.style.objectFit = 'contain'; body.appendChild(img); }
    if (item.meta?.word) { const w = document.createElement('div'); w.textContent = String(item.meta.word); w.style.fontSize = '1.4rem'; w.style.fontWeight = '700'; w.style.textAlign = 'center'; body.appendChild(w); }
    if (item.meta?.description) { const d = document.createElement('div'); d.textContent = String(item.meta.description); body.appendChild(d); }
    await this.openModal({ title: item.label || item.id, body, okLabel: 'OK', cancelLabel: 'Close' });
  }

  _itemLabel(id) { return this._itemById(id)?.label || id; }
  _itemById(id) { return (this.data.items || []).find(i => i.id === id); }
  _hasAll(list) { return (list || []).every(x => this.state.inventory.includes(x)); }
  _hasAllFlags(list) { return (list || []).every(f => !!this.state.flags[f]); }

  _msg(t) { this.messageBox.textContent = t; }

  // === Modal ===
  openModal({ title, body, okLabel = 'OK', cancelLabel = 'Cancel' }) {
    this.modalTitle.textContent = title || '';
    this.modalBody.innerHTML = ''; this.modalBody.appendChild(body);
    this.modalRoot.classList.remove('hidden');
    this.modalOk.textContent = okLabel; this.modalCancel.textContent = cancelLabel;
    return new Promise(res => { this._modalResolve = res; });
  }
  _closeModal(ok) { this.modalRoot.classList.add('hidden'); const r = this._modalResolve; this._modalResolve = null; if (r) r(ok); }

  // === Toasty (neblokující bannery) ===
  toast(text, ms = 5000) {
    const wrap = document.createElement('div');
    wrap.className = 'toast';
    wrap.setAttribute('role','status');
    wrap.setAttribute('aria-live','polite');
    wrap.textContent = text;
    this.toastRoot.appendChild(wrap);
    // auto-hide
    setTimeout(() => {
      wrap.classList.add('hide');
      setTimeout(() => wrap.remove(), 350);
    }, Math.max(500, ms | 0));
  }

  // === Dispatcher pro události z `data.events` ===
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

      const act = ev.then || {};

      // 1) Toast
      if (act.toast && act.toast.text) {
        this.toast(String(act.toast.text), act.toast.ms ?? 5000);
      }

      // 2) Změna obrázku scény
      if (act.setSceneImage && act.setSceneImage.sceneId && act.setSceneImage.image) {
        const sc = this.data.scenes.find(s => s.id === act.setSceneImage.sceneId);
        if (sc) {
          sc.image = act.setSceneImage.image;
          if (this.currentScene?.id === sc.id) {
            // pokud jsme v té scéně, přepiš obrázek hned
            this.sceneImage.src = sc.image;
          }
        }
      }

      // 3) Volitelné: setFlags (pro budoucí rozšíření)
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

      // Označ jako odpálené, pokud je jednorázová
      if (ev.once) {
        this.state.eventsFired = this.state.eventsFired || {};
        this.state.eventsFired[ev.id] = true;
        this._saveState();
      }
    }
  }

  _saveState() { localStorage.setItem('leeuwenhoek_escape_state', JSON.stringify(this.state)); }
  _loadState() { try { const raw = localStorage.getItem('leeuwenhoek_escape_state'); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
}
