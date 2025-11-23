// engine/puzzles/kinds/match.js
// Kind: match – pair matching (columns click mode or dragdrop mode)

import {BasePuzzle} from '../base.js';

const DBG = () => (typeof window !== 'undefined' && /\bdebug=1\b/.test(window.location.search));

/**
 * Pair color palette - Intelligent selection
 * REMOVED: Reds (confusion with error), Light Blues (confusion with selection)
 * KEPT: Distinct, vibrant colors visible on dark backgrounds
 */
const PAIR_COLORS = [
    'rgba(155, 89, 182, 0.35)',  // Amethyst (Purple) - distinct from blue
    'rgba(26, 188, 156, 0.35)',  // Turquoise/Teal - distinct from selection blue
    'rgba(230, 126, 34, 0.35)',  // Carrot (Orange)
    'rgba(241, 196, 15, 0.35)',  // Moon Yellow (Gold)
    'rgba(219, 10, 172, 0.35)',  // Magenta/Deep Pink
    'rgba(46, 204, 113, 0.35)',  // Emerald (Green) - distinct from error red
    'rgba(52, 73, 94, 0.50)',    // Wet Asphalt (Dark Grey-Blue)
    'rgba(166, 219, 10, 0.35)',  // Lime
    'rgba(139, 69, 19, 0.40)',   // Saddle Brown
    'rgba(0, 128, 128, 0.35)',   // Teal
    'rgba(128, 0, 128, 0.35)',   // Purple
    'rgba(255, 20, 147, 0.35)'   // Deep Pink
];

export default class MatchPuzzle extends BasePuzzle {
    constructor(args) {
        super(args);
        this._tokenEls = new Map();
        this._tokenSides = new Map(); // Track which side each token belongs to
        this._pairs = new Map(); // tokenId -> pairedTokenId
        this._selectedForPair = null; // first token of pair in click mode
        this._mode = (args.config?.mode || 'columns').toLowerCase();
    }

    /**
     * Override createToken to fix Image paths and layout
     */
    createToken(data) {
        // 1. Let BasePuzzle create the structure (button > img + span)
        const el = super.createToken(data);

        // 2. FIX IMAGE PATH: BasePuzzle doesn't resolve assets, we must do it here.
        if (data.image) {
            let img = el.querySelector('.pz-token-image');

            // Resolve path relative to game root
            const src = this.engine && this.engine._resolveAsset
                ? this.engine._resolveAsset(data.image)
                : data.image;

            if (img) {
                // Update existing image source created by BasePuzzle
                img.src = src;
            } else {
                // Fallback if BasePuzzle logic changes
                img = document.createElement('img');
                img.src = src;
                img.className = 'pz-token-image';
                img.draggable = false;
                el.prepend(img);
            }
            el.classList.add('has-image');
        }

        return el;
    }

    /**
     * Get pair color by index with fallback to random color
     * @param {number} pairIndex - Index of the pair (0-based)
     * @returns {string} RGBA color string
     */
    _getPairColor(pairIndex) {
        if (pairIndex < PAIR_COLORS.length) {
            return PAIR_COLORS[pairIndex];
        }

        // Fallback: generate random vibrant color (avoiding reds/blues)
        // High Green/Red mix (Yellows/Oranges) or High Red/Blue mix (Purples)
        const r = 50 + Math.floor(Math.random() * 150);
        const g = 100 + Math.floor(Math.random() * 155);
        const b = 50 + Math.floor(Math.random() * 100); // Keep blue low to avoid selection confusion
        return `rgba(${r}, ${g}, ${b}, 0.35)`;
    }

    /**
     * Finds the lowest available color index not currently used on the board.
     * Prevents color collisions when pairs are removed and new ones added.
     */
    _getNextAvailableColorIndex() {
        const usedIndices = new Set();

        // Scan all tokens to see which indices are currently active
        this._tokenEls.forEach(el => {
            if (el.dataset.pairIndex !== undefined) {
                usedIndices.add(parseInt(el.dataset.pairIndex, 10));
            }
        });

        // Find first gap (0, 1, 2...)
        let idx = 0;
        while (usedIndices.has(idx)) {
            idx++;
        }
        return idx;
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
            this._tokenSides.set(t.id, 'left'); // Track side
            leftCol.appendChild(el);
        });

        rightTokens.forEach(t => {
            const el = this.createToken(t);
            el.addEventListener('click', () => this._onClickToken(t.id));
            this._tokenEls.set(t.id, el);
            this._tokenSides.set(t.id, 'right'); // Track side
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

    _generateScatteredPositions(count) {
        if (count === 0) return [];
        const cols = Math.ceil(Math.sqrt(count));
        const rows = Math.ceil(count / cols);
        const marginX = 12;
        const marginY = 12;
        const availableWidth = 100 - (2 * marginX);
        const availableHeight = 100 - (2 * marginY);
        const cellWidth = availableWidth / cols;
        const cellHeight = availableHeight / rows;

        const positions = [];
        for (let i = 0; i < count; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const centerX = marginX + (col + 0.5) * cellWidth;
            const centerY = marginY + (row + 0.5) * cellHeight;
            const offsetX = (Math.random() - 0.5) * cellWidth * 0.6;
            const offsetY = (Math.random() - 0.5) * cellHeight * 0.6;

            positions.push({
                x: Math.max(marginX, Math.min(100 - marginX, centerX + offsetX)),
                y: Math.max(marginY, Math.min(100 - marginY, centerY + offsetY))
            });
        }

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
        el.classList.remove('correct', 'wrong', 'is-correct', 'is-wrong');

        const currentPair = this._pairs.get(id);
        if (!currentPair) {
            // Only reset bg if not paired (paired tokens have permanent color)
            el.style.background = '';
            delete el.dataset.pairIndex;
        }

        // 1. If already paired -> UNPAIR
        if (currentPair) {
            const otherEl = this._tokenEls.get(currentPair);

            this._pairs.delete(id);
            this._pairs.delete(currentPair);

            el.style.background = '';
            delete el.dataset.pairIndex;
            el.classList.remove('selected', 'is-selected');
            el.blur();

            if (otherEl) {
                otherEl.style.background = '';
                delete otherEl.dataset.pairIndex;
                otherEl.classList.remove('correct', 'wrong', 'is-correct', 'is-wrong', 'selected', 'is-selected');
                otherEl.blur();
            }

            if (DBG()) console.debug('[PZ.match] unpaired:', {id, was: currentPair});
            return;
        }

        // 2. Select First Token
        if (!this._selectedForPair) {
            this._selectedForPair = id;

            // FIX: Don't set background color yet! Just use CSS selection class.
            // This prevents the "colors looking like a pair" confusion.
            el.classList.add('selected', 'is-selected');
            el.blur();

            if (DBG()) console.debug('[PZ.match] first selected (waiting for match):', id);

            // 3. Deselect Self
        } else if (this._selectedForPair === id) {
            this._selectedForPair = null;
            el.classList.remove('selected', 'is-selected');
            el.style.background = '';
            el.blur();

            if (DBG()) console.debug('[PZ.match] deselected:', id);

            // 4. Form Pair
        } else {
            const first = this._selectedForPair;
            const firstSide = this._tokenSides.get(first);
            const secondSide = this._tokenSides.get(id);

            // Constraint: Different sides only
            if (firstSide === secondSide) {
                // Switch selection to this new one
                const firstEl = this._tokenEls.get(first);
                if (firstEl) {
                    firstEl.classList.remove('selected', 'is-selected');
                    firstEl.style.background = '';
                }

                this._selectedForPair = id;
                el.classList.add('selected', 'is-selected');
                el.blur();

                if (DBG()) console.debug('[PZ.match] same side - reselecting:', {first, second: id});
                return;
            }

            // Create Pair
            this._selectedForPair = null;
            this._pairs.set(first, id);
            this._pairs.set(id, first);

            // FIX: Calculate unique color index to avoid collisions with existing pairs
            const pairIndex = this._getNextAvailableColorIndex();
            const pairColor = this._getPairColor(pairIndex);

            const el1 = this._tokenEls.get(first);
            const el2 = this._tokenEls.get(id);

            if (el1) {
                el1.classList.remove('selected', 'is-selected');
                el1.style.background = pairColor;
                el1.dataset.pairIndex = pairIndex; // Store index for collision check
                el1.blur();
            }
            if (el2) {
                el2.classList.remove('selected', 'is-selected');
                el2.style.background = pairColor;
                el2.dataset.pairIndex = pairIndex;
                el2.blur();
            }

            if (DBG()) console.debug('[PZ.match] paired:', {first, second: id, color: pairColor, index: pairIndex});
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
            el.classList.add('is-dragging');

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
            el.classList.remove('is-dragging');

            const rect1 = el.getBoundingClientRect();
            const cx = (rect1.left + rect1.right) / 2;
            const cy = (rect1.top + rect1.bottom) / 2;

            for (const [otherId, otherEl] of this._tokenEls.entries()) {
                if (otherId === id) continue;

                const rect2 = otherEl.getBoundingClientRect();
                if (cx >= rect2.left && cx <= rect2.right &&
                    cy >= rect2.top && cy <= rect2.bottom) {

                    this._pairs.set(id, otherId);
                    this._pairs.set(otherId, id);

                    const idx = this._getNextAvailableColorIndex();
                    const pairColor = this._getPairColor(idx);

                    el.style.background = pairColor;
                    el.dataset.pairIndex = idx;

                    otherEl.style.background = pairColor;
                    otherEl.dataset.pairIndex = idx;

                    if (DBG()) console.debug('[PZ.match] drag paired:', {id, otherId});
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

        const wrongTokens = [];
        const wrongAll = [];

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
                    // Reset pair color visually so red is clearly visible
                    el.style.background = '';
                    wrongAll.push(id);
                    if (pairedWith) {
                        wrongTokens.push(id);
                    }
                }
            }
            if (!good) allOk = false;
        }

        if (!allOk && this.instanceOptions.blockUntilSolved) {
            if (wrongTokens.length > 0 || wrongAll.length > 0) {
                setTimeout(() => {
                    const alreadyReset = new Set();
                    for (const id of wrongTokens) {
                        if (alreadyReset.has(id)) continue;

                        const el = this._tokenEls.get(id);
                        const pairedWith = this._pairs.get(id);
                        if (!pairedWith || !el) continue;

                        const otherEl = this._tokenEls.get(pairedWith);

                        this._pairs.delete(id);
                        this._pairs.delete(pairedWith);

                        // Clear styles
                        el.classList.remove('wrong', 'is-wrong', 'selected', 'is-selected');
                        el.style.background = '';
                        delete el.dataset.pairIndex; // Free up the color index!

                        if (otherEl) {
                            otherEl.classList.remove('wrong', 'is-wrong', 'selected', 'is-selected');
                            otherEl.style.background = '';
                            delete otherEl.dataset.pairIndex;
                        }

                        alreadyReset.add(id);
                        alreadyReset.add(pairedWith);
                    }

                    // Clear remaining red flashes
                    for (const [tid, tel] of this._tokenEls.entries()) {
                        if (tel && tel.classList.contains('is-wrong')) {
                            tel.classList.remove('wrong', 'is-wrong');
                            // Only reset bg if it wasn't a correct pair that somehow got flagged
                            // (logic above ensures strictly pairs logic)
                            if (!this._pairs.has(tid)) {
                                tel.style.background = '';
                                delete tel.dataset.pairIndex;
                            }
                        }
                    }
                }, 800);
            }
            return {hold: true};
        }

        const detail = {};
        for (const [id, pairedWith] of this._pairs.entries()) {
            detail[id] = pairedWith;
        }

        return {ok: allOk, detail: {pairs: detail}};
    }
}
