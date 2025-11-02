// engine/puzzles/kinds/match.js
// Kind: match â€“ pair matching (columns click mode or dragdrop mode)

import {BasePuzzle} from '../base.js';

const DBG = () => (typeof window !== 'undefined' && /\bdebug=1\b/.test(window.location.search));

export default class MatchPuzzle extends BasePuzzle {
    constructor(args) {
        super(args);
        this._tokenEls = new Map();
        this._pairs = new Map(); // tokenId -> pairedTokenId
        this._selectedForPair = null; // first token of pair in click mode
        this._mode = (args.config?.mode || 'columns').toLowerCase();
    }

    mount(container, workRect, backgroundUrl) {
        super.mount?.(container, workRect, backgroundUrl);
        const flow = this.flowEl;
        this.root?.classList.add('pz-kind-match');
        this.root?.classList.add(`pz-match--${this._mode}`);

        if (this._mode === 'dragdrop') {
            this._mountDragDropMode(flow);
        } else {
            this._mountColumnsMode(flow);
        }

        if (DBG()) {
            console.debug('[PZ.match] mounted', {
                mode: this._mode,
                tokenCount: this.config.tokens?.length || 0
            });
        }
    }

    _mountColumnsMode(flow) {
        // Two columns (vertical) or two rows (horizontal): left/top + right/bottom
        const layoutCfg = this.instanceOptions.layout || this.config.layout || {};
        const dir = layoutCfg.direction || 'vertical';

        const container = document.createElement('div');
        container.className = 'pz-match-columns';
        Object.assign(container.style, {
            flex: '1 1 auto',
            display: 'grid',
            gridTemplateColumns: dir === 'horizontal' ? '1fr' : '1fr 1fr',
            gridTemplateRows: dir === 'horizontal' ? '1fr 1fr' : '1fr',
            gap: 'calc(var(--pz-token-gap) * 2)',
            alignContent: 'start'
        });

        const leftCol = document.createElement('div');
        leftCol.className = 'pz-match-column pz-match-column--left';
        Object.assign(leftCol.style, {
            display: 'flex',
            flexDirection: dir === 'horizontal' ? 'row' : 'column',
            flexWrap: dir === 'horizontal' ? 'wrap' : 'nowrap',
            gap: 'var(--pz-token-gap)'
        });

        const rightCol = document.createElement('div');
        rightCol.className = 'pz-match-column pz-match-column--right';
        Object.assign(rightCol.style, {
            display: 'flex',
            flexDirection: dir === 'horizontal' ? 'row' : 'column',
            flexWrap: dir === 'horizontal' ? 'wrap' : 'nowrap',
            gap: 'var(--pz-token-gap)'
        });

        // Separate tokens by side
        const leftTokens = [];
        const rightTokens = [];

        (this.config.tokens || []).forEach((t, idx) => {
            const id = String(t.id ?? idx);
            const side = (t.side || '').toLowerCase();
            if (side === 'right') {
                rightTokens.push({id, ...t});
            } else {
                leftTokens.push({id, ...t});
            }
        });

        // SHUFFLE both sides independently (Fisher-Yates in-place)
        const shuffle = (arr) => {
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
        };

        shuffle(leftTokens);
        shuffle(rightTokens);

        // Create and append shuffled tokens
        leftTokens.forEach(t => {
            const el = this.createToken(t);
            el.addEventListener('click', () => this._onClickToken(t.id));
            this._tokenEls.set(t.id, el);
            leftCol.appendChild(el);
        });

        rightTokens.forEach(t => {
            const el = this.createToken(t);
            el.addEventListener('click', () => this._onClickToken(t.id));
            this._tokenEls.set(t.id, el);
            rightCol.appendChild(el);
        });

        container.appendChild(leftCol);
        container.appendChild(rightCol);

        // Insert BEFORE footer
        const footer = flow.querySelector('.pz-footer');
        if (footer) {
            flow.insertBefore(container, footer);
        } else {
            flow.appendChild(container);
        }
    }

    _mountDragDropMode(flow) {
        // Scattered tokens on board - drag to pair
        const board = document.createElement('div');
        board.className = 'pz-match-board';
        Object.assign(board.style, {
            flex: '1 1 auto',
            position: 'relative',
            minHeight: '220px'
        });

        const tokens = this.config.tokens || [];
        const positions = this._generateScatteredPositions(tokens.length);

        // Create tokens at scattered positions (non-overlapping)
        tokens.forEach((t, idx) => {
            const id = String(t.id ?? idx);
            const el = this.createToken(t);
            const pos = positions[idx];

            Object.assign(el.style, {
                position: 'absolute',
                left: pos.x + '%',
                top: pos.y + '%',
                transform: 'translate(-50%, -50%)',
                cursor: 'grab',
                zIndex: '5'
            });

            board.appendChild(el);
            this._tokenEls.set(id, el);
            this._enableDrag(id, el, board);
        });

        // Insert BEFORE footer
        const footer = flow.querySelector('.pz-footer');
        if (footer) {
            flow.insertBefore(board, footer);
        } else {
            flow.appendChild(board);
        }
    }

    /**
     * Generate well-distributed positions for tokens to minimize overlap.
     * Uses a grid-based approach with randomization.
     */
    _generateScatteredPositions(count) {
        if (count === 0) return [];

        // Calculate grid dimensions (roughly square)
        const cols = Math.ceil(Math.sqrt(count));
        const rows = Math.ceil(count / cols);

        // Margins from edges
        const marginX = 12;
        const marginY = 12;

        // Available space
        const availableWidth = 100 - (2 * marginX);
        const availableHeight = 100 - (2 * marginY);

        // Cell dimensions
        const cellWidth = availableWidth / cols;
        const cellHeight = availableHeight / rows;

        // Generate grid positions with randomization within cells
        const positions = [];
        for (let i = 0; i < count; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);

            // Center of cell
            const centerX = marginX + (col + 0.5) * cellWidth;
            const centerY = marginY + (row + 0.5) * cellHeight;

            // Add random offset within cell (±30% of cell size)
            const offsetX = (Math.random() - 0.5) * cellWidth * 0.6;
            const offsetY = (Math.random() - 0.5) * cellHeight * 0.6;

            positions.push({
                x: Math.max(marginX, Math.min(100 - marginX, centerX + offsetX)),
                y: Math.max(marginY, Math.min(100 - marginY, centerY + offsetY))
            });
        }

        // Shuffle positions for more natural feel
        for (let i = positions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [positions[i], positions[j]] = [positions[j], positions[i]];
        }

        return positions;
    }

    _onClickToken(id) {
        const el = this._tokenEls.get(id);
        if (!el) return;

        // CRITICAL FIX: Remove validation classes to allow re-selection after onOk
        // This enables clicking on tokens marked as .correct or .wrong
        el.classList.remove('correct', 'wrong', 'is-correct', 'is-wrong');

        // Reset background from validation (keep pairing colors)
        const currentPair = this._pairs.get(id);
        if (!currentPair) {
            // Only reset if not paired (paired tokens have color coding)
            el.style.background = '';
        }

        // If already paired, also clear validation from paired token
        if (currentPair) {
            const otherEl = this._tokenEls.get(currentPair);
            if (otherEl) {
                otherEl.classList.remove('correct', 'wrong', 'is-correct', 'is-wrong');
            }
        }

        // Check if this token is already paired
        if (currentPair) {
            // Unpair: remove pairing and reset colors
            this._pairs.delete(id);
            this._pairs.delete(currentPair);

            el.style.background = ''; // Reset to default
            el.classList.remove('selected', 'is-selected');

            const otherEl = this._tokenEls.get(currentPair);
            if (otherEl) {
                otherEl.style.background = ''; // Reset to default
                otherEl.classList.remove('selected', 'is-selected');
            }

            if (DBG()) {
                console.debug('[PZ.match] unpaired:', {id, was: currentPair});
            }
            return;
        }

        if (!this._selectedForPair) {
            // First selection
            this._selectedForPair = id;
            el.classList.add('selected', 'is-selected');

            if (DBG()) {
                console.debug('[PZ.match] first selected:', id);
            }
        } else if (this._selectedForPair === id) {
            // Deselect same token
            this._selectedForPair = null;
            el.classList.remove('selected', 'is-selected');

            if (DBG()) {
                console.debug('[PZ.match] deselected:', id);
            }
        } else {
            // Pair with first token
            const first = this._selectedForPair;
            this._selectedForPair = null;

            this._pairs.set(first, id);
            this._pairs.set(id, first);

            // Animate pairing - same color
            const colorIndex = (this._pairs.size / 2) % 6;
            const colors = [
                'rgba(90, 160, 255, 0.25)',
                'rgba(255, 90, 160, 0.25)',
                'rgba(90, 255, 160, 0.25)',
                'rgba(255, 160, 90, 0.25)',
                'rgba(160, 90, 255, 0.25)',
                'rgba(255, 255, 90, 0.25)'
            ];
            const pairColor = colors[colorIndex];

            const el1 = this._tokenEls.get(first);
            const el2 = this._tokenEls.get(id);

            if (el1) {
                el1.classList.remove('selected', 'is-selected');
                el1.style.background = pairColor;
            }
            if (el2) {
                el2.classList.remove('selected', 'is-selected');
                el2.style.background = pairColor;
            }

            if (DBG()) {
                console.debug('[PZ.match] paired:', {first, second: id});
            }
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

            e.preventDefault();
        };

        const onUp = () => {
            if (!dragging) return;
            dragging = false;
            el.style.cursor = 'grab';
            el.style.zIndex = '5';

            // Check collision with other tokens for pairing
            const rect1 = el.getBoundingClientRect();
            const cx = (rect1.left + rect1.right) / 2;
            const cy = (rect1.top + rect1.bottom) / 2;

            for (const [otherId, otherEl] of this._tokenEls.entries()) {
                if (otherId === id) continue;

                const rect2 = otherEl.getBoundingClientRect();
                if (cx >= rect2.left && cx <= rect2.right &&
                    cy >= rect2.top && cy <= rect2.bottom) {
                    // Pair them!
                    this._pairs.set(id, otherId);
                    this._pairs.set(otherId, id);

                    // Same color for pair
                    const pairColor = `rgba(${100 + Math.random() * 155}, ${100 + Math.random() * 155}, ${100 + Math.random() * 155}, 0.25)`;
                    el.style.background = pairColor;
                    otherEl.style.background = pairColor;

                    if (DBG()) {
                        console.debug('[PZ.match] drag paired:', {id, otherId});
                    }
                    break;
                }
            }
        };

        el.addEventListener('mousedown', onDown);
        el.addEventListener('touchstart', onDown, {passive: false});

        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchmove', onMove, {passive: false});

        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchend', onUp);
    }

    _solutionPairs() {
        // Expected: pairs: [["id1", "id2"], ...] or solutionPairs: [...]
        const raw = this.config.pairs || this.config.solutionPairs || [];
        const pairMap = new Map();

        raw.forEach(([a, b]) => {
            pairMap.set(String(a), String(b));
            pairMap.set(String(b), String(a));
        });

        return pairMap;
    }

    onOk() {
        const sol = this._solutionPairs();
        let allOk = true;

        for (const [id, el] of this._tokenEls.entries()) {
            const pairedWith = this._pairs.get(id);
            const expectedPair = sol.get(id);
            const good = (pairedWith === expectedPair);

            if (!this.instanceOptions.aggregateOnly) {
                el.classList.remove('correct', 'wrong', 'is-correct', 'is-wrong');

                if (good && pairedWith) {
                    el.classList.add('correct', 'is-correct');
                } else if (!good) {
                    el.classList.add('wrong', 'is-wrong');
                    // Reset color for wrong pairs
                    el.style.background = '';
                }
            }

            if (!good) allOk = false;
        }

        if (!allOk && this.instanceOptions.blockUntilSolved) {
            return {hold: true};
        }

        const detail = {};
        for (const [id, pairedWith] of this._pairs.entries()) {
            detail[id] = pairedWith;
        }

        if (DBG()) {
            console.debug('[PZ.match] onOk result:', {allOk, pairs: detail});
        }

        return {
            ok: allOk,
            detail: {pairs: detail}
        };
    }
}