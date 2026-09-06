// engine/engine.js
// Game engine core: scenes, i18n, dialogs, hero profile, inventory, puzzles, events, content panels.

import {createPuzzleRunner} from './puzzles/index.js';
import {flagEntries} from './utils.js';
import {DialogUI} from './dialogs.js';
import {ContentPanel} from './content.js';

/**
 * Shape of the persisted state, versioned independently of the game.
 *
 * The game version says "this content changed"; this says "the engine reads the
 * state differently now". They move for different reasons, and conflating them
 * meant a state written by an older build was adopted whole, missing whatever
 * fields had been added since. See EI-012.
 *
 * Adding a field needs no new version: _normalizeState() fills a default for
 * anything absent. Bump this, and add a step to _migrateState(), when a field
 * that already exists changes meaning, because normalisation cannot tell an old
 * meaning from a current one.
 */
const STATE_SCHEMA_VERSION = 1;

/**
 * The one key every game and every team on a device used to share, named after
 * the first game ever written with this engine. Kept only to hand a lesson that
 * is already in progress over to the namespaced key. See EI-002.
 */
const LEGACY_STATE_KEY = 'leeuwenhoek_escape_state';

/**
 * What the engine knows about a hero when the game has not said.
 *
 * It used to be Adam, with portraits under `assets/npc/adam/`, which is one
 * particular character in one particular game. Five of the six shipped games
 * define no heroes at all, so every one of them stored a phantom Adam pointing
 * into leeuwenhoek's assets. A hero belongs to a game, not to the engine: this
 * is here so that `getHero()` never returns null, not to stand in for one.
 * See EI-015.
 */
const NEUTRAL_HERO = Object.freeze({
    id: 'hero',
    gender: 'n',
    name: '',
    assetsBase: ''
});

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

        // Where the state is kept. localStorage by default; the hosted runtime
        // will pass its own, with the authoritative copy in a Durable Object and
        // localStorage as a local cache. This is the seam the runtime and the
        // teacher's dashboard both need, which is why it exists before either.
        this._ownsLocalStorage = !opts.storage;
        this.storage = opts.storage || this._localStorage();

        // How long to wait for a scene image before carrying on without it.
        // A school network drops requests, and a request that is dropped rather
        // than refused never fires anything at all. See EI-003.
        this.sceneImageTimeoutMs = opts.sceneImageTimeoutMs ?? 8000;

        // How long a video gets to start playing before the pupil is offered a
        // way past it, even when the game asked for no skipping. See EI-022.
        this.videoStartTimeoutMs = opts.videoStartTimeoutMs ?? 6000;

        // State
        this.data = null;
        this.meta = {};
        this.dialogsData = null;
        this.state = null;
        this.currentScene = null;
        this._modalResolve = null;
        this._pendingHighlights = {};
        this._navToken = 0;
        this._hotspotBusy = false;

        // Toast container
        this.toastRoot = document.createElement('div');
        this.toastRoot.className = 'toast-container';
        document.body.appendChild(this.toastRoot);

        // Dialog UI
        this.dialogUI = new DialogUI(this);

        // Content Panel UI
        this.contentPanel = new ContentPanel(this);

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

    /**
     * What a saved state has to match to be reused: this game, this build of it.
     *
     * The language used to be part of it, so switching language behaved like
     * switching to a different game and wiped the lesson. It does not change
     * what a team has done. The version stays: a state from an older build can
     * name scenes and items that no longer exist. See EI-002.
     */
    _signature() {
        const gid = this.meta?.id || 'unknown';
        const gver = this.meta?.version || '0';
        return `${gid}|${gver}`;
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

        if (forceReset) {
            // Consume the flag. It used to stay in the address bar and was
            // re-evaluated on every start, so a pupil who reloaded mid-game lost
            // everything. Every demo link in the README carries reset=1, so this
            // was not a corner case.
            try {
                const url = new URL(location.href);
                url.searchParams.delete('reset');
                history.replaceState(null, '', url.pathname + url.search + url.hash);
            } catch { /* noop */
            }
        }

        // Fresh state if the signature does not match or a reset was requested.
        // A state left under the old shared key is adopted once, so that this
        // change does not end a lesson that is already running.
        let saved = forceReset ? null : this._loadState();
        let adopted = false;
        if (forceReset) {
            // The old entry has to go too, or a later restart() finds it and
            // resurrects the lesson the teacher just reset away.
            this._discardLegacyState();
        } else if (!saved) {
            saved = this._adoptLegacyState();
            adopted = !!saved;
        }

        this.state = this._restoreState(saved);

        if (adopted) {
            // Adoption removed the old entry, so until this write the progress
            // exists only in memory. A pupil whose tablet looks stuck reloads
            // twice, and the second reload would have found neither key.
            this._saveState();
        }

        // initialize hero (default → then URL override if present)
        // A game that defines no heroes gets none. Inventing one meant every
        // game but leeuwenhoek carried a hero it had never heard of. EI-015.
        if (!this.state.hero) {
            const defId = this.data?.defaultHero || Object.keys(this.data?.heroes || {})[0] || null;
            if (defId) this._setHeroInternal(defId);
        }
        if (urlHero) {
            // URL always wins (do not nuke progress)
            this._setHeroInternal(urlHero);
            this._dbg('[HERO] overridden from URL →', urlHero, this.state.hero);
        }

        // Write the run down as soon as it exists. This used to happen only as a
        // side effect of hero initialisation, which stopped for any game that
        // defines no heroes once EI-015 removed the invented one. Nothing was
        // lost by that - there was nothing to lose yet - but persistence should
        // not depend on which unrelated thing happened to save first, and the
        // hosted runtime will want a run to exist from the moment it starts.
        this._saveState();

        await this.goto(this.state.scene, {noSave: true});
        this._renderInventory();
    }

    restart() {
        this.storage.clear?.();
        this._discardLegacyState();
        location.reload();
    }

    async goto(sceneId, opts = {}) {
        const scene = this.data.scenes.find(s => s.id === sceneId);
        if (!scene) return this._msg(this._t('engine.sceneNotFound', 'Scéna nebyla nalezena: {id}', {id: sceneId}));

        const token = ++this._navToken;

        this.currentScene = scene;

        const outcome = await this._loadSceneImage(this._sceneImageSrc(scene));

        // A newer navigation started while this one was waiting for its image.
        // That one owns the screen now; carrying on here would render this scene
        // over the top of it.
        if (token !== this._navToken) return;

        this._renderHotspots();
        this._msg(this._text(scene.title) || '');

        if (outcome === 'ok') {
            // `state.scene` moves only now, and this is the whole of "the scene
            // is not recorded until it displays". Skipping just the save below
            // is not enough: the enter events that run a few lines down save the
            // state for their own reasons the moment a once-event marks itself,
            // and almost every scene in the shipped games has one. `state.scene`
            // is the resume point, so it stays on the last scene that worked.
            // Where the pupil actually is, is `currentScene`. See EI-003.
            this.state.scene = sceneId;
            this.state.visited[sceneId] = true;
            if (!opts.noSave) this._saveState();
        } else {
            if (outcome === 'timeout') {
                // A timeout means "not yet", not "never". Congested school
                // Wi-Fi takes longer than eight seconds over a 700 KB scene
                // often enough to matter, and without this the pupil plays on
                // in a scene that is never recorded, so a reload sends them
                // back to wherever they were several minutes earlier, with this
                // scene's once-events already spent. Still guarded by the
                // token: a load that arrives after a newer navigation belongs
                // to that one.
                this.sceneImage.addEventListener('load', () => {
                    if (token !== this._navToken) return;
                    this.state.scene = sceneId;
                    this.state.visited[sceneId] = true;
                    if (!opts.noSave) this._saveState();
                }, {once: true});
            }

            // Say something. A blank screen with no explanation is the worst
            // outcome on a school network, and it is the one that gets reported
            // as "the game is broken".
            this.toast(this._t(
                'engine.sceneImageFailed',
                'Obrázek scény se nepodařilo načíst. Hraj dál, nebo zkus stránku obnovit.',
            ), 6000);
        }

        // queued highlights for this scene
        this._drainHighlightsForScene(sceneId);
        // events: enterScene
        await this._processEvents({on: 'enterScene', scene: sceneId});

        // scene-level auto content panel
        if (scene.content?.ref) {
            const trigger = scene.content.trigger || 'enter';
            if (trigger === 'enter') {
                const cId = scene.content.ref;
                const cOnce = scene.content.once ?? true;
                if (!cOnce || !this.state.contentShown?.[cId]) {
                    await this.contentPanel.open(cId);
                }
            }
        }

        if (scene.end) this._msg(this._t('engine.endCongrats', '🎉 Gratulujeme! Našel si cestu ven!'));
    }

    /**
     * Image to display for a scene, honouring a change made by setSceneImage.
     *
     * The override lives in the state rather than on `this.data`, because
     * `this.data` is rebuilt from the game files on every load while the event
     * that made the change is `once` and will not run again. Mutating the data
     * only meant the chest in leeuwenhoek shut itself again after a reload,
     * with `chest_opened` still set and the key still in the inventory. EI-006.
     */
    /**
     * Where a puzzle or a content panel is mounted.
     *
     * Over the scene, but *beside* the hotspot layer rather than inside it. The
     * layer is a hit-testing surface: `_renderHotspots()` owns its children and
     * used to clear them wholesale, which tore an open puzzle out of the DOM
     * without settling it and left the engine, and the activation lock with it,
     * waiting for a promise nothing would resolve. See EI-023.
     *
     * The geometry is unchanged. The layer is `position: absolute` with all four
     * offsets at zero inside a `position: relative` scene container, so it fills
     * that container exactly; a surface positioned in percentages resolves them
     * against the same box either way. Same host as the dialog overlay uses.
     */
    _modalHost() {
        const container = this.sceneImage?.closest('#sceneContainer');
        if (container) return container;

        // No scene container: a bare test DOM, or the engine embedded in
        // something else. Fall back to the hotspot layer rather than to
        // document.body. A surface here is positioned in percentages, and on
        // the body they would resolve against the viewport, so an embedded
        // 800x450 game would open a puzzle the size of the screen. Mounting in
        // the layer is no longer destructive: _renderHotspots() removes only
        // the children it drew.
        return this.hotspotLayer || document.body;
    }

    /** The scene the pupil is looking at, which is not always the saved one. */
    _hereId() {
        return this.currentScene?.id ?? this.state?.scene;
    }

    _sceneImageSrc(scene) {
        const override = this.state?.sceneImages?.[scene.id];
        return this._resolveAsset(override || scene.image);
    }

    /**
     * Point the scene image at `src` and wait for it to display, fail, or run
     * out of patience. Resolves 'ok' | 'error' | 'timeout' and never rejects,
     * because a game that refuses to leave a scene is worse than a scene with a
     * missing picture.
     *
     * The listeners are added, not assigned. There is one <img> for the whole
     * game, so `onload = ...` meant a second navigation replaced the first one's
     * handler and whoever awaited the first waited forever. Two navigations also
     * share one image element and therefore one `load` event, which is why the
     * caller checks a navigation token instead of trusting the event. EI-003.
     *
     * Compare engine/dialogs.js, where the portrait preload has handled onerror
     * from the start. The scene loader never got the same treatment.
     */
    _loadSceneImage(src) {
        const img = this.sceneImage;
        img.src = src;

        if (img.complete && img.naturalWidth) return Promise.resolve('ok');

        return new Promise(resolve => {
            let settled = false;

            const finish = (outcome) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                img.removeEventListener('load', onLoad);
                img.removeEventListener('error', onError);
                resolve(outcome);
            };

            const onLoad = () => finish('ok');
            const onError = () => finish('error');
            const timer = setTimeout(() => finish('timeout'), this.sceneImageTimeoutMs);

            img.addEventListener('load', onLoad, {once: true});
            img.addEventListener('error', onError, {once: true});
        });
    }

    // --- hero profile -----------------------------------------------------------

    _getHeroProfileById(id) {
        const map = this.data?.heroes || {};
        return map[id] || null;
    }

    _setHeroInternal(id) {
        // An id the game does not define keeps its own name and gets no assets,
        // rather than being turned into somebody else's hero. See NEUTRAL_HERO.
        const prof = this._getHeroProfileById(id) || {...NEUTRAL_HERO, id, name: id};
        this.state.hero = {
            id: prof.id,
            gender: prof.gender || NEUTRAL_HERO.gender,
            name: this._text(prof.name) || prof.name || '',
            assetsBase: prof.assetsBase || ''
        };
        this._saveState();
    }

    setHero(id) {
        this._setHeroInternal(id);
    }

    getHero() {
        return this.state?.hero
            || this._getHeroProfileById(this.data?.defaultHero)
            || {...NEUTRAL_HERO};
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
            // An item that no longer exists must not stay selected for use. The
            // save below would otherwise record a useItemId naming an item the
            // pupil no longer has, and _activateHotspot checks the held item
            // against acceptItems without looking in the inventory, so after a
            // reload the same item could be spent a second time.
            if (this.state.useItemId === id) this.exitUseMode();
            this._renderInventory();
            // Persist. The item disappeared from the screen but not from
            // storage, and was saved only by accident when a following onApply
            // happened to change a flag or the scene. Every use in the shipped
            // games has such an action, which is why nothing looked wrong; the
            // first game to consume an item and only say so would have had it
            // back after a reload, with the puzzle it was consumed by already
            // solved. See EI-011.
            this._saveState();
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
        // Remove only what this method and the highlight helper put here.
        //
        // A puzzle and a content panel mount into this same layer, and clearing
        // it wholesale tore them out of the DOM without ever settling them: the
        // puzzle's promise was left waiting for an onResolve that could no
        // longer come, and since EI-013 the activation lock waits with it, so
        // afterwards no tap did anything at all. See EI-023.
        this.hotspotLayer.querySelectorAll(':scope > .hotspot, :scope > .hs-glow')
            .forEach(el => el.remove());

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

                    // One activation at a time. A double tap is an ordinary
                    // input on a tablet, and without this it opens two puzzles
                    // over each other, or two dialogs of which only the second
                    // can ever be closed. The flag lives on the Game rather than
                    // on the element, because _renderHotspots() rebuilds these
                    // elements while an activation is still running. EI-013.
                    if (this._hotspotBusy) return;
                    this._hotspotBusy = true;
                    this._activateHotspot(h)
                        .catch(err => this._msg(String(err)))
                        .finally(() => { this._hotspotBusy = false; });
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
        this._dbg('[HOTSPOT] activation:', h.type, h);

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
            this._dbg('[HOTSPOT] apply actions:', h.onApply);
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

        if (h.type === 'dialog') {
            await this.openDialog(h.dialogId);
            return;
        }

        if (h.type === 'content') {
            await this.contentPanel.open(h.contentRef);
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

            runner.mountInto(this._modalHost());
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
     * Supports: toast, message, openDialog, openContent, highlightHotspot, playVideo, giveItem, setFlags, clearFlags, goTo.
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

        // 2b. Content Panels (Blocking)
        if (actions.openContent) {
            await this.contentPanel.open(actions.openContent);
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

        for (const [flag, value] of flagEntries(actions.setFlags)) {
            if (!!this.state.flags[flag] !== value) {
                this.state.flags[flag] = value;
                changed = true;
            }
        }

        for (const [flag] of flagEntries(actions.clearFlags)) {
            if (this.state.flags[flag]) {
                delete this.state.flags[flag];
                changed = true;
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

            // Activation lives on `click`, not on `pointerup`. The element is a
            // real <button>, so Enter and Space produce a click and no pointer
            // event at all; handling only pointerup made inventory unreachable
            // from the keyboard. Pointer events stay, but only to tell a tap
            // apart from a drag.
            wrap.addEventListener('click', (e) => {
                e.preventDefault();

                const wasDrag = pointerMoved && Date.now() - pointerDownTime > 150;
                pointerMoved = false;
                if (wasDrag) return;

                // Toggle use mode if already selected
                if (this.state.useItemId === id) {
                    this.exitUseMode();
                    return;
                }
                this._inspectItem(item);
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

        // Under the same lock as a hotspot click, and for the same reason. This
        // is not the secondary path: dragging an item onto a target is what the
        // inventory tooltip tells the pupil to do, and the six warp-engine
        // module slots are only reachable this way. Without it, the actions a
        // drop sets off run unguarded, and a flag set early by an event (EI-001)
        // can be acted on by a tap before that event has finished presenting
        // itself. See EI-013.
        if (this._hotspotBusy) return;
        this._hotspotBusy = true;
        try {
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
        } finally {
            this._hotspotBusy = false;
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
            //
            // The header survives _closeModal(), which only hides the overlay,
            // so on every inspection after the first one this block is skipped.
            // The title is therefore set below, outside the guard: doing it only
            // on creation left the previous item's name on screen.
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

            const headerTitle = header.querySelector('.modal-title');
            if (headerTitle) headerTitle.textContent = this._text(item.label) || item.id;

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
            // Where the pupil is, is `currentScene`. `state.scene` is the resume
            // point and lags behind it when a scene image failed to load, so it
            // is only the last resort here. See EI-003.
            if (w.scene && w.scene !== (trigger.scene || this._hereId())) continue;

            // c) Inventory requirements
            if (w.requireItems && !this._hasAll(w.requireItems)) continue;

            // d) Flag requirements
            if (w.requireFlags && !this._hasAllFlags(w.requireFlags)) continue;

            // e) Missing items check
            if (w.missingItems && (w.missingItems.some(x => this.state.inventory.includes(x)))) continue;

            // --- MATCH FOUND ---

            const act = ev.then || {};

            // Set Flags
            //
            // Runs before the event is marked as fired, and that order is the
            // whole point. Everything else in `then` is presentation, and most
            // of it blocks: the dialog and the video only return once the pupil
            // has clicked through them. Flags are the durable consequence, the
            // thing later scenes and hotspots are gated on, so they have to be
            // in storage before the run can be interrupted. Marking the event
            // first and setting the flags last meant a reload during the dialog
            // left the event recorded as done with its effect never applied, and
            // a once-event does not get a second chance. See EI-001.
            //
            // Safe to move up: unlike _applyActions, this block only writes
            // state and saves. It does not call _stateChanged(), so it cannot
            // re-enter _processEvents, which is what the marking below guards
            // against.
            let flagsChanged = false;
            for (const [flag, value] of flagEntries(act.setFlags)) {
                if (!!this.state.flags[flag] !== value) {
                    this.state.flags[flag] = value;
                    flagsChanged = true;
                }
            }
            if (flagsChanged) this._saveState();

            // Mark event as fired IMMEDIATELY before executing actions.
            // This prevents recursion loops if an action (like a dialog) triggers
            // a state change that would otherwise re-evaluate and re-trigger this
            // same event while it is still pending/awaiting.
            if (ev.once) {
                this.state.eventsFired = this.state.eventsFired || {};
                this.state.eventsFired[ev.id] = true;
                this._saveState();
            }

            // 3. Execute Actions

            // Show Toast
            if (act.toast?.text) {
                this.toast(this._text(act.toast.text), act.toast.ms ?? 5000);
            }

            // Change Scene Image
            //
            // Recorded in the state, not on this.data, and saved before the
            // blocking actions below run. See _sceneImageSrc(). EI-006.
            if (act.setSceneImage?.sceneId && act.setSceneImage?.image) {
                const sc = this.data.scenes.find(s => s.id === act.setSceneImage.sceneId);
                if (sc) {
                    this.state.sceneImages = this.state.sceneImages || {};
                    this.state.sceneImages[sc.id] = act.setSceneImage.image;
                    this._saveState();

                    // If we are currently in this scene, update the DOM immediately
                    if (this.currentScene?.id === sc.id) {
                        // Through the same loader as goto(), so a missing
                        // replacement image cannot hang the event either.
                        await this._loadSceneImage(this._sceneImageSrc(sc));
                    }
                }
            }

            // Open Dialog (Blocking)
            // The engine waits here until the dialog is fully closed by the user.
            if (act.openDialog) {
                await this.openDialog(act.openDialog);
            }

            // Open Content Panel (Blocking)
            if (act.openContent) {
                await this.contentPanel.open(act.openContent);
            }

            // Highlight Hotspot
            // Executed after the dialog closes (if any).
            if (act.highlightHotspot?.rect) {
                const h = act.highlightHotspot;
                this._enqueueOrShowHighlight({
                    sceneId: h.sceneId || (w.scene || this._hereId()),
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
            // Flags for this event were applied above, before it was marked as
            // fired, so that an interrupted run cannot lose them.
        }
    }

    // --- video ---------------------------------------------------------------

    /**
     * Plays a video overlay or embedded video.
     * Returns a Promise that resolves when the video ends or is skipped.
     *
     * Nothing here assumes the video plays. It used to: the promise settled on
     * `ended` or `error` and on nothing else, a refused `play()` was logged and
     * then waited on forever, and `allowSkip: false` meant there was not even a
     * button. Both warp-engine videos are `allowSkip: false` and the intro one
     * runs on the first tap of the game, so a lesson could end on a black
     * screen. See EI-022.
     *
     * The tablet cases this is built around, in the order they bite:
     *   - iOS refuses playback with sound unless the call is close enough to a
     *     real touch, and refuses it outright in Low Power Mode. So a refused
     *     `play()` puts a play button on screen, and tapping that retries from
     *     inside a real touch handler, which is what iOS wants. One tap and the
     *     video plays properly, with its sound.
     *   - A school network can leave a video buffering indefinitely. If nothing
     *     has started playing by `videoStartTimeoutMs`, or the download stalls
     *     part way through, a way out appears even when the author asked for no
     *     skipping. An intro somebody skipped beats an intro nobody can pass.
     *
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

            const allowSkip = cfg.allowSkip !== false;

            let finished = false;
            let watchdog = null;

            const finish = () => {
                if (finished) return;
                finished = true;

                clearTimeout(watchdog);
                video.pause();
                if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);

                // Execute follow-up actions (onEnd) if defined
                // Note: We resolve first to unblock the engine, logic happens outside
                resolve();
            };

            // The skip control exists even when the author asked for no
            // skipping. It stays hidden until the video shows that it cannot
            // play, and once shown it stays: taking a control away again from
            // somebody who has just seen it is its own kind of stuck.
            const skipBtn = document.createElement('button');
            skipBtn.type = 'button';
            skipBtn.className = 'video-skip';
            skipBtn.innerHTML = '&times;'; // Close icon
            const skipLabel = this._t('engine.video.skip', 'Přeskočit video');
            skipBtn.title = skipLabel;
            skipBtn.setAttribute('aria-label', skipLabel);
            skipBtn.hidden = !allowSkip;
            skipBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                finish();
            });
            wrapper.appendChild(skipBtn);

            const offerWayOut = () => {
                skipBtn.hidden = false;
            };

            // Shown only when the browser has actually refused to start.
            const playBtn = document.createElement('button');
            playBtn.type = 'button';
            playBtn.className = 'video-play';
            playBtn.textContent = this._t('engine.video.play', '▶ Přehrát');
            playBtn.hidden = true;
            playBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Retried from inside a real touch handler, which is the only
                // kind iOS accepts for a video with sound.
                video.play().then(() => {
                    playBtn.hidden = true;
                }).catch(err => {
                    console.warn('[VIDEO] Playback refused again:', err);
                });
            });
            wrapper.appendChild(playBtn);

            // Allow clicking outside/on the wrapper to skip (only in fullscreen
            // mode, and only when skipping was allowed in the first place: an
            // accidental tap must not eat an intro the author wanted watched).
            if (allowSkip && cfg.mode !== 'rect') {
                wrapper.addEventListener('click', finish);
            }

            // Mount to DOM (highest layer)
            document.body.appendChild(wrapper);

            const armWatchdog = () => {
                clearTimeout(watchdog);
                watchdog = setTimeout(offerWayOut, this.videoStartTimeoutMs);
            };

            // Event listeners
            video.addEventListener('playing', () => {
                clearTimeout(watchdog);
                playBtn.hidden = true;
            });

            video.addEventListener('ended', finish);

            video.addEventListener('error', (e) => {
                console.error('[VIDEO] Error playing:', src, e);
                finish(); // Don't block the game on error
            });

            // Buffering. Rather than trusting any one event to mean "this is
            // never coming back" - Safari has been unreliable about `stalled`
            // and Chrome has fired it spuriously - restart the same clock that
            // watches for a video that never starts. Playback resuming clears
            // it again, so a normal buffer is invisible and one that does not
            // recover ends up offering a way out.
            video.addEventListener('waiting', armWatchdog);
            video.addEventListener('stalled', armWatchdog);

            // The most ordinary interruption on a tablet: the pupil switches
            // apps, iOS pauses the video, and coming back leaves a still frame
            // with no controls, no `ended` and no `stalled`. There is no way for
            // the pupil to pause deliberately - the element has none - so any
            // pause that is not the engine shutting the overlay down means the
            // video needs starting again.
            video.addEventListener('pause', () => {
                if (finished || video.ended) return;
                playBtn.hidden = false;
                offerWayOut();
            });

            armWatchdog();

            // Start playback with error handling (autoplay policy)
            video.play().catch(err => {
                console.warn('[VIDEO] Autoplay blocked or failed:', err);
                playBtn.hidden = false;
                offerWayOut();
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

    /**
     * One entry per game. It used to be one entry per origin, so opening a
     * second game destroyed the first one's progress. See EI-002.
     *
     * Not yet one entry per team: that needs a run identity, which has to come
     * from the hosted runtime rather than be invented here. The key is shaped so
     * the run and team can be added to it without moving anything else.
     */
    _storageKey() {
        return `state:${this.meta?.id || 'unknown'}`;
    }

    /** Default storage: the browser's, behind the same interface as any other. */
    _localStorage() {
        return {
            load: () => {
                try {
                    const raw = localStorage.getItem(this._storageKey());
                    return raw ? JSON.parse(raw) : null;
                } catch {
                    return null;
                }
            },
            save: (state) => {
                try {
                    localStorage.setItem(this._storageKey(), JSON.stringify(state));
                } catch { /* quota, private mode: losing a save beats throwing */
                }
            },
            clear: () => {
                try {
                    localStorage.removeItem(this._storageKey());
                } catch { /* noop */
                }
            },
        };
    }

    _saveState() {
        this.state.signature = this._signature();
        this.state.stateSchemaVersion = STATE_SCHEMA_VERSION;
        this.storage.save(this.state);
    }

    _loadState() {
        return this.storage.load();
    }

    /** The state a game starts from. Every field the engine reads is listed here. */
    _freshState() {
        return {
            stateSchemaVersion: STATE_SCHEMA_VERSION,
            signature: this._signature(),
            inventory: [],
            solved: {},
            flags: {},
            visited: {},
            eventsFired: {},
            scene: this._startSceneId(),
            useItemId: null,
            hero: null,
            puzzleResults: [], // aggregateOnly results bucket
            contentShown: {},  // tracks "once" content panels
            sceneImages: {},   // scene id -> image set by setSceneImage
        };
    }

    _startSceneId() {
        return this.data?.startScene || this.data?.scenes?.[0]?.id || null;
    }

    /**
     * Decide whether a stored state belongs to this game, and make it safe to
     * use if it does.
     */
    _restoreState(saved) {
        if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return this._freshState();
        if (saved.signature !== this._signature()) return this._freshState();
        return this._normalizeState(this._migrateState(saved));
    }

    /**
     * Bring a state written under an older schema up to the current one.
     *
     * Empty on purpose: v1 is the first numbered schema, and everything written
     * before it differs only by fields that were not there yet, which
     * _normalizeState() already handles. A step belongs here when a field
     * changes meaning rather than appearing.
     */
    _migrateState(saved) {
        return saved;
    }

    /**
     * Fill in what is missing and drop what is the wrong type.
     *
     * Everything here was previously taken on trust because the signature
     * matched, and a signature says which game wrote the state, not which build
     * of the engine. `puzzleResults` is the case that actually bites:
     * _appendPuzzleResult() fails on undefined.push against a state from a build
     * that predates the field. The state is also the one thing a pupil can edit
     * in devtools, so this is input validation as much as it is a migration.
     *
     * The list of fields is a whitelist, so anything not named here is dropped.
     * That is the right trade for a value the player can edit, and the cost is
     * that a state written by a *newer* engine loses the fields that engine
     * added. Only reachable if an older build is served to the same device,
     * which is one more reason the service worker question (EI-007) matters.
     */
    _normalizeState(saved) {
        const fresh = this._freshState();
        const asList = (v) => (Array.isArray(v) ? v : null);
        const asMap = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

        const state = {
            ...fresh,
            inventory: asList(saved.inventory)?.filter(id => typeof id === 'string') ?? fresh.inventory,
            solved: asMap(saved.solved) ?? fresh.solved,
            flags: asMap(saved.flags) ?? fresh.flags,
            visited: asMap(saved.visited) ?? fresh.visited,
            eventsFired: asMap(saved.eventsFired) ?? fresh.eventsFired,
            scene: typeof saved.scene === 'string' ? saved.scene : fresh.scene,
            useItemId: typeof saved.useItemId === 'string' ? saved.useItemId : null,
            hero: asMap(saved.hero) ?? null,
            puzzleResults: asList(saved.puzzleResults) ?? fresh.puzzleResults,
            contentShown: asMap(saved.contentShown) ?? fresh.contentShown,
            sceneImages: Object.fromEntries(
                Object.entries(asMap(saved.sceneImages) ?? fresh.sceneImages)
                    .filter(([, image]) => typeof image === 'string'),
            ),
        };

        // Holding an item you do not have is not a state the engine can act on
        // sensibly: the acceptItems check never looks in the inventory.
        if (state.useItemId && !state.inventory.includes(state.useItemId)) {
            state.useItemId = null;
        }

        // A scene that no longer exists must not strand the team. goto() would
        // report "scene not found" and leave them with no image and no hotspots,
        // which on a tablet is indistinguishable from a crash.
        if (!this.data?.scenes?.some(s => s.id === state.scene)) {
            state.scene = fresh.scene;
        }

        return state;
    }

    /**
     * Hand over a lesson that is already in progress under the old shared key.
     *
     * Only this game's own state is taken, and only then is the old entry
     * removed: another game may still be entitled to it. The old signature
     * carried the language as a third segment, which is why the comparison is
     * on the prefix rather than the whole string.
     */
    _adoptLegacyState() {
        const legacy = this._readLegacyState();
        if (!legacy) return null;
        this._discardLegacyState();
        return legacy;
    }

    /**
     * The old entry, but only if it is this game's.
     *
     * Read only when this engine owns the browser's storage: the old key is an
     * artefact of the unhosted engine, and a runtime that supplies per-team
     * storage must not be handed whatever was left on the tablet. The old
     * signature carried the language as a third segment, which is why the
     * comparison is on the prefix rather than the whole string.
     */
    _readLegacyState() {
        if (!this._ownsLocalStorage) return null;

        let raw = null;
        try {
            raw = localStorage.getItem(LEGACY_STATE_KEY);
        } catch {
            return null;
        }
        if (!raw) return null;

        let legacy = null;
        try {
            legacy = JSON.parse(raw);
        } catch {
            return null;
        }

        const signature = this._signature();
        const ours = typeof legacy?.signature === 'string'
            && (legacy.signature === signature || legacy.signature.startsWith(signature + '|'));

        return ours ? {...legacy, signature} : null;
    }

    /** Remove the old entry, but only ever this game's own. */
    _discardLegacyState() {
        if (!this._readLegacyState()) return;
        try {
            localStorage.removeItem(LEGACY_STATE_KEY);
        } catch { /* noop */
        }
    }
}
