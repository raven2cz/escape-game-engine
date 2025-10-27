// engine/engine.js
// Game engine core: scenes, i18n, dialogs, hero profile, inventory, puzzles, events.

import { openPhraseModal, openCodeModal, openOrderModal, openMatchModal } from './puzzles.js';
import { DialogUI } from './dialogs.js';

export class Game {
    constructor(opts) {
        // DOM refs
        this.sceneImage   = opts.sceneImage;
        this.hotspotLayer = opts.hotspotLayer;
        this.inventoryRoot = opts.inventoryRoot;
        this.messageBox   = opts.messageBox;
        this.modalRoot    = opts.modalRoot;
        this.modalTitle   = opts.modalTitle;
        this.modalBody    = opts.modalBody;
        this.modalCancel  = opts.modalCancel;
        this.modalOk      = opts.modalOk;

        // Data sources
        this.baseUrl    = opts.baseUrl || './';
        this.scenesUrl  = opts.scenesUrl;          // already prefixed by caller
        this.dialogsUrl = opts.dialogsUrl || null; // ./games/<id>/dialogs.json (optional)
        this.lang       = (opts.lang || 'cs').toLowerCase();
        this.i18n       = opts.i18n || { engine: {}, game: {} };

        // State
        this.data = null;
        this.meta = {};
        this.dialogsData = null;
        this.state = null;
        this.currentScene = null;
        this._modalResolve = null;
        this._pendingHighlights = {};

        // Toast container
        this.toastRoot = document.createElement('div');
        this.toastRoot.className = 'toast-container';
        document.body.appendChild(this.toastRoot);

        // Dialog UI
        this.dialogUI = new DialogUI(this);

        // Modal events
        this.modalCancel.addEventListener('click', () => this._closeModal(false));
        this.modalOk.addEventListener('click', () => this._closeModal(true));

        // ESC = exit use-mode
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.state?.useItemId) {
                this.exitUseMode();
                e.preventDefault();
            }
        });
    }

    // --- debug toggles ----------------------------------------------------------

    _debugOn() {
        try { return new URLSearchParams(location.search).get('debug') === '1'; }
        catch { return false; }
    }
    _dbg(...args) { if (this._debugOn()) console.debug('[GAME]', ...args); }

    // --- version signature for safe restore ------------------------------------

    _signature() {
        const gid  = this.meta?.id || 'unknown';
        const gver = this.meta?.version || '0';
        const lang = this.lang || 'cs';
        return `${gid}|${gver}|${lang}`;
    }

    // --- i18n helpers -----------------------------------------------------------

    _fmt(str, params) {
        if (!params) return str;
        return String(str).replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? `{${k}}`));
    }

    _t(key, fallback = '', params = null) {
        const g = this.i18n?.game?.[key];
        const e = this.i18n?.engine?.[key];
        const raw = (g != null ? g : (e != null ? e : fallback));
        return this._fmt(raw, params);
    }

    /**
     * Resolve string | {key} | "@key@fallback".
     */
    _text(val, fallback = '') {
        if (val && typeof val === 'object' && val.key) {
            return this._t(String(val.key), fallback);
        }
        if (typeof val === 'string') {
            const m = val.match(/^@([^@]+)@(.*)$/s);
            if (m) return this._t(m[1].trim(), m[2]);
            return val;
        }
        return (val != null ? String(val) : String(fallback));
    }

    /** Prefix relative paths with baseUrl. */
    _resolveAsset(path) {
        if (!path) return path;
        const s = String(path);
        if (/^(?:https?:)?\/\//i.test(s)) return s;           // absolute URL
        if (s.startsWith('./') || s.startsWith('/')) return s; // already rooted
        return this.baseUrl.replace(/\/+$/, '/') + s.replace(/^\/+/, '');
    }

    // --- lifecycle --------------------------------------------------------------

    async init() {
        this.data = await fetch(this.scenesUrl, { cache: 'no-cache' }).then(r => r.json());
        this.modalRoot.classList.add('hidden');

        this.meta = this.data?.meta || {};

        // Query flags
        let forceReset = false;
        let urlHero = null;
        try {
            const p = new URLSearchParams(location.search);
            forceReset = p.get('reset') === '1';
            urlHero = p.get('hero'); // may be null
        } catch { /* noop */ }

        const saved = forceReset ? null : this._loadState();
        const okSaved = !!saved && saved.signature === this._signature();

        // fresh state if signature changed or reset requested
        this.state = okSaved ? saved : {
            signature: this._signature(),
            inventory: [],
            solved: {},
            flags: {},
            visited: {},
            eventsFired: {},
            scene: this.data.startScene || this.data.scenes[0]?.id,
            useItemId: null,
            hero: null,
        };

        // initialize hero (default → then URL override if present)
        if (!this.state.hero) {
            const defId = this.data?.defaultHero || Object.keys(this.data?.heroes || {})[0] || 'adam';
            this._setHeroInternal(defId);
        }
        if (urlHero) {
            // URL always wins (do not nuke progress)
            this._setHeroInternal(urlHero);
            this._dbg('[HERO] overridden from URL →', urlHero, this.state.hero);
        }

        await this.goto(this.state.scene, { noSave: true });
        this._renderInventory();
    }

    restart() {
        localStorage.removeItem('leeuwenhoek_escape_state');
        location.reload();
    }

    async goto(sceneId, opts = {}) {
        const scene = this.data.scenes.find(s => s.id === sceneId);
        if (!scene) return this._msg(this._t('engine.sceneNotFound', 'Scéna nebyla nalezena: {id}', { id: sceneId }));

        this.currentScene = scene;
        this.state.scene = sceneId;
        this.state.visited[sceneId] = true;
        if (!opts.noSave) this._saveState();

        this.sceneImage.src = this._resolveAsset(scene.image);
        await new Promise(res => {
            if (this.sceneImage.complete && this.sceneImage.naturalWidth) res();
            else this.sceneImage.onload = () => res();
        });

        this._renderHotspots();
        this._msg(this._text(scene.title) || '');

        // queued highlights for this scene
        this._drainHighlightsForScene(sceneId);
        // events: enterScene
        await this._processEvents({ on: 'enterScene', scene: sceneId });

        if (scene.end) this._msg(this._t('engine.endCongrats', '🎉 Gratulujeme! Našel si cestu ven!'));
    }

    // --- hero profile -----------------------------------------------------------

    _getHeroProfileById(id) {
        const map = this.data?.heroes || {};
        return map[id] || null;
    }

    _setHeroInternal(id) {
        const prof = this._getHeroProfileById(id) || { id: 'adam', gender: 'm', name: 'Adam', assetsBase: 'assets/npc/adam/' };
        this.state.hero = {
            id: prof.id,
            gender: prof.gender || 'm',
            name: this._text(prof.name) || prof.name || 'Hero',
            assetsBase: prof.assetsBase || 'assets/npc/adam/'
        };
        this._saveState();
    }

    setHero(id)       { this._setHeroInternal(id); }
    getHero()         { return this.state?.hero || this._getHeroProfileById(this.data?.defaultHero) || { id:'adam', gender:'m', name:'Adam', assetsBase:'assets/npc/adam/' }; }
    getHeroId()       { return this.getHero().id; }
    getHeroGender()   { return this.getHero().gender; }

    // --- use mode ---------------------------------------------------------------

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

    // --- renderers --------------------------------------------------------------

    _renderHotspots() {
        this.hotspotLayer.innerHTML = '';
        (this.currentScene.hotspots || []).forEach((h, idx) => {
            const el = document.createElement('button');
            el.className = 'hotspot';
            el.setAttribute('data-index', String(idx));
            el.style.left   = h.rect.x + '%';
            el.style.top    = h.rect.y + '%';
            el.style.width  = h.rect.w + '%';
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
        // use-mode guard
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

        // explicit item usage
        if (h.acceptItems && Array.isArray(h.acceptItems)) {
            const selected = this.state.useItemId;
            const accepts = h.acceptItems.map(x => (typeof x === 'string' ? { id: x, consume: false } : x));
            const match = selected ? accepts.find(a => a.id === selected) : null;

            if (!match) {
                if (selected) {
                    this.toast(this._t('engine.use.notApplicable', 'Tento předmět tady nelze použít.'), 2500);
                    this.exitUseMode();
                    return;
                }
                const allowHint = (h.showNeedHint !== false) && (this.data?.settings?.hints?.acceptNeed !== false);
                if (allowHint) {
                    const need = accepts.map(a => this._itemLabel(a.id)).filter(Boolean).join(', ');
                    this.toast(this._t('engine.use.needItem', 'Potřebuješ použít: {need}.', { need }), 3500);
                }
                return;
            }

            if (match.consume) this._removeItemFromInventory(match.id);
            this.exitUseMode();

            if (h.onApply) await this._applyOnSuccess(h.onApply);
            else this.toast(this._t('engine.use.applied', 'Předmět byl použit.'), 2200);
            return;
        }

        // actions
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
            const solvedKey = 'solved:' + (h.key || (this.currentScene.id + ':' + JSON.stringify(h.rect)));
            if (this.state.solved[solvedKey]) {
                await this._applyOnSuccess(h.onSuccess);
                return;
            }
            const kind = h.puzzle?.kind;
            let ok = false;
            if      (kind === 'phrase') ok = await openPhraseModal(this, h.puzzle);
            else if (kind === 'code')   ok = await openCodeModal(this, h.puzzle);
            else if (kind === 'order')  ok = await openOrderModal(this, h.puzzle);
            else if (kind === 'match')  ok = await openMatchModal(this, h.puzzle);
            else throw new Error('Unknown puzzle kind: ' + kind);

            if (!ok) throw new Error(this._t('engine.puzzleFailed', 'Puzzle nevyřešeno.'));
            this._msg(this._t('engine.solved', 'Vyřešeno!'));
            this.state.solved[solvedKey] = true;
            this._saveState();
            await this._applyOnSuccess(h.onSuccess);
            return;
        }
        if (h.type === 'dialog') {
            if (!h.dialogId) { this._msg('Chybí dialogId u hotspotu.'); return; }
            this._dbg('hotspot.dialog click →', h.dialogId);
            await this.openDialog(h.dialogId);
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
                if (!this.state.inventory.includes(id)) {
                    this.state.inventory.push(id);
                    added++;
                    changed = true;
                }
            }
            if (added) this._renderInventory();
        }

        if (actions.setFlags) {
            if (Array.isArray(actions.setFlags)) {
                for (const f of actions.setFlags) {
                    if (!this.state.flags[f]) { this.state.flags[f] = true; changed = true; }
                }
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
            const item = this._itemById(id);
            if (!item) return;

            const wrap = document.createElement('button');
            wrap.type = 'button';
            wrap.className = 'item';
            if (this.state.useItemId === id) wrap.classList.add('selected');
            wrap.title = 'Inspect';

            if (item.icon) {
                const img = document.createElement('img');
                img.src = this._resolveAsset(item.icon);
                img.alt = this._text(item.label) || id;
                wrap.appendChild(img);
            }
            const span = document.createElement('span');
            span.textContent = this._text(item.label) || id;
            wrap.appendChild(span);

            wrap.addEventListener('click', () => {
                if (this.state.useItemId === id) { this.exitUseMode(); return; }
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

        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '8px';
        row.style.justifyContent = 'flex-end';

        const btnUse = document.createElement('button');
        btnUse.textContent = this._t('engine.use.button', 'Použít');
        btnUse.addEventListener('click', () => { this.enterUseMode(item.id); this._closeModal(true); });

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
    _itemById(id)  { return (this.data.items || []).find(i => i.id === id); }
    _hasAll(list)  { return (list || []).every(x => this.state.inventory.includes(x)); }
    _hasAllFlags(list) { return (list || []).every(f => !!this.state.flags[f]); }
    _msg(t) { this.messageBox.textContent = t; }

    // --- modal ------------------------------------------------------------------

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
        const r = this._modalResolve;
        this._modalResolve = null;
        if (r) r(ok);
    }

    // --- highlight helpers ------------------------------------------------------

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

    // --- toasts -----------------------------------------------------------------

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

    // --- events -----------------------------------------------------------------

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

            // toast
            if (act.toast?.text) this.toast(this._text(act.toast.text), act.toast.ms ?? 5000);

            // scene image swap
            if (act.setSceneImage?.sceneId && act.setSceneImage?.image) {
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

            // glow hint
            if (act.highlightHotspot?.rect) {
                const h = act.highlightHotspot;
                this._enqueueOrShowHighlight({
                    sceneId: h.sceneId || (w.scene || this.state.scene),
                    rect: h.rect,
                    ms: h.ms ?? 3500,
                    outline: !!h.outline
                });
            }

            // dialogs
            if (act.openDialog) {
                this._dbg('events.then.openDialog →', act.openDialog, 'trigger=', trigger, 'scene=', this.state.scene);
                await this.openDialog(act.openDialog);
            }

            // flags
            if (act.setFlags) {
                let changed = false;
                if (Array.isArray(act.setFlags)) {
                    for (const f of act.setFlags) {
                        if (!this.state.flags[f]) { this.state.flags[f] = true; changed = true; }
                    }
                } else {
                    for (const [k, v] of Object.entries(act.setFlags)) {
                        if (!!this.state.flags[k] !== !!v) { this.state.flags[k] = !!v; changed = true; }
                    }
                }
                if (changed) this._saveState();
            }

            // mark once
            if (ev.once) {
                this.state.eventsFired = this.state.eventsFired || {};
                this.state.eventsFired[ev.id] = true;
                this._saveState();
            }
        }
    }

    // --- dialogs ---------------------------------------------------------------

    async _ensureDialogsLoaded() {
        if (this.dialogsData || !this.dialogsUrl) return;
        try {
            this._dbg('_ensureDialogsLoaded(): fetching', this.dialogsUrl);
            const r = await fetch(this.dialogsUrl, { cache: 'no-cache' });
            const json = await r.json();
            this.dialogsData = json || { dialogs: [], characters: [] };
            this._dbg('_ensureDialogsLoaded(): fetched OK', { dialogs: this.dialogsData.dialogs?.length ?? 0 });
        } catch (err) {
            console.error('[GAME] _ensureDialogsLoaded() failed:', err);
            this.dialogsData = { dialogs: [], characters: [] };
        }
    }

    async openDialog(arg) {
        const id = (typeof arg === 'string') ? arg : (arg && arg.id);
        this._dbg('openDialog() begin →', { id });
        if (!id) { console.warn('[GAME] openDialog() called without id'); return; }
        await this._ensureDialogsLoaded();
        if (!this.dialogsData) { this._msg('Dialogy nejsou k dispozici.'); return; }
        await this.dialogUI.open(id);
    }

    // --- persistence ------------------------------------------------------------

    _saveState() {
        this.state.signature = this._signature();
        localStorage.setItem('leeuwenhoek_escape_state', JSON.stringify(this.state));
    }

    _loadState() {
        try {
            const raw = localStorage.getItem('leeuwenhoek_escape_state');
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }
}
