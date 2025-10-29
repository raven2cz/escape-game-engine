// engine/editor.js
// Universal editor for both scenes and puzzles:
// - Scene mode: draw hotspots by drag (mouse/touch/pen) over the scene
// - Puzzle mode: visualize and edit puzzle components (work window, tokens, buttons)
// - Static coordinate labels for all interactive elements
// - Toolbar + JSON panel live outside the layer to avoid event conflicts

export class Editor {
    constructor({ game, overlay, hotspotLayer }) {
        this.game = game;
        this.overlay = overlay;                   // visual layer (labels + temp box), sibling of hotspotLayer
        this.hotspotLayer = hotspotLayer;         // pointer events source for drawing
        this.sceneContainer = hotspotLayer.parentElement; // parent for both layers

        this.enabled = false;
        this.dragging = null; // { start:{x,y}, end:{x,y} } in %
        this.rect = null;     // last finalized rectangle
        this.toolbar = null;
        this.jsonPanel = null;
        this._observer = null;

        // Puzzle editor support
        this.puzzleEditor = null;
        this.mode = 'scene'; // 'scene' or 'puzzle'

        // bind handlers
        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp   = this._onPointerUp.bind(this);
        this._onDomMutate   = this._onDomMutate.bind(this);
    }

    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------

    enable() {
        if (this.enabled) return;
        this.enabled = true;

        // Detect puzzle mode
        const puzzleRoot = document.querySelector('.pz');
        if (puzzleRoot) {
            this.mode = 'puzzle';
            this.puzzleEditor = new PuzzleEditor(this, puzzleRoot);
            this.puzzleEditor.enable();
        } else {
            this.mode = 'scene';
        }

        document.body.classList.add('editor-on');
        this.overlay.classList.remove('hidden');
        this.overlay.style.pointerEvents = 'none'; // overlay never captures input

        this._buildToolbar();

        if (this.mode === 'scene') {
            this._bindPointer();
            this._observeHotspots();
            this._renderStaticLabels();
            this._hint('Editor ON: drag on the scene to create a hotspot.');
        }
    }

    disable() {
        if (!this.enabled) return;
        this.enabled = false;

        document.body.classList.remove('editor-on');
        this.overlay.classList.add('hidden');

        if (this.puzzleEditor) {
            this.puzzleEditor.disable();
            this.puzzleEditor = null;
        }

        this._unbindPointer();
        this._unobserveHotspots();
        this._removeToolbar();
        this._hideJsonPanel();
        this._clearTemp();
        this._clearLabels();

        this.dragging = null;
        this.mode = 'scene';
    }

    toggle() { this.enabled ? this.disable() : this.enable(); }

    // ---------------------------------------------------------------------------
    // Event wiring
    // ---------------------------------------------------------------------------

    _bindPointer() {
        this.hotspotLayer.addEventListener('pointerdown', this._onPointerDown, { passive: false });
        window.addEventListener('pointermove', this._onPointerMove, { passive: false });
        window.addEventListener('pointerup',   this._onPointerUp,   { passive: false });
    }

    _unbindPointer() {
        this.hotspotLayer.removeEventListener('pointerdown', this._onPointerDown);
        window.removeEventListener('pointermove', this._onPointerMove);
        window.removeEventListener('pointerup',   this._onPointerUp);
    }

    _observeHotspots() {
        if (this._observer) return;
        this._observer = new MutationObserver(this._onDomMutate);
        this._observer.observe(this.hotspotLayer, { childList: true, attributes: true, subtree: false });
    }

    _unobserveHotspots() {
        if (this._observer) {
            this._observer.disconnect();
            this._observer = null;
        }
    }

    _onDomMutate() {
        if (!this.enabled) return;
        this._renderStaticLabels();
    }

    // ---------------------------------------------------------------------------
    // Toolbar + JSON panel
    // ---------------------------------------------------------------------------

    _buildToolbar() {
        const tb = document.createElement('div');
        tb.className = 'editor-toolbar';
        tb.style.position = 'absolute';
        tb.style.right = '10px';
        tb.style.top = '10px';
        tb.style.zIndex = '1000';
        tb.style.pointerEvents = 'auto'; // MUST be clickable

        const btnCopy = document.createElement('button');
        btnCopy.textContent = 'Zkopírovat JSON';
        btnCopy.title = this.mode === 'puzzle' ?
            'Zkopírovat konfiguraci puzzle do schránky' :
            'Zkopírovat poslední obdélník do schránky';
        btnCopy.addEventListener('click', () => this._copyJson());

        const btnRect = document.createElement('button');
        btnRect.textContent = 'Zobrazit JSON';
        btnRect.title = this.mode === 'puzzle' ?
            'Zobraz JSON konfigurace puzzle' :
            'Zobraz JSON posledního obdélníku';
        btnRect.addEventListener('click', () => this._toggleJsonPanel());

        const btnInfo = document.createElement('button');
        btnInfo.textContent = this.mode === 'puzzle' ? 'Info o puzzle' : 'Info o scéně';
        btnInfo.title = this.mode === 'puzzle' ?
            'Zobrazí základní údaje o aktuálním puzzle' :
            'Zobrazí základní údaje o aktuální scéně';
        btnInfo.addEventListener('click', () => {
            if (this.mode === 'puzzle' && this.puzzleEditor) {
                const puzzleRoot = this.puzzleEditor.puzzleRoot;
                const kind = Array.from(puzzleRoot.classList)
                    .find(c => c.startsWith('pz--kind-'))
                    ?.replace('pz--kind-', '');
                const id = Array.from(puzzleRoot.classList)
                    .find(c => c.startsWith('pz--id-'))
                    ?.replace('pz--id-', '');
                const isManual = puzzleRoot.classList.contains('pz--manual');

                alert(JSON.stringify({
                    mode: 'puzzle',
                    id: id || 'unknown',
                    kind: kind || 'unknown',
                    layout: isManual ? 'manual' : 'auto',
                    components: this.puzzleEditor.components.size
                }, null, 2));
            } else {
                const s = this.game.currentScene;
                alert(JSON.stringify({
                    mode: 'scene',
                    id: s.id,
                    title: s.title,
                    image: s.image,
                    hotspotCount: (s.hotspots || []).length,
                }, null, 2));
            }
        });

        tb.appendChild(btnCopy);
        tb.appendChild(btnRect);
        tb.appendChild(btnInfo);

        this.toolbar = tb;
        // IMPORTANT: place inside sceneContainer (sibling of hotspotLayer), not inside hotspotLayer
        this.sceneContainer.appendChild(tb);
    }

    _removeToolbar() {
        if (this.toolbar?.parentNode) this.toolbar.parentNode.removeChild(this.toolbar);
        this.toolbar = null;
    }

    _toggleJsonPanel() {
        if (this.jsonPanel) { this._hideJsonPanel(); return; }
        this._showJsonPanel();
    }

    _showJsonPanel() {
        const panel = document.createElement('div');
        panel.className = 'editor-jsonpanel';
        panel.style.position = 'absolute';
        panel.style.left = '10px';
        panel.style.top  = '10px';
        panel.style.zIndex = '1001';
        panel.style.pointerEvents = 'auto';

        const title = document.createElement('div');
        title.className = 'editor-jsonpanel-title';
        title.textContent = this.mode === 'puzzle' ? 'JSON konfigurace puzzle' : 'JSON obdélníku';

        const ta = document.createElement('textarea');
        ta.className = 'editor-jsonpanel-text';
        ta.rows = 6;
        ta.readOnly = true;
        ta.value = this._snippet() || '// Není co zobrazit...';

        const row = document.createElement('div');
        row.className = 'editor-jsonpanel-actions';

        const btnCopy = document.createElement('button');
        btnCopy.textContent = 'Zkopírovat';
        btnCopy.addEventListener('click', async () => {
            const ok = await this._copyText(ta.value);
            if (!ok) alert('Nepodařilo se zkopírovat – zkopíruj prosím ručně.');
        });

        const btnClose = document.createElement('button');
        btnClose.textContent = 'Zavřít';
        btnClose.addEventListener('click', () => this._hideJsonPanel());

        row.appendChild(btnCopy);
        row.appendChild(btnClose);

        panel.appendChild(title);
        panel.appendChild(ta);
        panel.appendChild(row);

        this.jsonPanel = panel;

        // IMPORTANT: attach to sceneContainer (not inside hotspotLayer)
        this.sceneContainer.appendChild(panel);
    }

    _hideJsonPanel() {
        if (this.jsonPanel?.parentNode) this.jsonPanel.parentNode.removeChild(this.jsonPanel);
        this.jsonPanel = null;
    }

    _updateJsonPanel() {
        if (!this.jsonPanel) return;
        const ta = this.jsonPanel.querySelector('.editor-jsonpanel-text');
        if (ta) ta.value = this._snippet() || '// Není co zobrazit...';
    }

    // ---------------------------------------------------------------------------
    // Hints
    // ---------------------------------------------------------------------------

    _hint(text) {
        let hint = this.overlay.querySelector('.editor-hint');
        if (!hint) {
            hint = document.createElement('div');
            hint.className = 'editor-hint';
            this.overlay.appendChild(hint);
        }
        hint.textContent = text;
    }

    // ---------------------------------------------------------------------------
    // Pointer handling and geometry (for scene mode)
    // ---------------------------------------------------------------------------

    _clientToPercent(ev) {
        const box = this.hotspotLayer.getBoundingClientRect();
        const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
        const x = clamp((ev.clientX - box.left) / box.width, 0, 1);
        const y = clamp((ev.clientY - box.top)  / box.height, 0, 1);
        return { x: +(x * 100).toFixed(2), y: +(y * 100).toFixed(2) };
    }

    _onPointerDown(ev) {
        if (!this.enabled || this.mode !== 'scene') return;

        // ignore clicks on toolbar/JSON panel → do not start drawing
        if (ev.target.closest('.editor-toolbar') || ev.target.closest('.editor-jsonpanel')) return;

        // for mouse accept only left button
        if (ev.pointerType === 'mouse' && ev.button !== 0) return;

        ev.preventDefault();
        try { ev.currentTarget.setPointerCapture?.(ev.pointerId); } catch {}

        const p = this._clientToPercent(ev);
        this.dragging = { start: p, end: p };
        this._renderTemp();
    }

    _onPointerMove(ev) {
        if (!this.dragging) return;
        ev.preventDefault();
        this.dragging.end = this._clientToPercent(ev);
        this._renderTemp();
    }

    _onPointerUp(ev) {
        if (!this.dragging) return;
        ev.preventDefault();
        this.dragging.end = this._clientToPercent(ev);
        this._renderTemp();

        this.rect = this._currentRect();
        this.dragging = null;
        this._hint('Hotspot ready. Click "Zkopírovat JSON" or "Zobrazit JSON".');
        this._updateJsonPanel();
    }

    _currentRect() {
        const a = this.dragging?.start || { x: 0, y: 0 };
        const b = this.dragging?.end   || { x: 0, y: 0 };
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        const w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
        return { x: +x.toFixed(2), y: +y.toFixed(2), w: +w.toFixed(2), h: +h.toFixed(2) };
    }

    // ---------------------------------------------------------------------------
    // Temp box + labels
    // ---------------------------------------------------------------------------

    _clearTemp() {
        this.overlay.querySelector('.temp')?.remove();
        this.overlay.querySelector('.temp-label')?.remove();
    }

    _renderTemp() {
        // temp rectangle
        let box = this.overlay.querySelector('.temp');
        if (!box) {
            box = document.createElement('div');
            box.className = 'temp';
            box.style.position = 'absolute';
            box.style.border = '2px dashed rgba(0,200,255,.9)';
            box.style.background = 'rgba(0,200,255,.12)';
            this.overlay.appendChild(box);
        }
        const r = this._currentRect();
        box.style.left = r.x + '%';
        box.style.top = r.y + '%';
        box.style.width = r.w + '%';
        box.style.height = r.h + '%';

        // temp coordinates label
        let lab = this.overlay.querySelector('.temp-label');
        if (!lab) {
            lab = document.createElement('div');
            lab.className = 'hs-label temp-label';
            this.overlay.appendChild(lab);
        }
        lab.textContent = this._rectText(r);
        this._positionLabel(lab, r);
    }

    _clearLabels() {
        this.overlay.querySelectorAll('.hs-label').forEach(n => n.remove());
    }

    _renderStaticLabels() {
        // remove old (avoid duplicates)
        this.overlay.querySelectorAll('.hs-label:not(.temp-label)').forEach(n => n.remove());

        const scene = this.game.currentScene;
        if (!scene || !Array.isArray(scene.hotspots)) return;

        scene.hotspots.forEach(h => {
            const r = h.rect;
            if (!r) return;
            const lab = document.createElement('div');
            lab.className = 'hs-label';
            lab.textContent = this._rectText(r);
            this.overlay.appendChild(lab);
            this._positionLabel(lab, r);
        });
    }

    _positionLabel(el, rect) {
        const pad = 0.6; // ~0.6%
        el.style.position = 'absolute';
        el.style.left = (rect.x + rect.w - pad) + '%';
        el.style.top  = (rect.y + rect.h - pad) + '%';
        el.style.transform = 'translate(-100%, -100%)';
    }

    _rectText(r) {
        return `x:${r.x} y:${r.y} w:${r.w} h:${r.h}`;
    }

    // ---------------------------------------------------------------------------
    // JSON helpers
    // ---------------------------------------------------------------------------

    _snippet() {
        if (this.mode === 'puzzle' && this.puzzleEditor) {
            return this.puzzleEditor._generateJson();
        }

        const r = this.rect || this._currentRect();
        if (!r) return '';
        return JSON.stringify({
            type: 'goTo',
            target: 'scene_id',
            rect: { x: r.x, y: r.y, w: r.w, h: r.h },
        }, null, 2);
    }

    async _copyJson() {
        const str = this._snippet();
        if (!str) {
            alert(this.mode === 'puzzle' ?
                'Nejsou k dispozici žádné komponenty.' :
                'Nakresli nejdříve hotspot.');
            return;
        }
        const ok = await this._copyText(str);
        if (ok) alert('JSON zkopírován do schránky.');
        else    alert('Kopírování selhalo. Otevři "Zobrazit JSON" a zkopíruj ručně.');
    }

    async _copyText(text) {
        try {
            if (navigator.clipboard && window.isSecureContext !== false) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch {}
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.focus(); ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
        } catch {
            return false;
        }
    }
}

/**
 * PuzzleEditor - specialized editor for Puzzles 2.0
 * Handles visualization and editing of puzzle components:
 * - Work window (pz__window) positioning and resizing
 * - Individual components (tokens, buttons, inputs) in manual layout mode
 * - JSON generation for puzzle configuration
 */
export class PuzzleEditor {
    constructor(mainEditor, puzzleRoot) {
        this.mainEditor = mainEditor;
        this.puzzleRoot = puzzleRoot;
        this.overlay = mainEditor.overlay;

        this.windowEl = puzzleRoot.querySelector('.pz__window');
        this.components = new Map(); // component element -> metadata
        this.selectedElement = null;
        this.resizing = null; // { element, handle, startRect, startMouse }
        this.draggingElement = null; // { element, startPos, startMouse }

        // Bind handlers
        this._onComponentMouseDown = this._onComponentMouseDown.bind(this);
        this._onWindowMouseDown = this._onWindowMouseDown.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onMouseUp = this._onMouseUp.bind(this);
    }

    enable() {
        this._detectComponents();
        this._visualizeWorkWindow();
        this._visualizeComponents();
        this._bindEvents();

        // Update hint
        const isManual = this._isManualLayout();
        const hint = isManual ?
            'Puzzle Editor: Drag components to reposition, drag corners to resize' :
            'Puzzle Editor: Work window visible (auto layout mode)';
        this.mainEditor._hint(hint);
    }

    disable() {
        this._unbindEvents();
        this._clearVisualizations();
        this.components.clear();
    }

    _isManualLayout() {
        return this.puzzleRoot.classList.contains('pz--manual');
    }

    _detectComponents() {
        this.components.clear();

        // Find all positioned components
        const selectors = [
            '.pz-token',
            '.pz-btn',
            '.pz-input-wrap',
            '.pz-group-area',
            '.pz-choice-item',
            '.pz-title',
            '.pz-prompt'
        ];

        selectors.forEach(selector => {
            this.puzzleRoot.querySelectorAll(selector).forEach(el => {
                // Only track components with absolute positioning (manual layout)
                const style = window.getComputedStyle(el);
                if (style.position === 'absolute' || this._isManualLayout()) {
                    // Skip invisible components
                    if (style.display === 'none' || style.visibility === 'hidden') {
                        return;
                    }

                    const rect = this._getElementRect(el);
                    const id = el.getAttribute('data-id') || el.className.split(' ')[0];

                    this.components.set(el, {
                        type: this._getComponentType(el),
                        id: id,
                        rect: rect,
                        visible: true
                    });
                }
            });
        });
    }

    _getComponentType(el) {
        if (el.classList.contains('pz-token')) return 'token';
        if (el.classList.contains('pz-btn')) return 'button';
        if (el.classList.contains('pz-input-wrap')) return 'input';
        if (el.classList.contains('pz-group-area')) return 'group';
        if (el.classList.contains('pz-choice-item')) return 'choice';
        if (el.classList.contains('pz-title')) return 'title';
        if (el.classList.contains('pz-prompt')) return 'prompt';
        return 'component';
    }

    _getElementRect(el) {
        // Get rect relative to work window in percentages
        const parent = this.windowEl || this.puzzleRoot;
        const parentRect = parent.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();

        return {
            x: ((elRect.left - parentRect.left) / parentRect.width * 100),
            y: ((elRect.top - parentRect.top) / parentRect.height * 100),
            w: (elRect.width / parentRect.width * 100),
            h: (elRect.height / parentRect.height * 100)
        };
    }

    _visualizeWorkWindow() {
        if (!this.windowEl) return;

        // Create window outline
        const outline = document.createElement('div');
        outline.className = 'pz-editor-window';
        outline.style.cssText = `
            position: absolute;
            border: 2px dashed rgba(255, 200, 0, 0.8);
            background: rgba(255, 200, 0, 0.05);
            pointer-events: auto;
            cursor: move;
            z-index: 9998;
        `;

        // Copy window position
        const rect = this._getWindowRect();
        outline.style.left = rect.x + '%';
        outline.style.top = rect.y + '%';
        outline.style.width = rect.w + '%';
        outline.style.height = rect.h + '%';

        // Add resize handles
        const handles = ['nw', 'ne', 'sw', 'se'];
        handles.forEach(pos => {
            const handle = document.createElement('div');
            handle.className = 'pz-editor-resize-handle';
            handle.setAttribute('data-handle', pos);
            handle.style.cssText = `
                position: absolute;
                width: 12px;
                height: 12px;
                background: rgba(255, 200, 0, 0.9);
                border: 1px solid rgba(255, 255, 255, 0.5);
                cursor: ${pos}-resize;
                z-index: 9999;
            `;

            // Position handles
            if (pos.includes('n')) handle.style.top = '-6px';
            if (pos.includes('s')) handle.style.bottom = '-6px';
            if (pos.includes('w')) handle.style.left = '-6px';
            if (pos.includes('e')) handle.style.right = '-6px';

            outline.appendChild(handle);
        });

        // Add label
        const label = document.createElement('div');
        label.className = 'pz-editor-label';
        label.style.cssText = `
            position: absolute;
            top: -25px;
            left: 0;
            background: rgba(0, 0, 0, 0.8);
            color: rgba(255, 200, 0, 1);
            padding: 2px 8px;
            font-size: 12px;
            border-radius: 4px;
            white-space: nowrap;
            pointer-events: none;
        `;
        label.textContent = `Pracovní okno: ${this._formatRect(rect)}`;
        outline.appendChild(label);

        this.overlay.appendChild(outline);
        this.windowOutline = outline;
    }

    _getWindowRect() {
        if (!this.windowEl) return { x: 0, y: 0, w: 100, h: 100 };

        const parent = this.puzzleRoot;
        const parentRect = parent.getBoundingClientRect();
        const winRect = this.windowEl.getBoundingClientRect();

        return {
            x: ((winRect.left - parentRect.left) / parentRect.width * 100),
            y: ((winRect.top - parentRect.top) / parentRect.height * 100),
            w: (winRect.width / parentRect.width * 100),
            h: (winRect.height / parentRect.height * 100)
        };
    }

    _visualizeComponents() {
        if (!this._isManualLayout()) return;

        this.components.forEach((meta, el) => {
            const outline = document.createElement('div');
            outline.className = 'pz-editor-component';
            outline.style.cssText = `
                position: absolute;
                border: 1px dashed rgba(100, 200, 255, 0.7);
                background: rgba(100, 200, 255, 0.05);
                pointer-events: auto;
                cursor: move;
                z-index: 9997;
            `;

            // Position based on component rect
            const rect = meta.rect;
            outline.style.left = rect.x + '%';
            outline.style.top = rect.y + '%';
            outline.style.width = rect.w + '%';
            outline.style.height = rect.h + '%';

            // Add label
            const label = document.createElement('div');
            label.className = 'pz-editor-comp-label';
            label.style.cssText = `
                position: absolute;
                bottom: 100%;
                left: 0;
                background: rgba(0, 0, 0, 0.8);
                color: rgba(100, 200, 255, 1);
                padding: 2px 6px;
                font-size: 11px;
                border-radius: 3px;
                white-space: nowrap;
                margin-bottom: 2px;
                pointer-events: none;
            `;
            label.textContent = `${meta.type}#${meta.id}`;
            outline.appendChild(label);

            // Add resize handles for components
            if (meta.type !== 'title' && meta.type !== 'prompt') {
                ['se'].forEach(pos => {
                    const handle = document.createElement('div');
                    handle.className = 'pz-editor-comp-resize';
                    handle.setAttribute('data-handle', pos);
                    handle.style.cssText = `
                        position: absolute;
                        width: 8px;
                        height: 8px;
                        background: rgba(100, 200, 255, 0.8);
                        border: 1px solid white;
                        cursor: se-resize;
                        right: -4px;
                        bottom: -4px;
                        z-index: 9998;
                    `;
                    outline.appendChild(handle);
                });
            }

            // Store reference
            outline._component = el;
            outline._meta = meta;

            // Add to overlay relative to window
            this.overlay.appendChild(outline);
        });
    }

    _bindEvents() {
        // Window dragging/resizing
        if (this.windowOutline) {
            this.windowOutline.addEventListener('mousedown', this._onWindowMouseDown);
        }

        // Component dragging (if manual layout)
        if (this._isManualLayout()) {
            this.overlay.querySelectorAll('.pz-editor-component').forEach(outline => {
                outline.addEventListener('mousedown', this._onComponentMouseDown);
            });
        }

        // Global mouse events
        document.addEventListener('mousemove', this._onMouseMove);
        document.addEventListener('mouseup', this._onMouseUp);
    }

    _unbindEvents() {
        document.removeEventListener('mousemove', this._onMouseMove);
        document.removeEventListener('mouseup', this._onMouseUp);
    }

    _onWindowMouseDown(e) {
        e.preventDefault();
        e.stopPropagation();

        const handle = e.target.getAttribute('data-handle');
        if (handle) {
            // Start resizing
            this.resizing = {
                element: this.windowOutline,
                handle: handle,
                startRect: this._getWindowRect(),
                startMouse: { x: e.clientX, y: e.clientY },
                isWindow: true
            };
        } else if (!e.target.classList.contains('pz-editor-component')) {
            // Start dragging window
            this.draggingElement = {
                element: this.windowOutline,
                isWindow: true,
                startPos: this._getWindowRect(),
                startMouse: { x: e.clientX, y: e.clientY }
            };
        }
    }

    _onComponentMouseDown(e) {
        e.preventDefault();
        e.stopPropagation();

        const handle = e.target.getAttribute('data-handle');
        const outline = e.currentTarget;

        if (handle) {
            // Start resizing component
            this.resizing = {
                element: outline,
                handle: handle,
                startRect: outline._meta.rect,
                startMouse: { x: e.clientX, y: e.clientY },
                meta: outline._meta
            };
        } else {
            // Start dragging component
            this.draggingElement = {
                element: outline,
                component: outline._component,
                meta: outline._meta,
                startPos: outline._meta.rect,
                startMouse: { x: e.clientX, y: e.clientY }
            };
        }
    }

    _onMouseMove(e) {
        if (this.resizing) {
            this._handleResize(e);
        } else if (this.draggingElement) {
            this._handleDrag(e);
        }
    }

    _onMouseUp(e) {
        if (this.resizing || this.draggingElement) {
            this._updateJsonPanel();
        }
        this.resizing = null;
        this.draggingElement = null;
    }

    _handleResize(e) {
        const { element, handle, startRect, startMouse, isWindow, meta } = this.resizing;
        const parent = isWindow ? this.puzzleRoot : this.windowEl;
        const dx = (e.clientX - startMouse.x) / parent.clientWidth * 100;
        const dy = (e.clientY - startMouse.y) / parent.clientHeight * 100;

        let newRect = { ...startRect };

        if (handle.includes('w')) {
            newRect.x = startRect.x + dx;
            newRect.w = startRect.w - dx;
        }
        if (handle.includes('e')) {
            newRect.w = startRect.w + dx;
        }
        if (handle.includes('n')) {
            newRect.y = startRect.y + dy;
            newRect.h = startRect.h - dy;
        }
        if (handle.includes('s')) {
            newRect.h = startRect.h + dy;
        }

        // Constrain to minimum size
        newRect.w = Math.max(5, newRect.w);
        newRect.h = Math.max(5, newRect.h);

        // Apply new position
        element.style.left = newRect.x + '%';
        element.style.top = newRect.y + '%';
        element.style.width = newRect.w + '%';
        element.style.height = newRect.h + '%';

        // Update label
        const label = element.querySelector('.pz-editor-label, .pz-editor-comp-label');
        if (label && isWindow) {
            label.textContent = `Pracovní okno: ${this._formatRect(newRect)}`;
        }

        // Update stored rect for components
        if (meta) {
            Object.assign(meta.rect, newRect);
        }
    }

    _handleDrag(e) {
        const { element, startPos, startMouse, isWindow, meta } = this.draggingElement;
        const parent = isWindow ? this.puzzleRoot : (this.windowEl || this.puzzleRoot);
        const dx = (e.clientX - startMouse.x) / parent.clientWidth * 100;
        const dy = (e.clientY - startMouse.y) / parent.clientHeight * 100;

        const newX = Math.max(0, Math.min(100 - (startPos.w || 10), startPos.x + dx));
        const newY = Math.max(0, Math.min(100 - (startPos.h || 10), startPos.y + dy));

        element.style.left = newX + '%';
        element.style.top = newY + '%';

        // Update stored rect if component
        if (meta) {
            meta.rect.x = newX;
            meta.rect.y = newY;
        }

        // Update label for window
        if (isWindow) {
            const label = element.querySelector('.pz-editor-label');
            if (label) {
                const rect = { ...startPos, x: newX, y: newY };
                label.textContent = `Pracovní okno: ${this._formatRect(rect)}`;
            }
        }
    }

    _clearVisualizations() {
        this.overlay.querySelectorAll('.pz-editor-window, .pz-editor-component').forEach(el => {
            el.remove();
        });
    }

    _formatRect(rect) {
        return `x:${rect.x.toFixed(1)} y:${rect.y.toFixed(1)} w:${rect.w.toFixed(1)} h:${rect.h.toFixed(1)}`;
    }

    _updateJsonPanel() {
        // Trigger main editor's JSON panel update
        if (this.mainEditor.jsonPanel) {
            const ta = this.mainEditor.jsonPanel.querySelector('.editor-jsonpanel-text');
            if (ta) {
                ta.value = this._generateJson();
            }
        }
    }

    _generateJson() {
        const puzzleId = Array.from(this.puzzleRoot.classList)
            .find(c => c.startsWith('pz--id-'))
            ?.replace('pz--id-', '') || 'puzzle-id';

        const kind = Array.from(this.puzzleRoot.classList)
            .find(c => c.startsWith('pz--kind-'))
            ?.replace('pz--kind-', '') || 'unknown';

        const config = {
            id: puzzleId,
            kind: kind,
            rect: this._getWindowRect(),
            layout: { mode: 'manual' }
        };

        // Format rect values
        config.rect = {
            x: +config.rect.x.toFixed(1),
            y: +config.rect.y.toFixed(1),
            w: +config.rect.w.toFixed(1),
            h: +config.rect.h.toFixed(1)
        };

        if (this._isManualLayout() && this.components.size > 0) {
            // Group components by type
            const tokens = [];
            const buttons = [];
            const other = {};

            this.components.forEach((meta, el) => {
                const rectData = {
                    x: +meta.rect.x.toFixed(1),
                    y: +meta.rect.y.toFixed(1),
                    w: +meta.rect.w.toFixed(1),
                    h: +meta.rect.h.toFixed(1)
                };

                if (meta.type === 'token') {
                    tokens.push({
                        id: meta.id,
                        rect: rectData
                    });
                } else if (meta.type === 'button') {
                    const btnType = meta.id.includes('ok') ? 'okButton' :
                        meta.id.includes('cancel') ? 'cancelButton' : meta.id;
                    other[btnType] = { rect: rectData };
                } else {
                    other[meta.type] = other[meta.type] || {};
                    other[meta.type].rect = rectData;
                }
            });

            if (tokens.length > 0) {
                config.tokens = tokens;
            }

            // Add other components to config
            Object.assign(config, other);
        }

        return '// Puzzle configuration (manual layout)\n' +
            '// Zkopíruj do puzzles.json a doplň další vlastnosti\n' +
            JSON.stringify(config, null, 2);
    }
}