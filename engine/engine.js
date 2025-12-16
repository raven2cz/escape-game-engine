// engine/engine.js
// Game engine core: scenes, i18n, dialogs, hero profile, inventory, puzzles, events.

import {createPuzzleRunner, openListModal} from './puzzles/index.js';
import {DialogUI} from './dialogs.js';

export class Game {
    constructor(opts) {
        // DOM refs
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
        this.scenesUrl = opts.scenesUrl;          // already prefixed by caller
        this.dialogsUrl = opts.dialogsUrl || null; // ./games/<id>/dialogs.json (optional)
        this.lang = (opts.lang || 'cs').toLowerCase();
        this.i18n = opts.i18n || {engine: {}, game: {}};

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
        try {
            return new URLSearchParams(location.search).get('debug') === '1';
        } catch {
            return false;
        }
    }

    _dbg(...args) {
        if (this._debugOn()) console.debug('[GAME]', ...args);
    }

    // --- version signature for safe restore ------------------------------------

    _signature() {
        const gid = this.meta?.id || 'unknown';
        const gver = this.meta?.version || '0';
        const lang = this.lang || 'cs';
        return `${gid}|${gver}|${lang}`;
    }

    // --- i18n helpers -----------------------------------------------------------

    _fmt(str, params) {
        if (!params) return str;
        return String(str).replace(/\{(\w+)}/g, (_, k) => (params[k] ?? `{${k}}`));
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
        this.data = await fetch(this.scenesUrl, {cache: 'no-cache'}).then(r => r.json());
        this.modalRoot.classList.add('hidden');

        this.meta = this.data?.meta || {};

        // Query flags
        let forceReset = false;
        let urlHero = null;
        try {
            const p = new URLSearchParams(location.search);
            forceReset = p.get('reset') === '1';
            urlHero = p.get('hero'); // may be null
        } catch { /* noop */
        }

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
            puzzleResults: [] // aggregateOnly results bucket
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

        await this.goto(this.state.scene, {noSave: true});
        this._renderInventory();
    }

    restart() {
        localStorage.removeItem('leeuwenhoek_escape_state');
        location.reload();
    }

    async goto(sceneId, opts = {}) {
        const scene = this.data.scenes.find(s => s.id === sceneId);
        if (!scene) return this._msg(this._t('engine.sceneNotFound', 'Scéna nebyla nalezena: {id}', {id: sceneId}));

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
        await this._processEvents({on: 'enterScene', scene: sceneId});

        if (scene.end) this._msg(this._t('engine.endCongrats', '🎉 Gratulujeme! Našel si cestu ven!'));
    }

    // --- hero profile -----------------------------------------------------------

    _getHeroProfileById(id) {
        const map = this.data?.heroes || {};
        return map[id] || null;
    }

    _setHeroInternal(id) {
        const prof = this._getHeroProfileById(id) || {
            id: 'adam',
            gender: 'm',
            name: 'Adam',
            assetsBase: 'assets/npc/adam/'
        };
        this.state.hero = {
            id: prof.id,
            gender: prof.gender || 'm',
            name: this._text(prof.name) || prof.name || 'Hero',
            assetsBase: prof.assetsBase || 'assets/npc/adam/'
        };
        this._saveState();
    }

    setHero(id) {
        this._setHeroInternal(id);
    }

    getHero() {
        return this.state?.hero || this._getHeroProfileById(this.data?.defaultHero) || {
            id: 'adam',
            gender: 'm',
            name: 'Adam',
            assetsBase: 'assets/npc/adam/'
        };
    }

    getHeroId() {
        return this.getHero().id;
    }

    getHeroGender() {
        return this.getHero().gender;
    }

    // --- use mode ---------------------------------------------------------------

    enterUseMode(itemId) {
        if (!itemId) return;
        this.state.useItemId = itemId;
        document.body.classList.add('use-on');
        this._renderInventory();
        const name = this._itemLabel(itemId);
        this.toast(this._t('engine.use.selected', 'Vybráno k použití: {name}. Klepni na cíl.', {name}), 800);
    }

    exitUseMode() {
        if (!this.state.useItemId) return;
        this.state.useItemId = null;
        document.body.classList.remove('use-on');
        this._renderInventory();
    }

    _removeItemFromInventory(id) {
        const i = this.state.inventory.indexOf(id);
        if (i >= 0) {
            this.state.inventory.splice(i, 1);
            this._renderInventory();
        }
    }

    _getUseGuardPolicy() {
        const s = this.currentScene?.settings?.useGuard
            ?? this.data?.settings?.accessibility?.useGuard
            ?? this.data?.settings?.useGuard; // fallback
        if (s === true) return 'hide';
        return (s === 'hide' || s === 'disable') ? s : 'off';
    }

    /**
     * Checks if an item can be used in the current scene.
     * @param {string} itemId - The item ID to check.
     * @returns {boolean|null} - true if usable, false if not usable, null if cannot determine (fail-safe).
     */
    _isItemApplicableHere(itemId) {
        // Fail-safe: if currentScene is not loaded, return null to indicate uncertainty
        if (!this.currentScene) {
            this._dbg('[GUARD] _isItemApplicableHere: currentScene is null/undefined, returning null (fail-safe)');
            return null;
        }

        const hs = this.currentScene.hotspots || [];

        // If scene has no hotspots at all, we can definitively say item is not usable here
        if (hs.length === 0) {
            return false;
        }

        return hs.some(h => {
            if (!h || !Array.isArray(h.acceptItems)) return false;

            const accepts = h.acceptItems.map(x => typeof x === 'string' ? { id: x } : x);
            if (!accepts.some(a => a?.id === itemId)) return false;

            if (h.requireItems && !this._hasAll(h.requireItems)) return false;
            if (h.requireFlags && !this._hasAllFlags(h.requireFlags)) return false;

            return true;
        });
    }

    // --- renderers --------------------------------------------------------------

    _renderHotspots() {
        this.hotspotLayer.innerHTML = '';
        const hotspots = this.currentScene.hotspots || [];

        hotspots.forEach((h, idx) => {
            const el = document.createElement('button');
            el.className = 'hotspot';

            // Default render rectangle (can be overridden by state)
            let visualRect = h.rect;

            // STATE LOGIC: Find the first matching state (Priority List)
            // The engine checks states from top to bottom. The first one with satisfied requireFlags wins.
            let activeState = null;
            if (h.states && Array.isArray(h.states)) {
                activeState = h.states.find(s => {
                    // If no flags required, it's a default/fallback state
                    if (!s.requireFlags) return true;
                    // Otherwise check if all flags are present
                    return this._hasAllFlags(s.requireFlags);
                });
            }

            // APPLY ACTIVE STATE
            if (activeState) {
                // 1. CSS Class (e.g., "state-success", "state-locked")
                if (activeState.cssClass) {
                    el.classList.add(activeState.cssClass);
                }

                // 2. Content (text label, icon, symbol)
                if (activeState.content) {
                    const span = document.createElement('span');
                    span.className = 'hs-content';
                    span.textContent = this._text(activeState.content);
                    el.appendChild(span);
                }

                // 3. Image Overlay (e.g., specific item graphic)
                if (activeState.image) {
                    const img = document.createElement('img');
                    img.src = this._resolveAsset(activeState.image);
                    img.className = 'hs-image';
                    el.appendChild(img);
                }

                // 4. Rect Override (if the visual state has different dimensions than the hit area)
                if (activeState.rect) {
                    visualRect = activeState.rect;
                }

                // 5. Interactivity (disable clicking if the state is final/passive)
                if (activeState.clickable === false) {
                    el.style.pointerEvents = 'none';
                    el.tabIndex = -1;
                }
            }

            // Apply calculated geometry
            el.style.left = visualRect.x + '%';
            el.style.top = visualRect.y + '%';
            el.style.width = visualRect.w + '%';
            el.style.height = visualRect.h + '%';

            // Bind interactions (only if not disabled by state)
            if (!activeState || activeState.clickable !== false) {
                el.setAttribute('data-index', String(idx));

                // Tooltip: prefer state label, fallback to hotspot label
                const label = (activeState && activeState.label) || h.label;
                if (label) el.title = this._text(label);

                el.addEventListener('click', (e) => {
                    // Editor guard
                    if (document.body.classList.contains('editor-on')) {
                        e.preventDefault(); e.stopPropagation(); return;
                    }
                    e.preventDefault();
                    this._activateHotspot(h).catch(err => this._msg(String(err)));
                });

                // --- Drop handling for item drag & drop ---
                if (h.acceptItems && Array.isArray(h.acceptItems)) {
                    this._setupHotspotDropHandlers(el, h, idx);
                }
            }

            this.hotspotLayer.appendChild(el);
        });
    }

    /**
     * Sets up drag & drop handlers for a hotspot that accepts items.
     * @param {HTMLElement} el - The hotspot element.
     * @param {object} hs - The hotspot configuration.
     * @param {number} idx - The hotspot index.
     */
    _setupHotspotDropHandlers(el, hs, idx) {
        // HTML5 Drag API - dragover is required to allow drop
        el.addEventListener('dragover', (e) => {
            const itemId = e.dataTransfer.types.includes('text/plain') ? 'pending' : null;
            if (itemId) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                el.classList.add('drop-target');
            }
        });

        el.addEventListener('dragleave', (e) => {
            el.classList.remove('drop-target');
        });

        el.addEventListener('drop', async (e) => {
            e.preventDefault();
            el.classList.remove('drop-target');

            const itemId = e.dataTransfer.getData('text/plain');
            if (!itemId) return;

            this._dbg('[DROP] Item dropped on hotspot:', itemId, hs);
            await this._handleItemDropOnHotspot(itemId, hs);
        });
    }

    async _activateHotspot(h) {
        console.log('[HOTSPOT] Activation triggered:', h.type, h);

        // 1. Use-mode guard (pokud držíme předmět a hotspot ho neumí přijmout)
        // Pokud hráč drží předmět, ale klikne na něco, co předměty nebere -> chyba.
        if (this.state.useItemId && !h.acceptItems) {
            this.toast(this._t('engine.use.notApplicable', 'Tento předmět tady nelze použít.'), 2500);
            this.exitUseMode();
            return;
        }

        // 2. Requirements check (Prerekvizity)
        // Kontrola, zda má hráč potřebné předměty v inventáři (pokud jsou vyžadovány)
        if (h.requireItems && !this._hasAll(h.requireItems)) {
            this._msg(this._t('engine.missingItems', 'Něco ti chybí…'));
            return;
        }
        // Kontrola, zda jsou splněny herní flagy (např. odemčeno)
        if (h.requireFlags && !this._hasAllFlags(h.requireFlags)) {
            this._msg(this._t('engine.needUnlock', 'Nejprve musíš něco odemknout…'));
            return;
        }

        // 3. Item Usage (Accept items) - Pokud hotspot přijímá předměty
        if (h.acceptItems && Array.isArray(h.acceptItems)) {
            const selected = this.state.useItemId;
            // Normalizace acceptItems (může to být string nebo objekt)
            const accepts = h.acceptItems.map(x => (typeof x === 'string' ? {id: x, consume: false} : x));

            // Zkusíme najít, zda vybraný předmět je v seznamu povolených
            const match = selected ? accepts.find(a => a.id === selected) : null;

            if (!match) {
                // Hráč drží předmět, ale ten sem nepatří
                if (selected) {
                    this.toast(this._t('engine.use.notApplicable', 'Tento předmět tady nelze použít.'), 2500);
                    this.exitUseMode();
                    return;
                }
                // Hráč nic nedrží, ale hotspot vyžaduje předmět -> zobrazíme hint?
                const allowHint = (h.showNeedHint !== false) && (this.data?.settings?.hints?.acceptNeed !== false);
                if (allowHint) {
                    const need = accepts.map(a => this._itemLabel(a.id)).filter(Boolean).join(', ');
                    this.toast(this._t('engine.use.needItem', 'Potřebuješ použít: {need}.', {need}), 3500);
                }
                return;
            }

            // SHODA: Hráč použil správný předmět
            if (match.consume) this._removeItemFromInventory(match.id);
            this.exitUseMode();

            if (h.onApply) await this._applyActions(h.onApply);
            else this.toast(this._t('engine.use.applied', 'Předmět byl použit.'), 2200);
            return;
        }

        // 4. Specific Actions (Rozcestník typů hotspotů)

        // --- NOVÁ ČÁST: Obecná akce Apply (bez předmětu) ---
        // Toto je to, co potřebujeme pro spuštění videa kliknutím na šipku
        if (h.type === 'apply') {
            console.log('[HOTSPOT] Executing Apply actions:', h.onApply);
            if (h.onApply) {
                await this._applyActions(h.onApply);
            }
            return;
        }
        // ---------------------------------------------------

        if (h.type === 'goTo') {
            await this.goto(h.target);
            return;
        }

        if (h.type === 'pickup') {
            if (!this.state.inventory.includes(h.itemId)) {
                this.state.inventory.push(h.itemId);
                this._renderInventory();
                this._msg(this._t('engine.pickedUp', 'Sebráno: {name}', {name: this._itemLabel(h.itemId)}));
                await this._stateChanged();
            } else {
                this._msg(this._t('engine.alreadyHave', 'Už máš: {name}', {name: this._itemLabel(h.itemId)}));
            }
            return;
        }

        if (h.type === 'puzzle') {
            const ref = h.puzzleRef || h.puzzle?.ref;
            if (!ref) {
                console.error('Puzzle hotspot missing puzzleRef');
                return;
            }

            const options = h.options || h.puzzle?.options || {};
            const background = h.puzzleBackground || h.puzzle?.background || null;
            const solvedKey = 'solved:pz:' + ref;

            if (this.state.solved[solvedKey]) {
                await this._applyActions(h.onSuccess);
                return;
            }

            const res = await this._openPuzzleByRef({
                ref,
                rect: h.rect || {x: 0, y: 0, w: 100, h: 100},
                options,
                background
            });

            if (options.aggregateOnly) {
                this._appendPuzzleResult({ref, ok: !!res?.ok, detail: res?.detail || null});
                if (res?.ok && h.onSuccess) await this._applyActions(h.onSuccess);
                if (!res?.ok && h.onFail) await this._applyActions(h.onFail);
                return;
            }

            if (res?.ok) {
                this._msg(this._t('engine.solved', 'Vyřešeno!'));
                this.state.solved[solvedKey] = true;
                this._saveState();
                await this._applyActions(h.onSuccess);
            } else {
                if (h.onFail) await this._applyActions(h.onFail);
                else this._msg(this._t('engine.puzzleFailed', 'Puzzle nevyřešeno.'));
            }
            return;
        }

        if (h.type === 'puzzleList') {
            const ok = await openListModal(this, {
                items: h.items || h.puzzleList?.items || [],
                rect: h.rect || {x: 0, y: 0, w: 100, h: 100},
                background: h.puzzleList?.background || h.background,
                aggregateOnly: !!(h.options?.aggregateOnly),
                blockUntilSolved: !!(h.options?.blockUntilSolved),
                puzzlesById: this.data.puzzles
            });
            if (ok) {
                if (h.onSuccess) await this._applyActions(h.onSuccess);
            } else {
                if (h.onFail) await this._applyActions(h.onFail);
            }
            return;
        }

        if (h.type === 'dialog') {
            await this.openDialog(h.dialogId);
            return;
        }

        // Fallback pro neznámé typy
        this._msg('Unknown hotspot type: ' + h.type);
        console.warn('Unknown hotspot type:', h);
    }

    // --- puzzles 2.0 helpers ----------------------------------------------------

    async _ensurePuzzlesLoaded() {
        // pokud už jsou v this.data.puzzles ve formátu mapy, hotovo
        if (this.data?.puzzles && typeof this.data.puzzles === 'object' && !Array.isArray(this.data.puzzles)) {
            return;
        }

        const url = this._resolveAsset('puzzles.json');
        let json = {};
        try {
            const r = await fetch(url, {cache: 'no-cache'});
            if (r.ok) json = await r.json();
        } catch {
            // ignore
        }

        // 1) { byId: { ... } }
        if (json && typeof json === 'object' && json.byId && typeof json.byId === 'object') {
            this.data.puzzles = json.byId;
            return;
        }
        // 2) [ { id, kind, ... }, ... ]
        if (Array.isArray(json)) {
            this.data.puzzles = Object.fromEntries(json.filter(p => p?.id).map(p => [p.id, p]));
            return;
        }
        // 3) { id1:{...}, id2:{...} }
        if (json && typeof json === 'object') {
            this.data.puzzles = json;
            return;
        }

        // fallback, empty map
        this.data.puzzles = {};
    }

    async _openPuzzleByRef({ref, rect, options = {}, background = null}) {
        await this._ensurePuzzlesLoaded();

        // If background not provided in hotspot, try to get it from puzzle config
        if (!background) {
            const puzzleCfg = this.data.puzzles?.[ref];
            if (puzzleCfg?.background) {
                background = puzzleCfg.background;
            }
        }

        return await new Promise((resolve) => {
            const runner = createPuzzleRunner({
                ref,
                rect,
                background: background ? this._resolveAsset(background) : null,
                instanceOptions: options,
                puzzlesById: this.data.puzzles || {},
                i18n: (k) => this._t(k, k),
                engine: this,
                onResolve: (result) => {
                    try {
                        runner?.unmount?.();
                    } catch (_) {
                    }
                    resolve(result || {ok: false});
                }
            });

            runner.mountInto(this.hotspotLayer);
        });
    }

    _appendPuzzleResult(obj) {
        this.state.puzzleResults.push(obj);
        if (this.state.puzzleResults.length > 500) {
            this.state.puzzleResults.splice(0, this.state.puzzleResults.length - 500);
        }
        this._saveState();
    }

    // --- apply action bundles (success/fail/shared) -----------------------------

    /**
     * Executes a bundle of actions (used by Hotspots, Puzzles onSuccess/onFail, Video onEnd).
     * Supports: toast, message, openDialog, highlightHotspot, playVideo, giveItem, setFlags, clearFlags, goTo.
     */
    async _applyActions(actions) {
        if (!actions) return;

        // 1. Visual Feedback
        if (actions.toast?.text) {
            this.toast(this._text(actions.toast.text), actions.toast.ms ?? 5000);
        }
        if (actions.message) {
            this._msg(this._text(actions.message));
        }

        // 2. Dialogs (Blocking)
        if (actions.openDialog) {
            await this.openDialog(actions.openDialog);
        }

        // 3. Highlight Hotspot
        if (actions.highlightHotspot?.rect) {
            const h = actions.highlightHotspot;
            this._enqueueOrShowHighlight({
                sceneId: h.sceneId || this.currentScene?.id,
                rect: h.rect,
                ms: h.ms ?? 3500,
                outline: !!h.outline
            });
        }

        // 4. Play Video (Blocking)
        if (actions.playVideo?.src) {
            await this._playVideo(actions.playVideo);

            if (actions.playVideo.onEnd) {
                await this._applyActions(actions.playVideo.onEnd);
            }
        }

        // 5. Logic (Items / Flags)
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
                    if (!this.state.flags[f]) {
                        this.state.flags[f] = true;
                        changed = true;
                    }
                }
            } else {
                for (const [k, v] of Object.entries(actions.setFlags)) {
                    if (!!this.state.flags[k] !== !!v) {
                        this.state.flags[k] = !!v;
                        changed = true;
                    }
                }
            }
        }

        if (actions.clearFlags && Array.isArray(actions.clearFlags)) {
            for (const f of actions.clearFlags) {
                if (this.state.flags[f]) {
                    delete this.state.flags[f];
                    changed = true;
                }
            }
        }

        // 6. State & Navigation
        if (changed) {
            this._renderHotspots();
            await this._stateChanged();
            if (this.currentScene) {
                this._drainHighlightsForScene(this.currentScene.id);
            }
        }

        if (actions.goTo) {
            await this.goto(actions.goTo);
        }
    }

    // backward compatibility
    async _applyOnSuccess(actions) {
        return this._applyActions(actions);
    }

    // --- state changed hook -----------------------------------------------------

    async _stateChanged() {
        this._saveState();
        await this._processEvents({on: 'stateChange'});
    }

    // --- inventory UI -----------------------------------------------------------

    _renderInventory() {
        this.inventoryRoot.innerHTML = '';
        (this.state.inventory || []).forEach(id => {
            const item = this._itemById(id);
            if (!item) return;

            const wrap = document.createElement('button');
            wrap.type = 'button';
            wrap.className = 'item';
            wrap.draggable = true; // Enable HTML5 drag
            wrap.dataset.itemId = id;
            if (this.state.useItemId === id) wrap.classList.add('selected');
            wrap.title = this._t('engine.item.hint', 'Klikni pro náhled, táhni pro použití');

            if (item.icon) {
                const img = document.createElement('img');
                img.src = this._resolveAsset(item.icon);
                img.alt = this._text(item.label) || id;
                img.draggable = false; // Prevent image from being dragged separately
                wrap.appendChild(img);
            }
            const span = document.createElement('span');
            span.textContent = this._text(item.label) || id;
            wrap.appendChild(span);

            // --- Drag & Drop handlers ---
            this._setupItemDragDrop(wrap, item);

            // --- Click handler (for preview) ---
            // Using pointerup with tracking to differentiate from drag
            let pointerDownTime = 0;
            let pointerMoved = false;

            wrap.addEventListener('pointerdown', (e) => {
                pointerDownTime = Date.now();
                pointerMoved = false;
            });

            wrap.addEventListener('pointermove', () => {
                pointerMoved = true;
            });

            wrap.addEventListener('pointerup', (e) => {
                // Ignore if this was a drag operation
                if (pointerMoved && Date.now() - pointerDownTime > 150) return;

                // Toggle use mode if already selected
                if (this.state.useItemId === id) {
                    this.exitUseMode();
                    return;
                }
                this._inspectItem(item);
            });

            // Prevent default click to avoid double-firing
            wrap.addEventListener('click', (e) => {
                e.preventDefault();
            });

            this.inventoryRoot.appendChild(wrap);
        });
    }

    /**
     * Sets up drag & drop handlers for an inventory item element.
     * @param {HTMLElement} el - The item button element.
     * @param {object} item - The item data object.
     */
    _setupItemDragDrop(el, item) {
        // HTML5 Drag API
        el.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', item.id);
            e.dataTransfer.effectAllowed = 'move';
            el.classList.add('is-dragging');
            document.body.classList.add('item-dragging');

            // Create custom drag image
            if (item.icon) {
                const dragImg = new Image();
                dragImg.src = this._resolveAsset(item.icon);
                // Use small offset so cursor is on the image
                e.dataTransfer.setDragImage(dragImg, 24, 24);
            }

            this._dbg('[DRAG] Started dragging item:', item.id);
        });

        el.addEventListener('dragend', (e) => {
            el.classList.remove('is-dragging');
            document.body.classList.remove('item-dragging');
            this._clearHotspotDropHighlights();
            this._dbg('[DRAG] Ended dragging item:', item.id);
        });

        // Touch-based drag for mobile (pointer events fallback)
        this._setupTouchDrag(el, item);
    }

    /**
     * Sets up touch-based drag for mobile devices where HTML5 drag doesn't work well.
     * @param {HTMLElement} el - The item element.
     * @param {object} item - The item data object.
     */
    _setupTouchDrag(el, item) {
        let touchStartTime = 0;
        let touchStartX = 0;
        let touchStartY = 0;
        let ghost = null;
        let isDragging = false;
        const DRAG_THRESHOLD = 10; // pixels
        const HOLD_TIME = 200; // ms to distinguish from tap

        const createGhost = () => {
            ghost = document.createElement('div');
            ghost.className = 'item-drag-ghost';
            if (item.icon) {
                const img = document.createElement('img');
                img.src = this._resolveAsset(item.icon);
                ghost.appendChild(img);
            }
            const label = document.createElement('span');
            label.textContent = this._text(item.label) || item.id;
            ghost.appendChild(label);
            document.body.appendChild(ghost);
        };

        const moveGhost = (x, y) => {
            if (!ghost) return;
            ghost.style.left = (x - 30) + 'px';
            ghost.style.top = (y - 30) + 'px';
        };

        const removeGhost = () => {
            if (ghost && ghost.parentNode) {
                ghost.parentNode.removeChild(ghost);
            }
            ghost = null;
        };

        const getHotspotUnderPoint = (x, y) => {
            const elements = document.elementsFromPoint(x, y);
            for (const elem of elements) {
                if (elem.classList.contains('hotspot') && elem.dataset.acceptsItems) {
                    return elem;
                }
            }
            return null;
        };

        el.addEventListener('touchstart', (e) => {
            touchStartTime = Date.now();
            const touch = e.touches[0];
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;
            isDragging = false;
        }, { passive: true });

        el.addEventListener('touchmove', (e) => {
            const touch = e.touches[0];
            const dx = touch.clientX - touchStartX;
            const dy = touch.clientY - touchStartY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const elapsed = Date.now() - touchStartTime;

            // Start drag if moved enough or held long enough while moving
            if (!isDragging && (distance > DRAG_THRESHOLD || (elapsed > HOLD_TIME && distance > 5))) {
                isDragging = true;
                createGhost();
                el.classList.add('is-dragging');
                document.body.classList.add('item-dragging');
                this._highlightAcceptingHotspots(item.id);
            }

            if (isDragging) {
                e.preventDefault(); // Prevent scroll while dragging
                moveGhost(touch.clientX, touch.clientY);

                // Highlight hotspot under touch
                const hotspot = getHotspotUnderPoint(touch.clientX, touch.clientY);
                this._updateHotspotDropHighlight(hotspot);
            }
        }, { passive: false });

        el.addEventListener('touchend', (e) => {
            if (isDragging) {
                const touch = e.changedTouches[0];
                const hotspot = getHotspotUnderPoint(touch.clientX, touch.clientY);

                if (hotspot) {
                    const hotspotIndex = parseInt(hotspot.dataset.index, 10);
                    const hs = this.currentScene?.hotspots?.[hotspotIndex];
                    if (hs) {
                        this._handleItemDropOnHotspot(item.id, hs);
                    }
                }

                removeGhost();
                el.classList.remove('is-dragging');
                document.body.classList.remove('item-dragging');
                this._clearHotspotDropHighlights();
                isDragging = false;
            }
        });

        el.addEventListener('touchcancel', () => {
            if (isDragging) {
                removeGhost();
                el.classList.remove('is-dragging');
                document.body.classList.remove('item-dragging');
                this._clearHotspotDropHighlights();
                isDragging = false;
            }
        });
    }

    /**
     * Highlights hotspots that accept the given item.
     * @param {string} itemId - The item ID being dragged.
     */
    _highlightAcceptingHotspots(itemId) {
        const hotspots = this.hotspotLayer.querySelectorAll('.hotspot');
        hotspots.forEach(el => {
            const idx = parseInt(el.dataset.index, 10);
            const hs = this.currentScene?.hotspots?.[idx];
            if (hs && this._hotspotAcceptsItem(hs, itemId)) {
                el.classList.add('accepts-drop');
                el.dataset.acceptsItems = 'true';
            }
        });
    }

    /**
     * Updates the visual highlight for the hotspot currently under the drag cursor.
     * @param {HTMLElement|null} hotspotEl - The hotspot element or null.
     */
    _updateHotspotDropHighlight(hotspotEl) {
        const hotspots = this.hotspotLayer.querySelectorAll('.hotspot');
        hotspots.forEach(el => {
            el.classList.toggle('drop-target', el === hotspotEl && el.dataset.acceptsItems === 'true');
        });
    }

    /**
     * Clears all drop-related highlights from hotspots.
     */
    _clearHotspotDropHighlights() {
        const hotspots = this.hotspotLayer.querySelectorAll('.hotspot');
        hotspots.forEach(el => {
            el.classList.remove('accepts-drop', 'drop-target');
            delete el.dataset.acceptsItems;
        });
    }

    /**
     * Checks if a hotspot accepts a specific item.
     * @param {object} hs - The hotspot configuration.
     * @param {string} itemId - The item ID to check.
     * @returns {boolean}
     */
    _hotspotAcceptsItem(hs, itemId) {
        if (!hs || !Array.isArray(hs.acceptItems)) return false;
        const accepts = hs.acceptItems.map(x => typeof x === 'string' ? { id: x } : x);
        if (!accepts.some(a => a?.id === itemId)) return false;
        if (hs.requireItems && !this._hasAll(hs.requireItems)) return false;
        if (hs.requireFlags && !this._hasAllFlags(hs.requireFlags)) return false;
        return true;
    }

    /**
     * Handles dropping an item on a hotspot.
     * @param {string} itemId - The dropped item ID.
     * @param {object} hs - The target hotspot configuration.
     */
    async _handleItemDropOnHotspot(itemId, hs) {
        if (!this._hotspotAcceptsItem(hs, itemId)) {
            this.toast(this._t('engine.use.notApplicable', 'Tento předmět tady nelze použít.'), 2500);
            return;
        }

        const accepts = hs.acceptItems.map(x => typeof x === 'string' ? { id: x, consume: false } : x);
        const match = accepts.find(a => a.id === itemId);

        if (match) {
            if (match.consume) this._removeItemFromInventory(itemId);

            if (hs.onApply) {
                await this._applyActions(hs.onApply);
            } else {
                this.toast(this._t('engine.use.applied', 'Předmět byl použit.'), 2200);
            }
        }
    }

    /**
     * Open the "Inspect Item" modal.
     * Final UX:
     * - No OK/Cancel footer at all.
     * - A top-right close (×) icon that reddens on hover.
     * - Inside body: single blue "Use" button (adventure style).
     * - Title/word/description are localized via _text/_t.
     *
     * No global modal API changes required — we defensively hide any footer if present.
     *
     * @param {{id:string, icon?:string, label?:string|object, meta?:{word?:string|object, description?:string|object}}} item
     * @returns {Promise<void>}
     */
    async _inspectItem(item) {
        // Build modal body
        const body = document.createElement('div');
        body.className = 'modal-body item-inspect';

        if (item.icon) {
            const img = document.createElement('img');
            img.src = this._resolveAsset(item.icon);
            img.alt = this._text(item.label) || item.id;
            img.className = 'modal-img';
            body.appendChild(img);
        }

        if (item.meta?.word) {
            const w = document.createElement('div');
            w.className = 'modal-word';
            const wordValue = this._text(item.meta.word);
            w.textContent = (wordValue && String(wordValue)) || String(item.meta.word);
            body.appendChild(w);
        }

        if (item.meta?.description) {
            const d = document.createElement('div');
            d.className = 'modal-desc';
            const descValue = this._text(item.meta.description);
            d.textContent = (descValue && String(descValue)) || String(item.meta.description);
            body.appendChild(d);
        }

        // Inline action dock (only "Use")
        const ops = document.createElement('div');
        ops.className = 'item-ops';

        const btnUse = document.createElement('button');
        btnUse.type = 'button';
        btnUse.className = 'btn btn--action';
        btnUse.textContent = this._t('engine.use.button', 'Použít');

        const policy = this._getUseGuardPolicy();
        if (policy !== 'off') {
            const allowed = this._isItemApplicableHere(item.id);
            // FAIL-SAFE: If allowed is null (cannot determine), show the button anyway
            // This prevents edge cases where button disappears due to race conditions
            const shouldHide = policy === 'hide' && allowed === false;
            const shouldDisable = policy === 'disable' && allowed === false;

            if (shouldHide) {
                // Button is intentionally not placed in the panel
                this._dbg('[ITEM] Use button hidden: policy=hide, allowed=false');
            } else {
                if (shouldDisable) {
                    btnUse.disabled = true;
                    btnUse.title = this._t('engine.use.disabledHere', 'Na této scéně teď nemáš kde použít.');
                    btnUse.classList.add('is-disabled');
                }
                btnUse.addEventListener('click', () => {
                    if (btnUse.disabled) return;
                    this.enterUseMode(item.id);
                    this._closeModal(true);
                });
                ops.appendChild(btnUse);
            }
        } else {
            btnUse.addEventListener('click', () => {
                this.enterUseMode(item.id);
                this._closeModal(true);
            });
            ops.appendChild(btnUse);
        }

        body.appendChild(ops);

        // Open modal WITHOUT footer labels (try to suppress buttons).
        // If the modal implementation still renders a footer, we hide it below.
        const p = this.openModal({
            title: this._text(item.label) || item.id,
            body,
            okLabel: '',          // suppress OK
            cancelLabel: ''       // suppress Cancel
        });

        // Tune modal DOM after it mounts: add header close icon; hide any footer.
        const tune = () => {
            const overlay = document.getElementById('modal');
            if (!overlay) return;
            const content = overlay.querySelector('.modal-content');
            if (!content) return;

            content.classList.add('modal--item');

            // Header with title + close icon (×)
            let header = content.querySelector('.modal-header');
            if (!header) {
                header = document.createElement('div');
                header.className = 'modal-header';

                const titleEl = document.createElement('div');
                titleEl.className = 'modal-title';
                titleEl.textContent = this._text(item.label) || item.id;

                const closeBtn = document.createElement('button');
                closeBtn.type = 'button';
                closeBtn.className = 'modal-close';
                closeBtn.setAttribute('aria-label', this._t('engine.modal.close', 'Close'));
                closeBtn.innerHTML = '&times;'; // ×
                closeBtn.addEventListener('click', () => this._closeModal(false));

                header.appendChild(titleEl);
                header.appendChild(closeBtn);

                // Remove any plain .modal-title block if present and insert header at the top
                const oldTitle = content.querySelector('.modal-title');
                if (oldTitle && oldTitle.parentElement === content) oldTitle.remove();
                content.insertBefore(header, content.firstChild);
            }

            // Hide any footer/actions row defensively (if openModal created it)
            const candidates = Array.from(content.children).slice(-3); // last few blocks
            candidates.forEach(node => {
                if (node.classList.contains('item-ops')) return; // keep our Use dock
                const btns = node.querySelectorAll('button');
                if (btns.length && (node === content.lastElementChild || /ok|cancel|zavř|close/i.test(node.textContent || ''))) {
                    node.style.display = 'none';
                    node.classList.add('modal-footer-hidden');
                }
            });
        };

        // Run after layout tick to ensure modal DOM exists
        setTimeout(tune, 0);

        await p;
    }

    _itemLabel(id) {
        return this._itemById(id)?.label ? this._text(this._itemById(id).label) : id;
    }

    _itemById(id) {
        return (this.data.items || []).find(i => i.id === id);
    }

    _hasAll(list) {
        return (list || []).every(x => this.state.inventory.includes(x));
    }

    _hasAllFlags(list) {
        return (list || []).every(f => !!this.state.flags[f]);
    }

    _msg(t) {
        this.messageBox.textContent = t;
    }

    // --- modal ------------------------------------------------------------------

    openModal({title, body, okLabel = 'OK', cancelLabel = 'Zrušit'}) {
        this.modalTitle.textContent = title || '';
        this.modalBody.innerHTML = '';
        this.modalBody.appendChild(body);
        this.modalRoot.classList.remove('hidden');
        this.modalOk.textContent = okLabel;
        this.modalCancel.textContent = cancelLabel;
        return new Promise(res => {
            this._modalResolve = res;
        });
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
        return {left: px(rect.x, w), top: px(rect.y, h), width: px(rect.w, w), height: px(rect.h, h)};
    }

    _showHighlightRect(rectPct, ms = 3500, {outline = false} = {}) {
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

    _enqueueOrShowHighlight({sceneId, rect, ms = 3500, outline = false}) {
        if (!sceneId || sceneId === this.currentScene?.id) {
            this._showHighlightRect(rect, ms, {outline});
        } else {
            this._pendingHighlights[sceneId] = this._pendingHighlights[sceneId] || [];
            this._pendingHighlights[sceneId].push({rect, ms, outline});
        }
    }

    _drainHighlightsForScene(sceneId) {
        const list = this._pendingHighlights[sceneId];
        if (!list || !list.length) return;
        let delay = 0;
        list.forEach(({rect, ms, outline}) => {
            setTimeout(() => this._showHighlightRect(rect, ms, {outline}), delay);
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

    /**
     * Process game events based on a trigger.
     * @param {{on: string, scene?: string}} trigger - The event trigger context.
     */
    async _processEvents(trigger) {
        const events = this.data.events || [];
        for (const ev of events) {
            if (!ev || !ev.id) continue;

            // 1. Check if already fired (for one-time events)
            if (ev.once && this.state.eventsFired?.[ev.id]) continue;

            const w = ev.when || {};

            // 2. Check Conditions
            // a) Trigger type match
            if (w.on && w.on !== trigger.on) continue;

            // b) Scene match (current scene or specified scene)
            if (w.scene && w.scene !== (trigger.scene || this.state.scene)) continue;

            // c) Inventory requirements
            if (w.requireItems && !this._hasAll(w.requireItems)) continue;

            // d) Flag requirements
            if (w.requireFlags && !this._hasAllFlags(w.requireFlags)) continue;

            // e) Missing items check
            if (w.missingItems && (w.missingItems.some(x => this.state.inventory.includes(x)))) continue;

            // --- MATCH FOUND ---

            // Mark event as fired IMMEDIATELY before executing actions.
            // This prevents recursion loops if an action (like a dialog) triggers
            // a state change that would otherwise re-evaluate and re-trigger this
            // same event while it is still pending/awaiting.
            if (ev.once) {
                this.state.eventsFired = this.state.eventsFired || {};
                this.state.eventsFired[ev.id] = true;
                this._saveState();
            }

            const act = ev.then || {};

            // 3. Execute Actions

            // Show Toast
            if (act.toast?.text) {
                this.toast(this._text(act.toast.text), act.toast.ms ?? 5000);
            }

            // Change Scene Image
            if (act.setSceneImage?.sceneId && act.setSceneImage?.image) {
                const sc = this.data.scenes.find(s => s.id === act.setSceneImage.sceneId);
                if (sc) {
                    sc.image = this._resolveAsset(act.setSceneImage.image);
                    // If we are currently in this scene, update the DOM immediately
                    if (this.currentScene?.id === sc.id) {
                        this.sceneImage.src = sc.image;
                        await new Promise(res => {
                            if (this.sceneImage.complete && this.sceneImage.naturalWidth) res();
                            else this.sceneImage.onload = () => res();
                        });
                    }
                }
            }

            // Open Dialog (Blocking)
            // The engine waits here until the dialog is fully closed by the user.
            if (act.openDialog) {
                await this.openDialog(act.openDialog);
            }

            // Highlight Hotspot
            // Executed after the dialog closes (if any).
            if (act.highlightHotspot?.rect) {
                const h = act.highlightHotspot;
                this._enqueueOrShowHighlight({
                    sceneId: h.sceneId || (w.scene || this.state.scene),
                    rect: h.rect,
                    ms: h.ms ?? 3500,
                    outline: !!h.outline
                });
            }

            // Play Video (Blocking)
            // Engine waits until the video ends or is skipped
            if (act.playVideo?.src) {
                await this._playVideo(act.playVideo);
                if (act.playVideo.onEnd) {
                    await this._applyActions(act.playVideo.onEnd);
                }
            }

            // Open Puzzle
            if (act.openPuzzle) {
                const ap = act.openPuzzle;
                const res = await this._openPuzzleByRef({
                    ref: ap.ref,
                    rect: ap.rect || {x: 0, y: 0, w: 100, h: 100},
                    options: ap.options || {},
                    background: ap.background || null
                });

                if (ap.options?.aggregateOnly) {
                    this._appendPuzzleResult({ref: ap.ref, ok: !!res?.ok, detail: res?.detail || null});
                } else {
                    if (res?.ok) {
                        if (ap.onSuccess) await this._applyActions(ap.onSuccess);
                    } else {
                        if (ap.onFail) await this._applyActions(ap.onFail);
                    }
                }
            }

            // Open Puzzle List
            if (act.openPuzzleList) {
                const apl = act.openPuzzleList;
                const ok = await openListModal(this, {
                    items: apl.items || [],
                    rect: apl.rect || {x: 0, y: 0, w: 100, h: 100},
                    background: apl.background || null,
                    aggregateOnly: !!apl.aggregateOnly,
                    blockUntilSolved: !!apl.blockUntilSolved,
                    puzzlesById: this.data.puzzles
                });
                if (ok) {
                    if (apl.onSuccess) await this._applyActions(apl.onSuccess);
                } else {
                    if (apl.onFail) await this._applyActions(apl.onFail);
                }
            }

            // Set Flags
            if (act.setFlags) {
                let changed = false;
                if (Array.isArray(act.setFlags)) {
                    for (const f of act.setFlags) {
                        if (!this.state.flags[f]) {
                            this.state.flags[f] = true;
                            changed = true;
                        }
                    }
                } else {
                    for (const [k, v] of Object.entries(act.setFlags)) {
                        if (!!this.state.flags[k] !== !!v) {
                            this.state.flags[k] = !!v;
                            changed = true;
                        }
                    }
                }
                if (changed) this._saveState();
            }
        }
    }

    // --- video ---------------------------------------------------------------

    /**
     * Plays a video overlay or embedded video.
     * Returns a Promise that resolves when the video ends or is skipped.
     * @param {object} cfg - { src, mode, rect, delay, allowSkip, onEnd }
     */
    async _playVideo(cfg) {
        const src = this._resolveAsset(cfg.src);

        // 1. Delay logic (optional wait before showing video)
        if (cfg.delay && cfg.delay > 0) {
            await new Promise(resolve => setTimeout(resolve, cfg.delay));
        }

        return new Promise((resolve) => {
            // Container setup
            const wrapper = document.createElement('div');
            wrapper.className = 'video-overlay';

            // Mode handling (fullscreen vs rect)
            if (cfg.mode === 'rect' && cfg.rect) {
                wrapper.classList.add('mode-rect');
                Object.assign(wrapper.style, {
                    left: cfg.rect.x + '%',
                    top: cfg.rect.y + '%',
                    width: cfg.rect.w + '%',
                    height: cfg.rect.h + '%'
                });
            } else {
                wrapper.classList.add('mode-fullscreen');
            }

            // Video element
            const video = document.createElement('video');
            video.src = src;
            video.autoplay = true;
            video.playsInline = true; // Critical for iOS/Tablets to prevent native fullscreen force
            video.controls = false;   // We handle interaction manually

            wrapper.appendChild(video);

            // Skip button (optional)
            if (cfg.allowSkip !== false) {
                const skipBtn = document.createElement('button');
                skipBtn.className = 'video-skip';
                skipBtn.innerHTML = '&times;'; // Close icon
                skipBtn.title = 'Skip Video';

                // Skip handler
                skipBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    finish();
                });
                wrapper.appendChild(skipBtn);

                // Allow clicking outside/on wrapper to skip (only in fullscreen mode)
                if (cfg.mode !== 'rect') {
                    wrapper.addEventListener('click', finish);
                }
            }

            // Mount to DOM (highest layer)
            document.body.appendChild(wrapper);

            // Lifecycle end handler
            let finished = false;
            function finish() {
                if (finished) return;
                finished = true;

                video.pause();
                if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);

                // Execute follow-up actions (onEnd) if defined
                // Note: We resolve first to unblock the engine, logic happens outside
                resolve();
            }

            // Event listeners
            video.addEventListener('ended', finish);

            video.addEventListener('error', (e) => {
                console.error('[VIDEO] Error playing:', src, e);
                finish(); // Don't block the game on error
            });

            // Start playback with error handling (autoplay policy)
            video.play().catch(err => {
                console.warn('[VIDEO] Autoplay blocked or failed:', err);
                // If autoplay is blocked, we might need a "Click to Play" UI here.
                // For now, we assume user interaction has already happened (dialog click).
            });
        });
    }

    // --- dialogs ---------------------------------------------------------------

    async _ensureDialogsLoaded() {
        if (this.dialogsData || !this.dialogsUrl) return;
        try {
            this._dbg('_ensureDialogsLoaded(): fetching', this.dialogsUrl);
            const r = await fetch(this.dialogsUrl, {cache: 'no-cache'});
            const json = await r.json();
            this.dialogsData = json || {dialogs: [], characters: []};
            this._dbg('_ensureDialogsLoaded(): fetched OK', {dialogs: this.dialogsData.dialogs?.length ?? 0});
        } catch (err) {
            console.error('[GAME] _ensureDialogsLoaded() failed:', err);
            this.dialogsData = {dialogs: [], characters: []};
        }
    }

    async openDialog(arg) {
        const id = (typeof arg === 'string') ? arg : (arg && arg.id);
        this._dbg('openDialog() begin →', {id});
        if (!id) {
            console.warn('[GAME] openDialog() called without id');
            return;
        }
        await this._ensureDialogsLoaded();
        if (!this.dialogsData) {
            this._msg('Dialogy nejsou k dispozici.');
            return;
        }
        return await this.dialogUI.open(id);
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
