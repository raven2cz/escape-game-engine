// engine/editor.js
// Unified editor for Scenes and Puzzles 2.0
// - No hint popups
// - Auto switch Scene <-> Puzzle when .pz appears/disappears
// - Scene: draw/drag/resize a rectangle, copy JSON
// - Puzzle: drag/resize .pz__window and component visualizations (manual layout only), copy JSON
// - Delete visualization via middle-click or Delete key

const DBG = () => (typeof window !== 'undefined' && /\bdebug=1\b/.test(window.location.search));

export class Editor {
    constructor({ game, overlay, hotspotLayer }) {
        this.game = game;
        this.overlay = overlay;
        this.hotspotLayer = hotspotLayer;
        this.sceneContainer = hotspotLayer?.parentElement || document.body;

        this.enabled = false;
        this.currentMode = null;   // 'scene' | 'puzzle'
        this.sceneEditor = null;
        this.puzzleEditor = null;
        this._rootObserver = null;
    }

    enable() {
        if (this.enabled) return;
        this.enabled = true;

        this._cleanup();
        document.body.classList.add('editor-on');
        this.overlay.classList.remove('hidden');

        Object.assign(this.overlay.style, { position: 'absolute', inset: '0', zIndex: '10000' });
        this.overlay.innerHTML = '';

        const puzzleRoot = document.querySelector('.pz');
        if (puzzleRoot) this._activatePuzzleMode(puzzleRoot);
        else this._activateSceneMode();

        this._startRootObserver();
    }

    disable() {
        if (!this.enabled) return;
        this.enabled = false;

        this._stopRootObserver();
        this._cleanup();

        this.overlay.classList.add('hidden');
        this.overlay.innerHTML = '';
        document.body.classList.remove('editor-on');
    }

    toggle() { this.enabled ? this.disable() : this.enable(); }

    _cleanup() {
        if (this.sceneEditor) { try { this.sceneEditor.destroy(); } catch {} this.sceneEditor = null; }
        if (this.puzzleEditor) { try { this.puzzleEditor.destroy(); } catch {} this.puzzleEditor = null; }
        this.overlay.innerHTML = '';

        // tvrdý úklid případných zbytků i mimo overlay
        document.querySelectorAll('.scene-final-rect,.scene-handle,.scene-final-label,.pz-viz,.editor-toolbar,.editor-jsonpanel,.editor-hint')
            .forEach(el => { try { el.remove(); } catch {} });
    }

    _activateSceneMode() {
        this.currentMode = 'scene';
        this.overlay.style.pointerEvents = 'auto';
        this.sceneEditor = new SceneEditor(this.game, this.overlay, this.hotspotLayer, this.sceneContainer);
        this.sceneEditor.enable();
    }

    _activatePuzzleMode(puzzleRoot) {
        this.currentMode = 'puzzle';
        this.overlay.innerHTML = '';
        this.overlay.style.pointerEvents = 'auto';
        this.puzzleEditor = new PuzzleEditor(puzzleRoot, this.overlay, this.sceneContainer);
        this.puzzleEditor.enable();
    }

    _startRootObserver() {
        if (this._rootObserver) return;
        const detect = () => {
            const hasPuzzle = !!document.querySelector('.pz');
            const newMode = hasPuzzle ? 'puzzle' : 'scene';
            if (!this.enabled) return;
            if (newMode !== this.currentMode) {
                this._cleanup();
                this.overlay.innerHTML = '';
                if (hasPuzzle) this._activatePuzzleMode(document.querySelector('.pz'));
                else this._activateSceneMode();
            }
        };
        this._rootObserver = new MutationObserver(detect);
        this._rootObserver.observe(document.body, { childList: true, subtree: true });
        detect();
    }

    _stopRootObserver() { try { this._rootObserver?.disconnect(); } catch {} this._rootObserver = null; }
}

// ---------------- Scene editor ----------------

class SceneEditor {
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
        this._onPointerUp   = this._onPointerUp.bind(this);
        this._onKeyDown     = this._onKeyDown.bind(this);
    }

    enable() {
        this._buildToolbar();
        this._buildHint();
        this._bind();
        this._renderPersistent();
    }

    destroy() {
        this._unbind();
        this.overlay.innerHTML = '';
        if (this.toolbar?.parentNode) this.toolbar.parentNode.removeChild(this.toolbar);
        if (this.hint?.parentNode) this.hint.parentNode.removeChild(this.hint);
        this.toolbar = null; this.jsonPanel = null; this.finalBox = null; this.label = null; this.hint = null;
    }

    _buildHint() {
        const hint = document.createElement('div');
        hint.className = 'editor-hint';
        hint.textContent = 'SCENE MODE: Click & drag to draw rectangle • Middle-click to delete';
        Object.assign(hint.style, {
            position: 'absolute', left: '10px', top: '10px', zIndex: '10001', pointerEvents: 'none',
            background: 'rgba(0,0,0,0.8)', padding: '6px 10px', borderRadius: '6px', color: '#0f6', font: '12px/1.4 sans-serif'
        });
        this.hint = hint;
        this.container.appendChild(hint);
    }

    _buildToolbar() {
        const tb = document.createElement('div');
        tb.className = 'editor-toolbar scene-toolbar';
        Object.assign(tb.style, {
            position: 'absolute', right: '10px', top: '10px', zIndex: '10001', pointerEvents: 'auto',
            background: 'rgba(0,0,0,0.8)', padding: '6px', borderRadius: '6px', color: '#fff', font: '12px/1.2 sans-serif'
        });
        const btnCopy = this._btn('📎 Copy JSON', () => this._copyJson());
        const btnShow = this._btn('📋 Show JSON', () => this._toggleJsonPanel());
        tb.appendChild(btnCopy); tb.appendChild(btnShow);
        this.toolbar = tb;
        this.container.appendChild(tb);
    }

    _btn(label, onClick) {
        const b = document.createElement('button');
        b.type='button'; b.textContent = label;
        Object.assign(b.style, { margin: '0 4px', padding: '4px 6px', cursor: 'pointer' });
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

    _boxRect() { return this.hotspotLayer.getBoundingClientRect(); }
    _clientToPct(ev) {
        const box = this._boxRect();
        const clamp = (v,min,max) => Math.max(min, Math.min(max, v));
        const x = clamp((ev.clientX - box.left) / box.width, 0, 1);
        const y = clamp((ev.clientY - box.top) / box.height, 0, 1);
        return { x:+(x*100).toFixed(2), y:+(y*100).toFixed(2) };
    }

    _renderPersistent() {
        this.overlay.querySelectorAll('.scene-final-rect,.scene-final-label,.scene-handle').forEach(el => el.remove());
        if (!this.rect) return;

        const r = this.rect;
        const box = document.createElement('div');
        box.className = 'scene-final-rect';
        Object.assign(box.style, {
            position:'absolute', left: r.x+'%', top: r.y+'%', width: r.w+'%', height: r.h+'%',
            border:'2px solid rgba(0,255,100,.8)', background:'rgba(0,255,100,.10)', zIndex:'9998', cursor:'move'
        });

        const handles = ['nw','n','ne','e','se','s','sw','w'];
        handles.forEach(h => {
            const dot = document.createElement('div');
            dot.className = 'scene-handle scene-handle-'+h;
            const size = 10;
            Object.assign(dot.style, { position:'absolute', width:size+'px', height:size+'px', background:'#0f6', border:'1px solid #090', zIndex:'9999' });
            const pos = (x,y)=>{ dot.style.left=x; dot.style.top=y; };
            switch(h){
                case 'nw': pos('-5px','-5px'); dot.style.cursor='nwse-resize'; break;
                case 'n':  pos('calc(50% - 5px)','-5px'); dot.style.cursor='ns-resize'; break;
                case 'ne': pos('calc(100% - 5px)','-5px'); dot.style.cursor='nesw-resize'; break;
                case 'e':  pos('calc(100% - 5px)','calc(50% - 5px)'); dot.style.cursor='ew-resize'; break;
                case 'se': pos('calc(100% - 5px)','calc(100% - 5px)'); dot.style.cursor='nwse-resize'; break;
                case 's':  pos('calc(50% - 5px)','calc(100% - 5px)'); dot.style.cursor='ns-resize'; break;
                case 'sw': pos('-5px','calc(100% - 5px)'); dot.style.cursor='nesw-resize'; break;
                case 'w':  pos('-5px','calc(50% - 5px)'); dot.style.cursor='ew-resize'; break;
            }
            dot.dataset.handle = h;
            box.appendChild(dot);
        });

        const label = document.createElement('div');
        label.className = 'scene-final-label';
        label.textContent = `x:${r.x} y:${r.y} w:${r.w} h:${r.h}`;
        Object.assign(label.style, { position:'absolute', left:'0', top:'-18px', padding:'2px 4px', background:'rgba(0,0,0,.8)', color:'#fff', font:'11px sans-serif' });
        box.appendChild(label);

        box.addEventListener('pointerdown', (ev) => {
            ev.stopPropagation();
            if (ev.button === 1) { this.rect = null; this._renderPersistent(); this._updateJsonPanel(); return; }
            const handle = ev.target?.dataset?.handle || null;
            this.dragMode = handle ? 'resize' : 'move';
            this.activeHandle = handle;
            this.startPt = { x: ev.clientX, y: ev.clientY };
            this.startRect = { ...this.rect };
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
        const r = this.rect || {x:0,y:0,w:0,h:0};
        this.jsonPanel.querySelector('textarea').value = JSON.stringify({ x:r.x, y:r.y, w:r.w, h:r.h }, null, 2);
    }

    _toggleJsonPanel() {
        if (this.jsonPanel) { this.jsonPanel.remove(); this.jsonPanel=null; return; }
        const panel = document.createElement('div');
        panel.className = 'editor-jsonpanel';
        Object.assign(panel.style, { position:'absolute', right:'10px', top:'50px', zIndex:'10002', background:'rgba(0,0,0,.85)', padding:'6px', borderRadius:'6px' });
        const ta = document.createElement('textarea');
        Object.assign(ta.style, { width:'260px', height:'160px', color:'#0f6', background:'#111', font:'12px monospace' });
        panel.appendChild(ta);
        const btn = this._btn('Copy', () => { ta.select(); document.execCommand?.('copy'); });
        panel.appendChild(btn);
        this.overlay.appendChild(panel);
        this.jsonPanel = panel;
        this._updateJsonPanel();
    }

    _copyJson() {
        const r = this.rect || {x:0,y:0,w:0,h:0};
        const text = JSON.stringify({ x:r.x, y:r.y, w:r.w, h:r.h });
        try { navigator.clipboard?.writeText(text); }
        catch {
            const ta = document.createElement('textarea'); ta.value=text; document.body.appendChild(ta);
            ta.select(); document.execCommand?.('copy'); document.body.removeChild(ta);
        }
    }

    _onPointerDown(ev) {
        if (ev.target.closest('.editor-toolbar') || ev.target.closest('.editor-jsonpanel')) return;
        const pct = this._clientToPct(ev);
        const inside = this.rect && pct.x >= this.rect.x && pct.x <= this.rect.x+this.rect.w
            && pct.y >= this.rect.y && pct.y <= this.rect.y+this.rect.h;
        if (inside) {
            this.dragMode = 'move'; this.activeHandle = null;
            this.startPt = { x:ev.clientX, y:ev.clientY };
            this.startRect = { ...this.rect };
            return;
        }
        this.dragMode = 'create'; this.activeHandle = null;
        this.startPt = { x:ev.clientX, y:ev.clientY };
        this.rect = { x: pct.x, y: pct.y, w: 0, h: 0 };
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
            this.rect.x = nx; this.rect.y = ny;
            Object.assign(this.finalBox.style, { left:this.rect.x+'%', top:this.rect.y+'%' });
            this._updateLabel(); this._updateJsonPanel();
            return;
        }

        if (this.dragMode === 'resize' && this.activeHandle) {
            const sr = this.startRect;
            const apply = (nx, ny, nw, nh) => {
                this.rect.x = +(Math.max(0, Math.min(100, nx))).toFixed(2);
                this.rect.y = +(Math.max(0, Math.min(100, ny))).toFixed(2);
                this.rect.w = +(Math.max(0, Math.min(100 - this.rect.x, nw))).toFixed(2);
                this.rect.h = +(Math.max(0, Math.min(100 - this.rect.y, nh))).toFixed(2);
                Object.assign(this.finalBox.style, { left:this.rect.x+'%', top:this.rect.y+'%', width:this.rect.w+'%', height:this.rect.h+'%' });
                this._updateLabel(); this._updateJsonPanel();
            };
            switch(this.activeHandle) {
                case 'nw': apply(sr.x + dx, sr.y + dy, sr.w - dx, sr.h - dy); break;
                case 'n':  apply(sr.x, sr.y + dy, sr.w, sr.h - dy); break;
                case 'ne': apply(sr.x, sr.y + dy, sr.w + dx, sr.h - dy); break;
                case 'e':  apply(sr.x, sr.y, sr.w + dx, sr.h); break;
                case 'se': apply(sr.x, sr.y, sr.w + dx, sr.h + dy); break;
                case 's':  apply(sr.x, sr.y, sr.w, sr.h + dy); break;
                case 'sw': apply(sr.x + dx, sr.y, sr.w - dx, sr.h + dy); break;
                case 'w':  apply(sr.x + dx, sr.y, sr.w - dx, sr.h); break;
            }
            return;
        }

        if (this.dragMode === 'create') {
            const p0 = this._clientToPct({ clientX: this.startPt.x, clientY: this.startPt.y });
            const p1 = this._clientToPct(ev);
            const x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y);
            const w = Math.max(0, Math.max(p0.x, p1.x) - x);
            const h = Math.max(0, Math.max(p0.y, p1.y) - y);
            this.rect = { x:+x.toFixed(2), y:+y.toFixed(2), w:+w.toFixed(2), h:+h.toFixed(2) };
            Object.assign(this.finalBox.style, { left:x+'%', top:y+'%', width:w+'%', height:h+'%' });
            this._updateLabel(); this._updateJsonPanel();
        }
    }

    _onPointerUp() { this.dragMode = null; this.activeHandle = null; this.startPt = null; this.startRect = null; }

    _onKeyDown(e) { if (e.key === 'Delete' || e.key === 'Backspace') { if (this.rect) { this.rect = null; this._renderPersistent(); } } }
}

// ---------------- Puzzle editor ----------------

class PuzzleEditor {
    constructor(puzzleRoot, overlay, container) {
        this.puzzleRoot = puzzleRoot;
        this.overlay = overlay;
        this.container = container;

        this.windowEl = puzzleRoot.querySelector('.pz__window');
        this.isManualLayout = puzzleRoot.classList.contains('pz--manual');

        this.components = new Map();
        this.visualizations = [];
        this.toolbar = null;
        this.jsonPanel = null;
        this.hint = null;
        this.active = null;

        this._onMouseDown = this._onMouseDown.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onMouseUp = this._onMouseUp.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
    }

    enable() {
        this._detectComponents();
        this._buildHint();
        this._buildToolbar();
        this._createVisualizations();
        this._bind();
    }

    destroy() {
        this._unbind();
        this.overlay.innerHTML = '';
        if (this.toolbar?.parentNode) this.toolbar.parentNode.removeChild(this.toolbar);
        if (this.hint?.parentNode) this.hint.parentNode.removeChild(this.hint);
        this.toolbar = null; this.jsonPanel = null; this.hint = null;
        this.visualizations = [];
    }

    _detectComponents() {
        if (!this.isManualLayout) return;
        const els = this.windowEl?.querySelectorAll('[data-id]') || [];
        els.forEach(el => {
            const id = el.dataset.id;
            const type = el.classList.contains('pz-token') ? 'token' : 'component';
            this.components.set(el, { id, type, element: el });
        });
    }

    _buildHint() {
        const hint = document.createElement('div');
        hint.className = 'editor-hint';
        hint.textContent = this.isManualLayout
            ? 'PUZZLE MODE (Manual): Drag/resize window & components • Middle-click to delete'
            : 'PUZZLE MODE (Auto): Drag/resize window only';
        Object.assign(hint.style, {
            position: 'absolute', left: '10px', top: '10px', zIndex: '10001', pointerEvents: 'none',
            background: 'rgba(0,0,0,0.8)', padding: '6px 10px', borderRadius: '6px', color: '#ff0', font: '12px/1.4 sans-serif'
        });
        this.hint = hint;
        this.container.appendChild(hint);
    }

    _buildToolbar() {
        const tb = document.createElement('div');
        tb.className = 'editor-toolbar puzzle-toolbar';
        Object.assign(tb.style, {
            position: 'absolute', right: '10px', top: '10px', zIndex: '10001', pointerEvents: 'auto',
            background: 'rgba(0,0,0,0.8)', padding: '6px', borderRadius: '6px', color: '#fff', font: '12px/1.2 sans-serif'
        });

        const btnCopy = this._btn('📎 Copy JSON', () => this._copyJson());
        const btnShow = this._btn('📋 Show JSON', () => this._toggleJsonPanel());
        const btnInfo = this._btn('ℹ️ Info', () => this._showInfo());

        tb.appendChild(btnCopy);
        tb.appendChild(btnShow);
        tb.appendChild(btnInfo);

        this.toolbar = tb;
        this.container.appendChild(tb);
    }

    _btn(label, onClick) {
        const b = document.createElement('button');
        b.type='button'; b.textContent = label;
        Object.assign(b.style, { margin: '0 4px', padding: '4px 6px', cursor: 'pointer' });
        b.addEventListener('click', onClick);
        return b;
    }

    _toggleJsonPanel() {
        if (this.jsonPanel) { this.jsonPanel.remove(); this.jsonPanel=null; return; }
        const panel = document.createElement('div');
        panel.className = 'editor-jsonpanel';
        Object.assign(panel.style, { position:'absolute', right:'10px', top:'50px', zIndex:'10002', background:'rgba(0,0,0,.85)', padding:'6px', borderRadius:'6px' });
        const ta = document.createElement('textarea');
        Object.assign(ta.style, { width:'280px', height:'200px', color:'#0cf', background:'#111', font:'12px monospace' });
        panel.appendChild(ta);
        const btn = this._btn('Copy', () => { ta.select(); document.execCommand?.('copy'); });
        panel.appendChild(btn);
        this.overlay.appendChild(panel);
        this.jsonPanel = panel;
        this._updateJson();
    }

    _copyJson() {
        const text = this._currentJson();
        try { navigator.clipboard?.writeText(text); }
        catch {
            const ta = document.createElement('textarea'); ta.value=text; document.body.appendChild(ta);
            ta.select(); document.execCommand?.('copy'); document.body.removeChild(ta);
        }
    }

    _showInfo() {
        const info = {
            layout: this.isManualLayout ? 'manual' : 'auto',
            components: this.components.size,
            windowRect: this._rectOf(this.windowEl, this.puzzleRoot)
        };
        alert(JSON.stringify(info, null, 2));
    }

    _currentJson() {
        const win = this._rectOf(this.windowEl, this.puzzleRoot);
        const comps = [];
        this.visualizations.forEach(v => {
            if (v.__deleted) return;
            if (!v.__meta) return;
            comps.push({
                id: v.__meta.id || 'component',
                type: v.__meta.type || 'component',
                rect: this._rectOf(v.__meta.element, this.windowEl)
            });
        });
        return JSON.stringify({ windowRect: win, components: comps }, null, 2);
    }

    _updateJson() { if (!this.jsonPanel) return; this.jsonPanel.querySelector('textarea').value = this._currentJson(); }

    _createVisualizations() {
        // okno (žluté)
        const wRect = this._rectOf(this.windowEl, this.puzzleRoot);
        const winViz = this._makeVizBox(wRect, 'pz-viz-window', 'Work Window', '#ff0');
        winViz.__target = this.windowEl;
        this.overlay.appendChild(winViz);
        this.visualizations.push(winViz);

        // komponenty (jen data-id)
        if (this.isManualLayout) {
            for (const [el, meta] of this.components.entries()) {
                const r = this._rectOf(el, this.windowEl);
                const viz = this._makeVizBox(r, 'pz-viz-component', meta.id, '#0ff');
                viz.__target = el;
                viz.__meta = meta;
                this.overlay.appendChild(viz);
                this.visualizations.push(viz);
            }
        }
        this._updateJson();
    }

    _makeVizBox(rect, cls, label, color) {
        const box = document.createElement('div');
        box.className = 'pz-viz ' + cls;
        Object.assign(box.style, {
            position:'absolute', left: rect.x+'%', top: rect.y+'%', width: rect.w+'%', height: rect.h+'%',
            border: `2px solid ${color}`, background: 'transparent', zIndex:'9998', cursor:'move', userSelect:'none'
        });

        const lab = document.createElement('div');
        lab.textContent = `${label}  x:${rect.x} y:${rect.y} w:${rect.w} h:${rect.h}`;
        Object.assign(lab.style, { position:'absolute', left:'0', top:'-18px', background:'rgba(0,0,0,.8)', color:'#fff', font:'11px sans-serif', padding:'2px 4px' });
        box.appendChild(lab);

        const handles = ['nw','n','ne','e','se','s','sw','w'];
        handles.forEach(h => {
            const dot = document.createElement('div');
            dot.dataset.handle = h;
            Object.assign(dot.style, { position:'absolute', width:'10px', height:'10px', background:color, border:'1px solid #333', zIndex:'9999' });
            const pos = (x,y)=>{ dot.style.left=x; dot.style.top=y; };
            switch(h){
                case 'nw': pos('-5px','-5px'); dot.style.cursor='nwse-resize'; break;
                case 'n':  pos('calc(50% - 5px)','-5px'); dot.style.cursor='ns-resize'; break;
                case 'ne': pos('calc(100% - 5px)','-5px'); dot.style.cursor='nesw-resize'; break;
                case 'e':  pos('calc(100% - 5px)','calc(50% - 5px)'); dot.style.cursor='ew-resize'; break;
                case 'se': pos('calc(100% - 5px)','calc(100% - 5px)'); dot.style.cursor='nwse-resize'; break;
                case 's':  pos('calc(50% - 5px)','calc(100% - 5px)'); dot.style.cursor='ns-resize'; break;
                case 'sw': pos('-5px','calc(100% - 5px)'); dot.style.cursor='nesw-resize'; break;
                case 'w':  pos('-5px','calc(50% - 5px)'); dot.style.cursor='ew-resize'; break;
            }
            box.appendChild(dot);
        });
        return box;
    }

    _rectOf(el, relTo) {
        const pr = relTo.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        const pct = (v, total) => +(v/total*100).toFixed(2);
        return { x: pct(er.left - pr.left, pr.width), y: pct(er.top - pr.top, pr.height), w: pct(er.width, pr.width), h: pct(er.height, pr.height) };
    }

    _applyRectToEl(el, rect) {
        Object.assign(el.style, { position:'absolute', left: rect.x+'%', top: rect.y+'%', width: rect.w+'%', height: rect.h+'%' });
    }

    _bind() {
        this.visualizations.forEach(v => v.addEventListener('mousedown', this._onMouseDown));
        window.addEventListener('mousemove', this._onMouseMove);
        window.addEventListener('mouseup', this._onMouseUp);
        window.addEventListener('keydown', this._onKeyDown);
    }
    _unbind() {
        this.visualizations.forEach(v => v.removeEventListener('mousedown', this._onMouseDown));
        window.removeEventListener('mousemove', this._onMouseMove);
        window.removeEventListener('mouseup', this._onMouseUp);
        window.removeEventListener('keydown', this._onKeyDown);
    }

    _onMouseDown(e) {
        e.preventDefault(); e.stopPropagation();
        const viz = e.currentTarget;
        const handle = e.target?.dataset?.handle;

        if (e.button === 1) { // middle-click delete viz
            viz.__deleted = true;
            viz.remove();
            this.visualizations = this.visualizations.filter(v => v !== viz);
            this._updateJson();
            return;
        }

        const startMouse = { x: e.clientX, y: e.clientY };
        const relRoot = viz.classList.contains('pz-viz-window') ? this.puzzleRoot : this.windowEl;
        const startElRect = this._rectOf(viz.__target, relRoot);

        this.active = { type: handle ? 'resize' : 'move', viz, handle, startMouse, startElRect, targetEl: viz.__target, relRoot };
    }

    _onMouseMove(e) {
        if (!this.active) return;
        const A = this.active;
        const box = A.relRoot.getBoundingClientRect();
        const dx = (e.clientX - A.startMouse.x) / box.width * 100;
        const dy = (e.clientY - A.startMouse.y) / box.height * 100;

        const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
        const apply = (nx, ny, nw, nh) => {
            nx = +(clamp(nx, 0, 100)).toFixed(2);
            ny = +(clamp(ny, 0, 100)).toFixed(2);
            nw = +(clamp(nw, 0, 100 - nx)).toFixed(2);
            nh = +(clamp(nh, 0, 100 - ny)).toFixed(2);

            Object.assign(A.viz.style, { left:nx+'%', top:ny+'%', width:nw+'%', height:nh+'%' });
            this._applyRectToEl(A.targetEl, {x:nx,y:ny,w:nw,h:nh});

            const lab = A.viz.querySelector('div');
            if (lab) {
                const prefix = lab.__prefix || lab.textContent.split('x:')[0].trim();
                lab.__prefix = prefix;
                lab.textContent = `${prefix}  x:${nx} y:${ny} w:${nw} h:${nh}`;
            }
            this._updateJson();
        };

        const sr = A.startElRect;

        if (A.type === 'move') { apply(sr.x + dx, sr.y + dy, sr.w, sr.h); return; }

        switch (A.handle) {
            case 'nw': apply(sr.x + dx, sr.y + dy, sr.w - dx, sr.h - dy); break;
            case 'n':  apply(sr.x, sr.y + dy, sr.w, sr.h - dy); break;
            case 'ne': apply(sr.x, sr.y + dy, sr.w + dx, sr.h - dy); break;
            case 'e':  apply(sr.x, sr.y, sr.w + dx, sr.h); break;
            case 'se': apply(sr.x, sr.y, sr.w + dx, sr.h + dy); break;
            case 's':  apply(sr.x, sr.y, sr.w, sr.h + dy); break;
            case 'sw': apply(sr.x + dx, sr.y, sr.w - dx, sr.h + dy); break;
            case 'w':  apply(sr.x + dx, sr.y, sr.w - dx, sr.h); break;
        }
    }

    _onMouseUp() { this.active = null; }
    _onKeyDown(e) { /* volitelné mazání vybrané vizualizace přes Delete */ }
}