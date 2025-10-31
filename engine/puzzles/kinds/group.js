// engine/puzzles/kinds/group.js
// Kind: group â€“ drag tokens into correct group areas (grid/manual layout)

import {BasePuzzle} from '../base.js';

const DBG = () => (typeof window !== 'undefined' && /\bdebug=1\b/.test(window.location.search));

export default class GroupPuzzle extends BasePuzzle {
    constructor(args) {
        super(args);
        this._tokenEls = new Map();
        this._tokenInit = new Map(); // id -> {left, top, transform} for reset
        this._inGroup = new Map();   // id -> groupId
        this._groupAreas = new Map(); // groupId -> DOM element
    }

    mount(container, workRect, backgroundUrl) {
        super.mount?.(container, workRect, backgroundUrl);
        const flow = this.flowEl;
        this.root?.classList.add('pz-kind-group');

        // Board container for groups + tokens
        const board = document.createElement('div');
        board.className = 'pz-group-board';
        Object.assign(board.style, {
            flex: '1 1 auto',
            position: 'relative',
            minHeight: '220px',
            borderRadius: 'var(--pz-token-radius)'
        });

        const layoutCfg = this.instanceOptions.layout || this.config.layout || {};
        const mode = layoutCfg.mode || 'auto';

        // Create group areas
        if (mode === 'manual') {
            // Manual positioning
            (this.config.groups || []).forEach(g => {
                const el = this._makeGroupArea(g);
                Object.assign(el.style, {
                    position: 'absolute',
                    left: (g.rect?.x ?? 0) + '%',
                    top: (g.rect?.y ?? 0) + '%',
                    width: (g.rect?.w ?? 0) + '%',
                    height: (g.rect?.h ?? 0) + '%'
                });
                board.appendChild(el);
            });
        } else {
            // Auto grid layout with dynamic calculation
            const dir = layoutCfg.direction || 'vertical';
            const groupCount = (this.config.groups || []).length;

            // Calculate optimal grid dimensions
            const {cols, rows} = this._calculateGridDimensions(groupCount, dir);

            const gap = layoutCfg.gap || '10px';

            Object.assign(board.style, {
                display: 'grid',
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gridTemplateRows: `repeat(${rows}, 1fr)`,
                gap: gap,
                // Center the entire grid in the board
                placeContent: 'center',
                // Horizontal: fill rows first (default), Vertical: fill columns first
                gridAutoFlow: dir === 'horizontal' ? 'row' : 'column'
            });

            (this.config.groups || []).forEach(g => {
                const el = this._makeGroupArea(g);
                board.appendChild(el);
            });
        }

        // Create draggable tokens (start at center)
        (this.config.tokens || []).forEach((t, i) => {
            const id = String(t.id ?? i);
            const el = this.createToken(t);

            Object.assign(el.style, {
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                cursor: 'grab',
                zIndex: '5'
            });

            board.appendChild(el);
            this._tokenEls.set(id, el);
            this._tokenInit.set(id, {
                left: el.style.left,
                top: el.style.top,
                transform: el.style.transform
            });

            this._enableDrag(id, el, board);
        });

        // Insert board BEFORE footer
        const footer = flow.querySelector('.pz-footer');
        if (footer) {
            flow.insertBefore(board, footer);
        } else {
            flow.appendChild(board);
        }

        if (DBG()) {
            console.debug('[PZ.group] mounted', {
                groupCount: this.config.groups?.length || 0,
                tokenCount: this.config.tokens?.length || 0,
                mode
            });
        }
    }

    _makeGroupArea(group) {
        const el = document.createElement('div');
        el.className = 'pz-group-area';
        el.setAttribute('data-group', String(group.id));

        Object.assign(el.style, {
            border: '1px solid rgba(255, 255, 255, 0.25)',
            borderRadius: 'var(--pz-token-radius)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: group.style?.bg || 'rgba(255, 255, 255, 0.04)',
            position: 'relative'
        });

        const label = document.createElement('div');
        label.className = 'pz-group-label';
        label.textContent = this.t(group.label || '', '');
        label.style.fontWeight = '600';
        label.style.opacity = '0.7';
        el.appendChild(label);

        this._groupAreas.set(String(group.id), el);
        return el;
    }

    /**
     * Calculate optimal grid dimensions based on group count and direction.
     * Ensures groups are centered and well-distributed.
     */
    _calculateGridDimensions(count, direction) {
        if (count <= 0) return {cols: 1, rows: 1};

        if (direction === 'vertical') {
            // Vertical: prefer filling columns first (groups side by side)
            // 1-3 groups → single row
            // 4+ groups → try to make roughly square grid
            if (count <= 3) {
                return {cols: count, rows: 1};
            }
            // For 4+: calculate optimal columns (roughly sqrt, prefer more columns than rows)
            const cols = Math.ceil(Math.sqrt(count));
            const rows = Math.ceil(count / cols);
            return {cols, rows};
        } else {
            // Horizontal: prefer filling rows first (groups stacked vertically)
            // 1-3 groups → single column
            // 4+ groups → try to make roughly square grid
            if (count <= 3) {
                return {cols: 1, rows: count};
            }
            // For 4+: calculate optimal rows (roughly sqrt, prefer more rows than columns)
            const rows = Math.ceil(Math.sqrt(count));
            const cols = Math.ceil(count / rows);
            return {cols, rows};
        }
    }

    _enableDrag(id, el, board) {
        let dragging = false;
        let startX = 0, startY = 0;
        let offsetX = 0, offsetY = 0;

        const onDown = (e) => {
            dragging = true;
            el.style.cursor = 'grabbing';
            el.style.zIndex = '10';

            const rect = board.getBoundingClientRect();
            const ev = e.touches ? e.touches[0] : e;
            startX = ev.clientX;
            startY = ev.clientY;

            const leftPct = parseFloat(el.style.left) || 50;
            const topPct = parseFloat(el.style.top) || 50;
            offsetX = (leftPct / 100) * rect.width;
            offsetY = (topPct / 100) * rect.height;

            e.preventDefault();
        };

        const onMove = (e) => {
            if (!dragging) return;

            const rect = board.getBoundingClientRect();
            const ev = e.touches ? e.touches[0] : e;

            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;

            const newX = Math.max(0, Math.min(rect.width, offsetX + dx));
            const newY = Math.max(0, Math.min(rect.height, offsetY + dy));

            el.style.left = (newX / rect.width * 100) + '%';
            el.style.top = (newY / rect.height * 100) + '%';
            el.style.transform = 'translate(-50%, -50%)';

            e.preventDefault();
        };

        const onUp = () => {
            if (!dragging) return;
            dragging = false;
            el.style.cursor = 'grab';
            el.style.zIndex = '5';

            // Find group under center of token
            const tokenRect = el.getBoundingClientRect();
            const cx = (tokenRect.left + tokenRect.right) / 2;
            const cy = (tokenRect.top + tokenRect.bottom) / 2;

            let hitGroupId = null;
            for (const [gid, area] of this._groupAreas.entries()) {
                const areaRect = area.getBoundingClientRect();
                if (cx >= areaRect.left && cx <= areaRect.right &&
                    cy >= areaRect.top && cy <= areaRect.bottom) {
                    hitGroupId = gid;
                    break;
                }
            }

            if (hitGroupId) {
                this._inGroup.set(id, hitGroupId);
            } else {
                this._inGroup.delete(id);
            }

            if (DBG()) {
                console.debug('[PZ.group] drag end:', {id, group: hitGroupId});
            }
        };

        el.addEventListener('mousedown', onDown);
        el.addEventListener('touchstart', onDown, {passive: false});

        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchmove', onMove, {passive: false});

        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchend', onUp);
    }

    _solutions() {
        // Expected: solutions: { [tokenId]: groupId, ... }
        return this.config.solutions || this.config.solution || {};
    }

    onOk() {
        const sol = this._solutions();
        let allOk = true;

        for (const [id, el] of this._tokenEls.entries()) {
            const got = this._inGroup.get(id) || null;
            const expect = String(sol[id] ?? '');
            const good = (String(got ?? '') === expect);

            if (!this.instanceOptions.aggregateOnly) {
                el.classList.remove('correct', 'wrong', 'is-correct', 'is-wrong');
                el.classList.add(good ? 'correct' : 'wrong', good ? 'is-correct' : 'is-wrong');
            }

            if (!good) allOk = false;
        }

        if (!allOk && this.instanceOptions.blockUntilSolved) {
            // Reset wrong tokens to center
            for (const [id, el] of this._tokenEls.entries()) {
                const got = this._inGroup.get(id) || null;
                const expect = String(sol[id] ?? '');
                if (String(got ?? '') !== expect) {
                    const init = this._tokenInit.get(id);
                    if (init) {
                        el.style.left = init.left;
                        el.style.top = init.top;
                        el.style.transform = init.transform;
                    }
                    this._inGroup.delete(id);
                }
            }
            return {hold: true};
        }

        const detail = {};
        for (const [id, gid] of this._inGroup.entries()) {
            detail[id] = gid;
        }

        if (DBG()) {
            console.debug('[PZ.group] onOk result:', {allOk, groups: detail, solutions: sol});
        }

        return {
            ok: allOk,
            detail: {groups: detail}
        };
    }
}