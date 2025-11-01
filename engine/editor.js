// engine/editor.js
// Unified editor for Scenes and Puzzles 2.0 (AUTO vs MANUAL).
// Scene mode:
//   - Green selection rectangle over the hotspot layer (copy/show JSON).
// Puzzle mode:
//   - AUTO layout  : only the yellow work window (.pz__window) is draggable/resizable; no purple boxes.
//   - MANUAL layout: yellow window is LOCKED to 0/0/100/100; purple overlays appear for ALL [data-id]
//                    elements inside .pz__window. Footer moves as one unit; ok/cancel are positioned
//                    relative to it if the footer exists.
// Mode auto-switch: Scene <-> Puzzle when .pz appears or disappears.
// Never hide the entire hotspot layer. If needed, only hide its direct `.hotspot` children.

const DBG = () => (typeof window !== 'undefined' && /\bdebug=1\b/.test(window.location.search));

/**
 * Top-level editor orchestrating Scene & Puzzle sub-editors and mode switching.
 * It owns the global overlay and never hides the user's hotspot layer wholesale.
 */
export class Editor {
    /**
     * @param {{game:any, overlay:HTMLElement, hotspotLayer:HTMLElement}} deps
     */
    constructor({game, overlay, hotspotLayer}) {
        this.game = game;
        this.overlay = overlay;           // Global overlay (Scene + info panels)
        this.hotspotLayer = hotspotLayer;
        this.sceneContainer = hotspotLayer?.parentElement || document.body;

        this.enabled = false;
        /** @type {'scene'|'puzzle'|null} */
        this.currentMode = null;
        /** @type {SceneEditor|null} */
        this.sceneEditor = null;
        /** @type {PuzzleEditor|null} */
        this.puzzleEditor = null;
        /** @type {MutationObserver|null} */
        this._rootObserver = null;
    }

    /** Enable the editor; detect initial mode; attach observers. */
    enable() {
        if (this.enabled) return;
        this.enabled = true;

        this._cleanup();
        document.body.classList.add('editor-on');
        this.overlay.classList.remove('hidden');

        Object.assign(this.overlay.style, {position: 'absolute', inset: '0', zIndex: '10000'});
        this.overlay.innerHTML = '';

        const puzzleRoot = document.querySelector('.pz');
        if (puzzleRoot) this._activatePuzzleMode(puzzleRoot);
        else this._activateSceneMode();

        this._startRootObserver();
    }

    /** Disable the editor and remove all overlays and listeners. */
    disable() {
        if (!this.enabled) return;
        this.enabled = false;

        this._stopRootObserver();
        this._cleanup();

        this.overlay.classList.add('hidden');
        this.overlay.innerHTML = '';
        this._setSceneHotspotsVisible(true);
        this._setModeClasses(null);
        document.body.classList.remove('editor-on');
    }

    /** Toggle enable/disable. */
    toggle() {
        this.enabled ? this.disable() : this.enable();
    }

    /** Remove sub-editors, overlays, and restore hotspot layer safety. */
    _cleanup() {
        if (this.sceneEditor) {
            try {
                this.sceneEditor.destroy();
            } catch {
            }
            this.sceneEditor = null;
        }
        if (this.puzzleEditor) {
            try {
                this.puzzleEditor.destroy();
            } catch {
            }
            this.puzzleEditor = null;
        }

        this.overlay.innerHTML = '';
        document.querySelectorAll(
            '.scene-final-rect,.scene-handle,.scene-final-label,' +
            '.pz-viz,.pz-viz-layer,.editor-toolbar,.editor-jsonpanel,.editor-hint'
        ).forEach(el => {
            try {
                el.remove();
            } catch {
            }
        });

        document.body.classList.remove('editor-puzzle-mode', 'editor-scene-mode');

        // Defensive restore: never leave the whole layer hidden or disabled
        if (this.hotspotLayer) {
            this.hotspotLayer.style.visibility = '';
            this.hotspotLayer.style.pointerEvents = '';
            this.hotspotLayer.style.display = '';
        }
    }

    /** Switch to scene mode with rectangle drawer. */
    _activateSceneMode() {
        this.currentMode = 'scene';
        this._setSceneHotspotsVisible(true);
        this.overlay.style.pointerEvents = 'auto';

        this.sceneEditor = new SceneEditor(this.game, this.overlay, this.hotspotLayer, this.sceneContainer);
        this.sceneEditor.enable();

        this._setModeClasses('scene');
    }

    /** Switch to puzzle mode, choosing AUTO or MANUAL based on .pz root. */
    _activatePuzzleMode(puzzleRoot) {
        this.currentMode = 'puzzle';

        // Never hide the whole #hotspotLayer – only its direct .hotspot children
        this._setSceneHotspotsVisible(false);

        this.overlay.innerHTML = '';
        this.overlay.style.pointerEvents = 'auto';

        this.puzzleEditor = new PuzzleEditor(puzzleRoot, this.overlay, this.sceneContainer);
        this.puzzleEditor.enable();

        this._setModeClasses('puzzle');
    }

    /**
     * Observe DOM for .pz presence and flip Scene/Puzzle mode automatically.
     * @private
     */
    _startRootObserver() {
        if (this._rootObserver) return;
        const detect = () => {
            const hasPuzzle = !!document.querySelector('.pz');
            const newMode = hasPuzzle ? 'puzzle' : 'scene';
            if (!this.enabled) return;
            if (newMode !== this.currentMode) {
                this._cleanup();
                this.overlay.innerHTML = '';
                if (hasPuzzle) {
                    this._activatePuzzleMode(document.querySelector('.pz'));
                    this._setSceneHotspotsVisible(false);
                    this._setModeClasses('puzzle');
                } else {
                    this._activateSceneMode();
                    this._setSceneHotspotsVisible(true);
                    this._setModeClasses('scene');
                }
            }
        };
        this._rootObserver = new MutationObserver(detect);
        this._rootObserver.observe(document.body, {childList: true, subtree: true});
        detect();
    }

    /** Stop observing root DOM changes. */
    _stopRootObserver() {
        try {
            this._rootObserver?.disconnect();
        } catch {
        }
        this._rootObserver = null;
    }

    /**
     * Toggle visibility and pointer-events for direct `.hotspot` children only.
     * Never hides the entire layer node to avoid side effects elsewhere.
     * @param {boolean} show
     * @private
     */
    _setSceneHotspotsVisible(show) {
        if (!this.hotspotLayer) return;
        // :scope ensures touching direct children only
        const nodes = this.hotspotLayer.querySelectorAll(':scope > .hotspot');
        nodes.forEach(btn => {
            btn.style.visibility = show ? '' : 'hidden';
            btn.style.pointerEvents = show ? '' : 'none';
        });
    }

    /** Convenience CSS mode toggler. */
    _setModeClasses(mode) {
        document.body.classList.toggle('editor-puzzle-mode', mode === 'puzzle');
        document.body.classList.toggle('editor-scene-mode', mode === 'scene');
    }
}

/* ========================================================================== */
/*                                Scene editor                                */

/* ========================================================================== */

/**
 * Rectangle drawer for Scene hotspots. Allows draw, move, and resize of a single rect
 * in percentages relative to the hotspot layer.
 */
class SceneEditor {
    /**
     * @param {any} game
     * @param {HTMLElement} overlay
     * @param {HTMLElement} hotspotLayer
     * @param {HTMLElement} container
     */
    constructor(game, overlay, hotspotLayer, container) {
        this.game = game;
        this.overlay = overlay;
        this.hotspotLayer = hotspotLayer;
        this.container = container;

        this.rect = null;              // {x,y,w,h} in %
        this.dragMode = null;          // 'create'|'move'|'resize'
        this.activeHandle = null;
        this.startPt = null;
        this.startRect = null;
        this.finalBox = null;
        this.label = null;
        this.toolbar = null;
        this.jsonPanel = null;
        this.hint = null;

        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
    }

    /** Build UI and attach event listeners. */
    enable() {
        this._buildToolbar();
        this._buildHint();
        this._bind();
        this._renderPersistent();
    }

    /** Remove listeners and nodes. */
    destroy() {
        this._unbind();
        this.overlay.innerHTML = '';
        if (this.toolbar?.parentNode) this.toolbar.parentNode.removeChild(this.toolbar);
        if (this.hint?.parentNode) this.hint.parentNode.removeChild(this.hint);
        this.toolbar = null;
        this.jsonPanel = null;
        this.finalBox = null;
        this.label = null;
        this.hint = null;
    }

    _buildHint() {
        const hint = document.createElement('div');
        hint.className = 'editor-hint';
        hint.textContent = 'SCENE MODE: Click & drag to draw rectangle • Middle-click to delete';
        Object.assign(hint.style, {
            position: 'absolute',
            left: '10px',
            top: '10px',
            zIndex: '10001',
            pointerEvents: 'none',
            background: 'rgba(0,0,0,0.8)',
            padding: '6px 10px',
            borderRadius: '6px',
            color: '#0f6',
            font: '12px/1.4 sans-serif'
        });
        this.hint = hint;
        this.container.appendChild(hint);
    }

    _buildToolbar() {
        const tb = document.createElement('div');
        tb.className = 'editor-toolbar scene-toolbar';
        Object.assign(tb.style, {
            position: 'absolute',
            right: '10px',
            top: '10px',
            zIndex: '10001',
            pointerEvents: 'auto',
            background: 'rgba(0,0,0,0.8)',
            padding: '6px',
            borderRadius: '6px',
            color: '#fff',
            font: '12px/1.2 sans-serif'
        });
        const btnCopy = this._btn('📎 Copy JSON', () => this._copyJson());
        const btnShow = this._btn('📋 Show JSON', () => this._toggleJsonPanel());
        tb.appendChild(btnCopy);
        tb.appendChild(btnShow);
        this.toolbar = tb;
        this.container.appendChild(tb);
    }

    _btn(label, onClick) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        Object.assign(b.style, {margin: '0 4px', padding: '4px 6px', cursor: 'pointer'});
        b.addEventListener('click', onClick);
        return b;
    }

    _bind() {
        this.overlay.addEventListener('pointerdown', this._onPointerDown);
        window.addEventListener('pointermove', this._onPointerMove);
        window.addEventListener('pointerup', this._onPointerUp);
        window.addEventListener('keydown', this._onKeyDown);
    }

    _unbind() {
        this.overlay.removeEventListener('pointerdown', this._onPointerDown);
        window.removeEventListener('pointermove', this._onPointerMove);
        window.removeEventListener('pointerup', this._onPointerUp);
        window.removeEventListener('keydown', this._onKeyDown);
    }

    _boxRect() {
        return this.hotspotLayer.getBoundingClientRect();
    }

    _clientToPct(ev) {
        const box = this._boxRect();
        const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
        const x = clamp((ev.clientX - box.left) / box.width, 0, 1);
        const y = clamp((ev.clientY - box.top) / box.height, 0, 1);
        return {x: +(x * 100).toFixed(2), y: +(y * 100).toFixed(2)};
    }

    _renderPersistent() {
        this.overlay.querySelectorAll('.scene-final-rect,.scene-final-label,.scene-handle').forEach(el => el.remove());
        if (!this.rect) return;

        const r = this.rect;
        const box = document.createElement('div');
        box.className = 'scene-final-rect';
        Object.assign(box.style, {
            position: 'absolute', left: r.x + '%', top: r.y + '%', width: r.w + '%', height: r.h + '%',
            border: '2px solid rgba(0,255,100,.8)', background: 'rgba(0,255,100,.10)', zIndex: '9998', cursor: 'move'
        });

        const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
        handles.forEach(h => {
            const dot = document.createElement('div');
            dot.className = 'scene-handle scene-handle-' + h;
            const size = 10;
            Object.assign(dot.style, {
                position: 'absolute',
                width: size + 'px',
                height: size + 'px',
                background: '#0f6',
                border: '1px solid #090',
                zIndex: '9999'
            });
            const pos = (x, y) => {
                dot.style.left = x;
                dot.style.top = y;
            };
            switch (h) {
                case 'nw':
                    pos('-5px', '-5px');
                    dot.style.cursor = 'nwse-resize';
                    break;
                case 'n':
                    pos('calc(50% - 5px)', '-5px');
                    dot.style.cursor = 'ns-resize';
                    break;
                case 'ne':
                    pos('calc(100% - 5px)', '-5px');
                    dot.style.cursor = 'nesw-resize';
                    break;
                case 'e':
                    pos('calc(100% - 5px)', 'calc(50% - 5px)');
                    dot.style.cursor = 'ew-resize';
                    break;
                case 'se':
                    pos('calc(100% - 5px)', 'calc(100% - 5px)');
                    dot.style.cursor = 'nwse-resize';
                    break;
                case 's':
                    pos('calc(50% - 5px)', 'calc(100% - 5px)');
                    dot.style.cursor = 'ns-resize';
                    break;
                case 'sw':
                    pos('-5px', 'calc(100% - 5px)');
                    dot.style.cursor = 'nesw-resize';
                    break;
                case 'w':
                    pos('-5px', 'calc(50% - 5px)');
                    dot.style.cursor = 'ew-resize';
                    break;
            }
            dot.dataset.handle = h;
            box.appendChild(dot);
        });

        const label = document.createElement('div');
        label.className = 'scene-final-label';
        label.textContent = `x:${r.x} y:${r.y} w:${r.w} h:${r.h}`;
        Object.assign(label.style, {
            position: 'absolute',
            left: '0',
            top: '-18px',
            padding: '2px 4px',
            background: 'rgba(0,0,0,.8)',
            color: '#fff',
            font: '11px sans-serif'
        });
        box.appendChild(label);

        box.addEventListener('pointerdown', (ev) => {
            ev.stopPropagation();
            if (ev.button === 1) {
                this.rect = null;
                this._renderPersistent();
                this._updateJsonPanel();
                return;
            }
            const handle = ev.target?.dataset?.handle || null;
            this.dragMode = handle ? 'resize' : 'move';
            this.activeHandle = handle;
            this.startPt = {x: ev.clientX, y: ev.clientY};
            this.startRect = {...this.rect};
            box.setPointerCapture?.(ev.pointerId);
        });

        this.overlay.appendChild(box);
        this.finalBox = box;
        this.label = label;
        this._updateJsonPanel();
    }

    _updateLabel() {
        if (!this.label || !this.rect) return;
        const r = this.rect;
        this.label.textContent = `x:${r.x} y:${r.y} w:${r.w} h:${r.h}`;
    }

    _updateJsonPanel() {
        if (!this.jsonPanel) return;
        const r = this.rect || {x: 0, y: 0, w: 0, h: 0};
        this.jsonPanel.querySelector('textarea').value = JSON.stringify({x: r.x, y: r.y, w: r.w, h: r.h}, null, 2);
    }

    _toggleJsonPanel() {
        if (this.jsonPanel) {
            this.jsonPanel.remove();
            this.jsonPanel = null;
            return;
        }
        const panel = document.createElement('div');
        panel.className = 'editor-jsonpanel';
        Object.assign(panel.style, {
            position: 'absolute',
            right: '10px',
            top: '50px',
            zIndex: '10002',
            background: 'rgba(0,0,0,.85)',
            padding: '6px',
            borderRadius: '6px'
        });
        const ta = document.createElement('textarea');
        Object.assign(ta.style, {
            width: '260px',
            height: '160px',
            color: '#0f6',
            background: '#111',
            font: '12px monospace'
        });
        panel.appendChild(ta);
        const btn = this._btn('Copy', () => {
            ta.select();
            document.execCommand?.('copy');
        });
        panel.appendChild(btn);
        this.overlay.appendChild(panel);
        this.jsonPanel = panel;
        this._updateJsonPanel();
    }

    _copyJson() {
        const r = this.rect || {x: 0, y: 0, w: 0, h: 0};
        const text = JSON.stringify({x: r.x, y: r.y, w: r.w, h: r.h});
        try {
            navigator.clipboard?.writeText(text);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand?.('copy');
            document.body.removeChild(ta);
        }
    }

    _onPointerDown(ev) {
        if (ev.target.closest('.editor-toolbar') || ev.target.closest('.editor-jsonpanel')) return;
        const pct = this._clientToPct(ev);
        const inside = this.rect && pct.x >= this.rect.x && pct.x <= this.rect.x + this.rect.w
            && pct.y >= this.rect.y && pct.y <= this.rect.y + this.rect.h;
        if (inside) {
            this.dragMode = 'move';
            this.activeHandle = null;
            this.startPt = {x: ev.clientX, y: ev.clientY};
            this.startRect = {...this.rect};
            return;
        }
        this.dragMode = 'create';
        this.activeHandle = null;
        this.startPt = {x: ev.clientX, y: ev.clientY};
        this.rect = {x: pct.x, y: pct.y, w: 0, h: 0};
        this._renderPersistent();
    }

    _onPointerMove(ev) {
        if (!this.dragMode || !this.rect) return;
        const box = this._boxRect();
        const dx = (ev.clientX - this.startPt.x) / box.width * 100;
        const dy = (ev.clientY - this.startPt.y) / box.height * 100;

        if (this.dragMode === 'move') {
            const nx = +(Math.max(0, Math.min(100 - this.rect.w, this.startRect.x + dx))).toFixed(2);
            const ny = +(Math.max(0, Math.min(100 - this.rect.h, this.startRect.y + dy))).toFixed(2);
            this.rect.x = nx;
            this.rect.y = ny;
            Object.assign(this.finalBox.style, {left: this.rect.x + '%', top: this.rect.y + '%'});
            this._updateLabel();
            this._updateJsonPanel();
            return;
        }

        if (this.dragMode === 'resize' && this.activeHandle) {
            const sr = this.startRect;
            const apply = (nx, ny, nw, nh) => {
                this.rect.x = +(Math.max(0, Math.min(100, nx))).toFixed(2);
                this.rect.y = +(Math.max(0, Math.min(100, ny))).toFixed(2);
                this.rect.w = +(Math.max(0, Math.min(100 - this.rect.x, nw))).toFixed(2);
                this.rect.h = +(Math.max(0, Math.min(100 - this.rect.y, nh))).toFixed(2);
                Object.assign(this.finalBox.style, {
                    left: this.rect.x + '%',
                    top: this.rect.y + '%',
                    width: this.rect.w + '%',
                    height: this.rect.h + '%'
                });
                this._updateLabel();
                this._updateJsonPanel();
            };
            switch (this.activeHandle) {
                case 'nw':
                    apply(sr.x + dx, sr.y + dy, sr.w - dx, sr.h - dy);
                    break;
                case 'n':
                    apply(sr.x, sr.y + dy, sr.w, sr.h - dy);
                    break;
                case 'ne':
                    apply(sr.x, sr.y + dy, sr.w + dx, sr.h - dy);
                    break;
                case 'e':
                    apply(sr.x, sr.y, sr.w + dx, sr.h);
                    break;
                case 'se':
                    apply(sr.x, sr.y, sr.w + dx, sr.h + dy);
                    break;
                case 's':
                    apply(sr.x, sr.y, sr.w, sr.h + dy);
                    break;
                case 'sw':
                    apply(sr.x + dx, sr.y, sr.w - dx, sr.h + dy);
                    break;
                case 'w':
                    apply(sr.x + dx, sr.y, sr.w - dx, sr.h);
                    break;
            }
            return;
        }

        if (this.dragMode === 'create') {
            const p0 = this._clientToPct({clientX: this.startPt.x, clientY: this.startPt.y});
            const p1 = this._clientToPct(ev);
            const x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y);
            const w = Math.max(0, Math.max(p0.x, p1.x) - x);
            const h = Math.max(0, Math.max(p0.y, p1.y) - y);
            this.rect = {x: +x.toFixed(2), y: +y.toFixed(2), w: +w.toFixed(2), h: +h.toFixed(2)};
            Object.assign(this.finalBox.style, {left: x + '%', top: y + '%', width: w + '%', height: h + '%'});
            this._updateLabel();
            this._updateJsonPanel();
        }
    }

    _onPointerUp() {
        this.dragMode = null;
        this.activeHandle = null;
        this.startPt = null;
        this.startRect = null;
    }

    _onKeyDown(e) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (this.rect) {
                this.rect = null;
                this._renderPersistent();
            }
        }
    }
}

/* ========================================================================== */
/*                               Puzzle editor                                */

/* ========================================================================== */

/**
 * Manual and AUTO puzzle layout editor.
 * AUTO: only the yellow window overlay is interactive.
 * MANUAL: window is locked to 0/0/100/100, each [data-id] gets a purple overlay and can be positioned.
 */
class PuzzleEditor {
    /**
     * @param {HTMLElement} puzzleRoot  The .pz root
     * @param {HTMLElement} overlay     Global overlay (used for AUTO mode)
     * @param {HTMLElement} container   Document container (used for hints/toolbars)
     */
    constructor(puzzleRoot, overlay, container) {
        this.puzzleRoot = puzzleRoot;
        this.overlay = overlay;      // Global overlay (AUTO)
        this.container = container;

        this.windowEl = puzzleRoot.querySelector('.pz__window');
        this.isManualLayout = puzzleRoot.classList.contains('pz--manual');

        this.localLayer = null;      // MANUAL: overlay anchored inside .pz__window
        this.visualizations = [];
        this.vizById = new Map();    // id -> viz box
        this.components = new Map(); // el -> { id, type, element, _rect, parentId? }
        this.footerEl = null;

        this.toolbar = null;
        this.jsonPanel = null;
        this.hint = null;
        this.active = null;

        this._overlayPEBackup = '';

        this._onMouseDown = this._onMouseDown.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onMouseUp = this._onMouseUp.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
    }

    /** Build UI and interactivity for AUTO or MANUAL based on .pz flags. */
    enable() {
        this._buildHint();
        this._buildToolbar();

        if (!this.windowEl) {
            console.warn('[ED] .pz__window not found');
            return;
        }

        if (!this.isManualLayout) {
            // AUTO: yellow window is the only draggable/resizable thing
            this.overlay.style.pointerEvents = 'auto';
            const wRect = this._rectOf(this.windowEl, this.puzzleRoot);
            const winViz = this._makeVizBox(wRect, 'pz-viz-window', 'Work Window', '#ff0', /*locked=*/false);
            winViz.__target = this.windowEl;
            winViz.__relRoot = this.puzzleRoot;
            this.overlay.appendChild(winViz);
            this.visualizations = [winViz];
            this.vizById.clear();
            this.vizById.set('__window__', winViz);
            this._bind();
            this._updateJson();
            console.debug('[ED] AUTO ready', wRect);
            return;
        }

        // MANUAL
        this._overlayPEBackup = this.overlay.style.pointerEvents || '';
        this.overlay.style.pointerEvents = 'none'; // do not intercept mouse inside the window

        this._waitWindowReady(() => {
            this._ensureLocalLayer();
            this._lockWindow100();        // force 0/0/100/100
            this._detectComponents();     // includes footer/ok/cancel
            this._freezeInitialRects();   // convert to absolute % + clamp
            this._maybeAutoplace();       // stack vertically if everything is squashed near top-left
            this._createManualVisualizations();
            this._bind();
            this._updateJson();
            console.debug('[ED] MANUAL ready');
        });
    }

    /** Remove listeners, overlays and restore global overlay pointer-events. */
    destroy() {
        this._unbind();
        this.visualizations.forEach(v => v.remove());
        this.visualizations = [];
        this.vizById.clear();
        if (this.localLayer?.parentNode) this.localLayer.parentNode.removeChild(this.localLayer);
        this.localLayer = null;
        if (this.toolbar?.parentNode) this.toolbar.parentNode.removeChild(this.toolbar);
        if (this.hint?.parentNode) this.hint.parentNode.removeChild(this.hint);
        if (this.jsonPanel?.parentNode) this.jsonPanel.parentNode.removeChild(this.jsonPanel);
        this.toolbar = null;
        this.hint = null;
        this.jsonPanel = null;
        this.components.clear();
        this.footerEl = null;
        if (this.isManualLayout) this.overlay.style.pointerEvents = this._overlayPEBackup;
    }

    /* ---------- readiness & layers ---------- */

    /**
     * Wait until .pz__window has a measurable box to avoid 0x0 at initial render.
     * @param {Function} cb
     * @private
     */
    _waitWindowReady(cb) {
        let tries = 0;
        const tick = () => {
            tries++;
            const r = this.windowEl.getBoundingClientRect();
            if (r.width >= 8 && r.height >= 8) return cb();
            if (tries < 30) return requestAnimationFrame(tick);
            cb();
        };
        requestAnimationFrame(tick);
    }

    /**
     * Ensure the local overlay layer mounted inside .pz__window for MANUAL mode.
     * @private
     */
    _ensureLocalLayer() {
        if (this.localLayer?.isConnected) return;
        const lv = document.createElement('div');
        lv.className = 'pz-viz-layer';
        Object.assign(lv.style, {position: 'absolute', inset: '0', zIndex: '10000', pointerEvents: 'none'});
        if (getComputedStyle(this.windowEl).position === 'static') this.windowEl.style.position = 'relative';
        this.windowEl.appendChild(lv);
        this.localLayer = lv;
    }

    /**
     * Lock yellow window to 0/0/100/100 relative to the puzzle root (.pz).
     * @private
     */
    _lockWindow100() {
        const root = this.puzzleRoot;
        if (getComputedStyle(root).position === 'static') root.style.position = 'relative';
        Object.assign(this.windowEl.style, {
            position: 'absolute',
            left: '0%', top: '0%',
            width: '100%', height: '100%',
            margin: '0', transform: '', boxSizing: 'border-box'
        });
    }

    /* ---------- UI ---------- */

    _buildHint() {
        const hint = document.createElement('div');
        hint.className = 'editor-hint';
        hint.textContent = this.isManualLayout
            ? 'PUZZLE MANUAL: yellow window locked 100% • move purple boxes • Snap 1%'
            : 'PUZZLE AUTO: move the yellow window (drag/resize)';
        Object.assign(hint.style, {
            position: 'absolute',
            left: '10px',
            top: '10px',
            zIndex: '10001',
            pointerEvents: 'none',
            background: 'rgba(0,0,0,0.8)',
            padding: '6px 10px',
            borderRadius: '6px',
            color: '#c9f',
            font: '12px/1.4 sans-serif'
        });
        this.hint = hint;
        this.container.appendChild(hint);
    }

    _buildToolbar() {
        const tb = document.createElement('div');
        tb.className = 'editor-toolbar puzzle-toolbar';
        Object.assign(tb.style, {
            position: 'absolute',
            right: '10px',
            top: '10px',
            zIndex: '10001',
            pointerEvents: 'auto',
            background: 'rgba(0,0,0,0.85)',
            padding: '6px',
            borderRadius: '8px',
            color: '#fff',
            font: '12px/1.2 system-ui'
        });
        const _btn = (label, onClick) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            Object.assign(b.style, {
                margin: '0 4px',
                padding: '4px 8px',
                cursor: 'pointer',
                background: '#222',
                color: '#fff',
                border: '1px solid #666',
                borderRadius: '6px'
            });
            b.addEventListener('click', onClick);
            return b;
        };
        tb.appendChild(_btn('📎 Export', () => this._exportPayload()));
        tb.appendChild(_btn('📋 Show JSON', () => this._toggleJsonPanel()));
        tb.appendChild(_btn('🌳 Dump Tree', () => this._dumpTree()));
        tb.appendChild(_btn('⟳ Refresh', () => this._refreshManual()));
        const snapLabel = document.createElement('label');
        snapLabel.style.marginLeft = '8px';
        snapLabel.style.opacity = '.9';
        const snap = document.createElement('input');
        snap.type = 'checkbox';
        snap.checked = true;
        snap.dataset.act = 'snap';
        snapLabel.appendChild(snap);
        snapLabel.appendChild(document.createTextNode(' Snap 1%'));
        tb.appendChild(snapLabel);
        this.toolbar = tb;
        this.container.appendChild(tb);
    }

    _toggleJsonPanel() {
        if (this.jsonPanel) {
            this.jsonPanel.remove();
            this.jsonPanel = null;
            return;
        }
        const panel = document.createElement('div');
        panel.className = 'editor-jsonpanel';
        Object.assign(panel.style, {
            position: 'absolute', right: '10px', top: '50px', zIndex: '10002',
            background: 'rgba(0,0,0,.85)', padding: '6px', borderRadius: '6px'
        });
        const ta = document.createElement('textarea');
        Object.assign(ta.style, {
            width: '360px',
            height: '260px',
            color: '#c9f',
            background: '#111',
            font: '12px monospace'
        });
        panel.appendChild(ta);
        const btn = document.createElement('button');
        btn.textContent = 'Copy';
        btn.addEventListener('click', () => {
            ta.select();
            document.execCommand?.('copy');
        });
        Object.assign(btn.style, {margin: '6px 0', padding: '4px 8px'});
        panel.appendChild(btn);
        const host = this.isManualLayout ? this.container : this.overlay;
        host.appendChild(panel);
        this.jsonPanel = panel;
        this._updateJson();
    }

    /** Copy current windowRect and, for MANUAL, the elements map to clipboard. */
    _exportPayload() {
        const payload = {
            windowRect: this._rectOf(this.windowEl || this.puzzleRoot, this.puzzleRoot),
            elements: this.isManualLayout ? this._collectElementsMap() : {}
        };
        const json = JSON.stringify(payload, null, 2);
        try {
            navigator.clipboard?.writeText(json);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = json;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand?.('copy');
            ta.remove();
        }
        this._updateJson();
    }

    /** Dump detected [data-id] tree to console and clipboard for debugging. */
    _dumpTree() {
        const tree = this._buildTree();
        const json = JSON.stringify(tree, null, 2);
        console.debug('[ED] TREE\n', json);
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(json);
    }

    /* ---------- MANUAL pipeline ---------- */

    /** Re-scan components and rebuild manual overlays. */
    _refreshManual() {
        if (!this.isManualLayout) return;
        this.visualizations.forEach(v => v.remove());
        this.visualizations = [];
        this.vizById.clear();
        this.components.clear();
        this.footerEl = null;

        this._lockWindow100();
        this._detectComponents();
        this._freezeInitialRects();
        this._maybeAutoplace();
        this._createManualVisualizations();
        this._bind();
        this._updateJson();
    }

    /** Detect all [data-id] and footer grouping, record meta. */
    _detectComponents() {
        const els = this.windowEl.querySelectorAll('[data-id]');
        let footer = null;
        els.forEach(el => {
            if (el.getAttribute('data-id') === 'footer') footer = el;
        });
        this.footerEl = footer || null;

        els.forEach(el => {
            const id = el.getAttribute('data-id');
            if (!id) return;
            const type = el.classList.contains('pz-token') ? 'token' : 'component';
            let parentId = null;

            // ok/cancel live under footer for relative positioning and debugging
            if (this.footerEl && (id === 'ok' || id === 'cancel')) parentId = 'footer';

            this.components.set(el, {id, type, element: el, parentId});
        });
    }

    /** Convert initial geometry to absolute percentages and clamp to parent. */
    _freezeInitialRects() {
        const relWin = this.windowEl;
        if (getComputedStyle(relWin).position === 'static') relWin.style.position = 'relative';

        for (const [el, meta] of this.components.entries()) {
            const rel = (meta.parentId === 'footer' && this.footerEl) ? this.footerEl : relWin;
            let r = this._rectOf(el, rel);

            // Clamps and minimal sizes
            if (r.x < 0) {
                r.w = Math.max(0, r.w + r.x);
                r.x = 0;
            }
            if (r.y < 0) {
                r.h = Math.max(0, r.h + r.y);
                r.y = 0;
            }
            if (r.x > 100) r.x = 100;
            if (r.y > 100) r.y = 100;
            if (r.w < 4) r.w = (meta.id === 'ok' || meta.id === 'cancel') ? 10 : 12;
            if (r.h < 3) r.h = (meta.id === 'ok' || meta.id === 'cancel') ? 5 : 6;
            if (r.x + r.w > 100) r.w = 100 - r.x;
            if (r.y + r.h > 100) r.h = 100 - r.y;

            Object.assign(el.style, {
                position: 'absolute',
                left: r.x + '%', top: r.y + '%',
                width: r.w + '%', height: r.h + '%',
                boxSizing: 'border-box', margin: '', transform: ''
            });

            meta._rect = this._rectOf(el, rel);
        }
        console.debug('[ED] freeze complete; elements:', this.components.size);
    }

    /**
     * If elements are squashed near the top-left, arrange them vertically centered,
     * keep footer near bottom, and place ok/cancel inside the footer.
     */
    _maybeAutoplace() {
        const metasTop = Array.from(this.components.values()).filter(m => !m.parentId); // top-level only
        const rects = metasTop.map(m => m._rect);
        const squashed = rects.filter(r => r.y <= 2 || (r.x <= 2 && r.w <= 15)).length;
        if (squashed < Math.ceil(rects.length * 0.6)) {
            this._syncFooterChildrenPositions();
            return;
        }

        const order = (id) => ({title: 0, prompt: 1, input: 2, footer: 99}[id] ?? 10);
        metasTop.sort((a, b) => order(a.id) - order(b.id) || a.id.localeCompare(b.id));

        const N = metasTop.length;
        const gap = 4;
        const bottomReserve = metasTop.some(m => m.id === 'footer') ? 10 : 6;
        const Hfree = 100 - bottomReserve - gap * (N + 1);
        const baseH = Math.max(6, Math.floor(Hfree / Math.max(1, N)));

        let y = gap;
        metasTop.forEach(m => {
            let w = 80;
            if (m.id === 'title' || m.id === 'prompt') w = 70;
            if (m.id === 'footer') {
                w = 50;
                y = 100 - bottomReserve;
            }

            const x = (100 - w) / 2;
            const h = (m.id === 'footer') ? 6 : baseH;
            const r = {x: +x.toFixed(2), y: +y.toFixed(2), w, h};

            Object.assign(m.element.style, {
                position: 'absolute',
                left: r.x + '%',
                top: r.y + '%',
                width: r.w + '%',
                height: r.h + '%'
            });
            m._rect = r;
            if (m.id !== 'footer') y += h + gap;
        });

        // OK and Cancel inside footer: left and right respectively
        if (this.footerEl) {
            const btns = ['cancel', 'ok'];
            btns.forEach((id, i) => {
                const el = this.windowEl.querySelector(`[data-id="${id}"]`);
                if (!el) return;
                const w = 20, h = 6, x = i === 0 ? 4 : 100 - 4 - w, yPct = 50 - h / 2;
                Object.assign(el.style, {
                    position: 'absolute',
                    left: x + '%',
                    top: yPct + '%',
                    width: w + '%',
                    height: h + '%'
                });
            });
        }
        this._syncFooterChildrenPositions();
        console.debug('[ED] autoplace applied');
    }

    /** Build overlays for manual mode. Yellow window locked, purple boxes for components. */
    _createManualVisualizations() {
        // Yellow locked frame 0/0/100/100 inside .pz__window
        const winViz = this._makeVizBox(
            {x: 0, y: 0, w: 100, h: 100},
            'pz-viz-window',
            'Work Window (locked)',
            '#ff0',
            true
        );
        winViz.__target = this.windowEl;
        winViz.__relRoot = this.windowEl;
        this.localLayer.appendChild(winViz);
        this.visualizations.push(winViz);
        this.vizById.set('__window__', winViz);

        // Purple for top-level, cyan for ok/cancel
        for (const [el, meta] of this.components.entries()) {
            const isChild = (meta.parentId === 'footer' && this.footerEl);
            const label = meta.id;
            const color = isChild ? '#6bdfff' : '#b450ff';
            const rWin = isChild ? this._rectOf(el, this.windowEl) : meta._rect;

            const viz = this._makeVizBox(rWin, isChild ? 'pz-viz-child' : 'pz-viz-component', label, color, false);
            viz.__target = el;
            viz.__meta = meta;
            viz.__relRoot = isChild ? this.footerEl : this.windowEl; // movement in % relative to parent
            this.localLayer.appendChild(viz);
            this.visualizations.push(viz);
            this.vizById.set(meta.id, viz);
        }
    }

    /** Keep ok/cancel overlays in sync when the footer moves. */
    _syncFooterChildrenPositions() {
        if (!this.footerEl) return;
        const kids = ['ok', 'cancel'];
        kids.forEach(id => {
            const el = this.windowEl.querySelector(`[data-id="${id}"]`);
            const viz = this.vizById.get(id);
            if (!el || !viz) return;
            const rWin = this._rectOf(el, this.windowEl);
            Object.assign(viz.style, {
                left: rWin.x + '%',
                top: rWin.y + '%',
                width: rWin.w + '%',
                height: rWin.h + '%'
            });
            const lab = viz.querySelector('.pz-viz-label');
            if (lab) {
                const p = lab.__prefix || lab.textContent.split('x:')[0].trim();
                lab.__prefix = p;
                lab.textContent = `${p}  x:${rWin.x} y:${rWin.y} w:${rWin.w} h:${rWin.h}`;
            }
        });
    }

    /* ---------- visualization + interactions ---------- */

    /**
     * Create a draggable/resizable overlay box.
     * For component boxes there is no visible text label to avoid covering small targets.
     * @param {{x:number,y:number,w:number,h:number}} rect
     * @param {string} cls
     * @param {string} label
     * @param {string} color
     * @param {boolean} locked
     * @returns {HTMLDivElement}
     * @private
     */
    _makeVizBox(rect, cls, label, color, locked) {
        const box = document.createElement('div');
        box.className = 'pz-viz ' + cls;
        Object.assign(box.style, {
            position: 'absolute',
            left: rect.x + '%', top: rect.y + '%', width: rect.w + '%', height: rect.h + '%',
            border: `2px solid ${color}`,
            background: cls === 'pz-viz-window' ? 'transparent' : 'rgba(180,80,255,0.08)',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.2) inset',
            borderRadius: '6px',
            zIndex: '9998', cursor: locked ? 'default' : 'move', userSelect: 'none',
            pointerEvents: 'auto'
        });

        // Visible label only for yellow window; not for component overlays
        if (cls === 'pz-viz-window') {
            const lab = document.createElement('div');
            lab.className = 'pz-viz-label';
            lab.textContent = `${label}  x:${rect.x} y:${rect.y} w:${rect.w} h:${rect.h}`;
            Object.assign(lab.style, {
                position: 'absolute', left: '0', top: '-18px',
                background: 'rgba(0,0,0,.85)', color: '#e6d6ff',
                font: '11px ui-monospace, Menlo, Consolas, monospace',
                padding: '2px 6px', pointerEvents: 'none'
            });
            box.appendChild(lab);
        } else {
            box.title = label; // unobtrusive hint only
        }

        if (!locked) {
            ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach(h => {
                const dot = document.createElement('div');
                dot.dataset.handle = h;
                Object.assign(dot.style, {
                    position: 'absolute', width: '10px', height: '10px',
                    background: color, border: '2px solid #fff', borderRadius: '50%', boxSizing: 'border-box'
                });
                const pos = (x, y) => {
                    dot.style.left = x;
                    dot.style.top = y;
                };
                switch (h) {
                    case 'nw':
                        pos('-6px', '-6px');
                        break;
                    case 'n':
                        pos('calc(50% - 5px)', '-6px');
                        break;
                    case 'ne':
                        pos('calc(100% - 6px)', '-6px');
                        break;
                    case 'e':
                        pos('calc(100% - 6px)', 'calc(50% - 5px)');
                        break;
                    case 'se':
                        pos('calc(100% - 6px)', 'calc(100% - 6px)');
                        break;
                    case 's':
                        pos('calc(50% - 5px)', 'calc(100% - 6px)');
                        break;
                    case 'sw':
                        pos('-6px', 'calc(100% - 6px)');
                        break;
                    case 'w':
                        pos('-6px', 'calc(50% - 5px)');
                        break;
                }
                box.appendChild(dot);
            });
        }
        return box;
    }

    /** Attach mouse handlers. AUTO: only window. MANUAL: all except locked window. */
    _bind() {
        this.visualizations.forEach(v => {
            if (!this.isManualLayout && v.classList.contains('pz-viz-window')) {
                v.addEventListener('mousedown', this._onMouseDown);
            } else if (this.isManualLayout && !v.classList.contains('pz-viz-window')) {
                v.addEventListener('mousedown', this._onMouseDown);
            }
        });
        window.addEventListener('mousemove', this._onMouseMove);
        window.addEventListener('mouseup', this._onMouseUp);
        window.addEventListener('keydown', this._onKeyDown);
    }

    /** Detach mouse handlers. */
    _unbind() {
        this.visualizations.forEach(v => v.removeEventListener('mousedown', this._onMouseDown));
        window.removeEventListener('mousemove', this._onMouseMove);
        window.removeEventListener('mouseup', this._onMouseUp);
        window.removeEventListener('keydown', this._onKeyDown);
    }

    _onMouseDown(e) {
        e.preventDefault();
        e.stopPropagation();
        const viz = e.currentTarget;
        const handle = e.target?.dataset?.handle;

        if (e.button === 1) {
            viz.__deleted = true;
            viz.remove();
            this.visualizations = this.visualizations.filter(v => v !== viz);
            this.vizById.forEach((vv, k) => {
                if (vv === viz) this.vizById.delete(k);
            });
            this._updateJson();
            return;
        }

        const startMouse = {x: e.clientX, y: e.clientY};
        const isWindow = viz.classList.contains('pz-viz-window');
        const relRoot = isWindow ? (this.isManualLayout ? this.windowEl : this.puzzleRoot)
            : (viz.__relRoot || this.windowEl);
        const startElRect = this._rectOf(viz.__target, relRoot);

        this.active = {
            type: handle ? 'resize' : 'move',
            viz,
            handle,
            startMouse,
            startElRect,
            targetEl: viz.__target,
            relRoot,
            isWindow
        };
    }

    _onMouseMove(e) {
        if (!this.active) return;
        const A = this.active;
        const box = A.relRoot.getBoundingClientRect();
        const dx = (e.clientX - A.startMouse.x) / box.width * 100;
        const dy = (e.clientY - A.startMouse.y) / box.height * 100;
        const snap = !!this.toolbar?.querySelector('input[data-act="snap"]')?.checked;

        const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
        const emit = (nx, ny, nw, nh) => {
            nx = clamp(nx, 0, 100);
            ny = clamp(ny, 0, 100);
            nw = clamp(nw, 0, 100 - nx);
            nh = clamp(nh, 0, 100 - ny);
            if (snap) {
                nx = Math.round(nx);
                ny = Math.round(ny);
                nw = Math.round(nw);
                nh = Math.round(nh);
            } else {
                nx = +nx.toFixed(2);
                ny = +ny.toFixed(2);
                nw = +nw.toFixed(2);
                nh = +nh.toFixed(2);
            }

            // A) Apply to the element (percentages relative to relRoot)
            this._applyRectToEl(A.targetEl, {x: nx, y: ny, w: nw, h: nh});

            // B) Recompute viz box position
            let rForViz;
            if (A.relRoot === this.footerEl) {
                rForViz = this._rectOf(A.targetEl, this.windowEl); // viz is in localLayer (relative to window)
            } else if (!this.isManualLayout && A.isWindow) {
                rForViz = this._rectOf(A.targetEl, this.puzzleRoot); // AUTO: viz is in the global overlay
            } else {
                rForViz = (A.relRoot === this.windowEl)
                    ? this._rectOf(A.targetEl, this.windowEl)
                    : {x: nx, y: ny, w: nw, h: nh};
            }
            Object.assign(A.viz.style, {
                left: rForViz.x + '%',
                top: rForViz.y + '%',
                width: rForViz.w + '%',
                height: rForViz.h + '%'
            });

            const lab = A.viz.querySelector('.pz-viz-label');
            if (lab) {
                const p = lab.__prefix || lab.textContent.split('x:')[0].trim();
                lab.__prefix = p;
                lab.textContent = `${p}  x:${rForViz.x} y:${rForViz.y} w:${rForViz.w} h:${rForViz.h}`;
            }

            // When moving the footer, keep child visualizations in sync
            if (A.targetEl === this.footerEl) this._syncFooterChildrenPositions();

            this._updateJson();
        };

        const sr = A.startElRect;
        if (A.type === 'move') {
            emit(sr.x + dx, sr.y + dy, sr.w, sr.h);
            return;
        }
        switch (A.handle) {
            case 'nw':
                emit(sr.x + dx, sr.y + dy, sr.w - dx, sr.h - dy);
                break;
            case 'n':
                emit(sr.x, sr.y + dy, sr.w, sr.h - dy);
                break;
            case 'ne':
                emit(sr.x, sr.y + dy, sr.w + dx, sr.h - dy);
                break;
            case 'e':
                emit(sr.x, sr.y, sr.w + dx, sr.h);
                break;
            case 'se':
                emit(sr.x, sr.y, sr.w + dx, sr.h + dy);
                break;
            case 's':
                emit(sr.x, sr.y, sr.w, sr.h + dy);
                break;
            case 'sw':
                emit(sr.x + dx, sr.y, sr.w - dx, sr.h + dy);
                break;
            case 'w':
                emit(sr.x + dx, sr.y, sr.w - dx, sr.h);
                break;
        }
    }

    _onMouseUp() {
        this.active = null;
    }

    _onKeyDown(e) { /* optional key bindings can go here */
    }

    /* ---------- data / JSON / tree ---------- */

    /** Collect element rects relative to their base (footer for ok/cancel, window for others). */
    _collectElementsMap() {
        const out = {};
        const rel = this.windowEl || this.puzzleRoot;
        for (const [el, meta] of this.components.entries()) {
            if (!el.isConnected) continue;
            const base = (meta.parentId === 'footer' && this.footerEl) ? this.footerEl : rel;
            out[meta.id] = {rect: this._rectOf(el, base)};
        }
        return out;
    }

    /** Build a flat tree of [data-id] nodes with parent relations. */
    _buildTree() {
        const nodes = [];
        const idOf = el => el.getAttribute('data-id');
        const root = this.windowEl || this.puzzleRoot;
        const all = Array.from(root.querySelectorAll('[data-id]'));
        all.forEach(el => {
            const id = idOf(el);
            if (!id) return;
            const parent = el.parentElement?.closest('[data-id]');
            const parentId = parent ? idOf(parent) : null;
            nodes.push({id, kind: el.classList.contains('pz-token') ? 'token' : 'component', parentId, children: []});
        });
        const byId = new Map(nodes.map(n => [n.id, n]));
        nodes.forEach(n => {
            if (n.parentId && byId.has(n.parentId)) byId.get(n.parentId).children.push(n.id);
        });
        return nodes;
    }

    /** JSON reflecting current state for the panel. */
    _currentJson() {
        return JSON.stringify({
            windowRect: this._rectOf(this.windowEl || this.puzzleRoot, this.puzzleRoot),
            elements: this.isManualLayout ? this._collectElementsMap() : {}
        }, null, 2);
    }

    _updateJson() {
        if (!this.jsonPanel) return;
        this.jsonPanel.querySelector('textarea').value = this._currentJson();
    }

    /* ---------- geometry ---------- */

    /**
     * Get a rect of an element relative to a reference element and convert to percentages.
     * @param {HTMLElement} el
     * @param {HTMLElement} relTo
     * @returns {{x:number,y:number,w:number,h:number}}
     * @private
     */
    _rectOf(el, relTo) {
        const pr = relTo.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        const pct = (v, total) => +(v / total * 100).toFixed(2);
        return {
            x: pct(er.left - pr.left, pr.width),
            y: pct(er.top - pr.top, pr.height),
            w: pct(er.width, pr.width),
            h: pct(er.height, pr.height)
        };
    }

    /**
     * Apply percentage rect to element as absolute positioning.
     * @param {HTMLElement} el
     * @param {{x:number,y:number,w:number,h:number}} rect
     * @private
     */
    _applyRectToEl(el, rect) {
        Object.assign(el.style, {
            position: 'absolute',
            left: rect.x + '%',
            top: rect.y + '%',
            width: rect.w + '%',
            height: rect.h + '%'
        });
    }
}
