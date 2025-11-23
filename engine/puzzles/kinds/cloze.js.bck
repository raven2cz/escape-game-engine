// engine/puzzles/kinds/cloze.js
// Kind: cloze – doplňovačka (fill-in-the-blanks with drag-and-drop)

import {BasePuzzle} from '../base.js';

const DBG = () => (typeof window !== 'undefined' && /\bdebug=1\b/.test(window.location.search));

export default class ClozePuzzle extends BasePuzzle {
    constructor(args) {
        super(args);
        this._tokenEls = new Map();      // tokenId -> DOM element
        this._gapEls = new Map();        // gapId -> DOM element (gap container)
        this._placements = new Map();    // gapId -> tokenId (current placements)
        this._draggedToken = null;       // currently dragged token ID
        this._tokensArea = null;         // reference to tokens container
    }

    mount(container, workRect, backgroundUrl) {
        super.mount?.(container, workRect, backgroundUrl);
        const flow = this.flowEl;
        this.root?.classList.add('pz-kind-cloze');

        // Determine layout direction
        const layoutCfg = this.instanceOptions.layout || this.config.layout || {};
        const direction = layoutCfg.direction || 'vertical';

        // Create main container with two areas
        const clozeContainer = document.createElement('div');
        clozeContainer.className = 'pz-cloze-container';
        Object.assign(clozeContainer.style, {
            flex: '1 1 auto',
            display: 'flex',
            flexDirection: direction === 'horizontal' ? 'row' : 'column',
            gap: 'calc(var(--pz-token-gap) * 2)',
            minHeight: '0'
        });

        // 1. Text area with gaps
        const textArea = this._createTextArea();
        clozeContainer.appendChild(textArea);

        // 2. Tokens area (shuffled)
        const tokensArea = this._createTokensArea();
        this._tokensArea = tokensArea;
        clozeContainer.appendChild(tokensArea);

        // Insert before footer
        const footer = flow.querySelector('.pz-footer');
        if (footer) {
            flow.insertBefore(clozeContainer, footer);
        } else {
            flow.appendChild(clozeContainer);
        }

        if (DBG()) {
            console.debug('[PZ.cloze] mounted', {
                direction, gapCount: this._gapEls.size, tokenCount: this._tokenEls.size
            });
        }
    }

    /**
     * Create text area with inline gaps for tokens.
     * Parses config.text and replaces {gapN} with drop zones.
     */
    _createTextArea() {
        const area = document.createElement('div');
        area.className = 'pz-cloze-text-area';

        const text = this.t(this.config.text || '', '');

        // Split text by gap placeholders {gap1}, {gap2}, etc.
        const parts = text.split(/(\{gap\d+})/g);

        parts.forEach(part => {
            if (/^\{gap\d+}$/.test(part)) {
                // This is a gap placeholder
                const gapId = part.slice(1, -1); // "gap1" from "{gap1}"
                const gap = this._createGap(gapId);
                area.appendChild(gap);
                this._gapEls.set(gapId, gap);
            } else if (part.trim()) {
                // Regular text
                const textSpan = document.createElement('span');
                textSpan.textContent = part;
                textSpan.style.whiteSpace = 'pre-wrap';
                area.appendChild(textSpan);
            }
        });

        return area;
    }

    /**
     * Create a single gap (drop zone for tokens).
     */
    _createGap(gapId) {
        const gap = document.createElement('span');
        gap.className = 'pz-cloze-gap';
        gap.setAttribute('data-gap-id', gapId);

        // Drop zone event handlers
        gap.addEventListener('dragover', (e) => this._onGapDragOver(e, gapId));
        gap.addEventListener('dragleave', (e) => this._onGapDragLeave(e, gapId));
        gap.addEventListener('drop', (e) => this._onGapDrop(e, gapId));

        // Allow clicking on filled gap to return token
        gap.addEventListener('click', () => this._onGapClick(gapId));

        return gap;
    }

    /**
     * Create tokens area with shuffled tokens ready for dragging.
     */
    _createTokensArea() {
        const area = document.createElement('div');
        area.className = 'pz-cloze-tokens-area';

        const tokens = [...(this.config.tokens || [])];

        // Shuffle tokens (Fisher-Yates)
        for (let i = tokens.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [tokens[i], tokens[j]] = [tokens[j], tokens[i]];
        }

        tokens.forEach(t => {
            const id = String(t.id);
            const el = this.createToken(t);
            el.draggable = true;
            el.setAttribute('data-token-id', id);

            // Drag event handlers
            el.addEventListener('dragstart', (e) => this._onTokenDragStart(e, id));
            el.addEventListener('dragend', () => this._onTokenDragEnd());

            this._tokenEls.set(id, el);
            area.appendChild(el);
        });

        // Make tokens area a drop zone too (for returning tokens)
        area.addEventListener('dragover', (e) => this._onAreaDragOver(e));
        area.addEventListener('drop', (e) => this._onAreaDrop(e));

        return area;
    }

    // ========================================================================
    // DRAG AND DROP HANDLERS
    // ========================================================================

    _onTokenDragStart(e, tokenId) {
        this._draggedToken = tokenId;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', tokenId);

        const el = this._tokenEls.get(tokenId);
        if (el) {
            el.style.opacity = '0.5';
            el.classList.add('dragging');
        }

        if (DBG()) {
            console.debug('[PZ.cloze] dragStart:', tokenId);
        }
    }

    _onTokenDragEnd() {
        if (!this._draggedToken) return;

        const el = this._tokenEls.get(this._draggedToken);
        if (el) {
            el.style.opacity = '1';
            el.classList.remove('dragging');
        }

        this._draggedToken = null;

        if (DBG()) {
            console.debug('[PZ.cloze] dragEnd');
        }
    }

    _onGapDragOver(e, gapId) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const gap = this._gapEls.get(gapId);
        if (gap && !gap.classList.contains('filled')) {
            gap.classList.add('drag-over');
        }
    }

    _onGapDragLeave(e, gapId) {
        const gap = this._gapEls.get(gapId);
        if (gap) {
            gap.classList.remove('drag-over');
        }
    }

    _onGapDrop(e, gapId) {
        e.preventDefault();
        if (!this._draggedToken) return;

        const gap = this._gapEls.get(gapId);
        if (!gap) return;

        gap.classList.remove('drag-over');

        // Remove previous token from this gap if exists
        if (this._placements.has(gapId)) {
            const oldTokenId = this._placements.get(gapId);
            this._returnTokenToArea(oldTokenId);
        }

        // Place new token in gap
        this._placements.set(gapId, this._draggedToken);
        const tokenEl = this._tokenEls.get(this._draggedToken);

        if (tokenEl) {
            // Remove from tokens area
            if (tokenEl.parentNode === this._tokensArea) {
                this._tokensArea.removeChild(tokenEl);
            }

            // Clear previous parent gap if token was in another gap
            for (const [otherGapId, placedTokenId] of this._placements.entries()) {
                if (otherGapId !== gapId && placedTokenId === this._draggedToken) {
                    this._placements.delete(otherGapId);
                    const otherGap = this._gapEls.get(otherGapId);
                    if (otherGap) {
                        otherGap.classList.remove('filled');
                        otherGap.innerHTML = '';
                    }
                }
            }

            // Add to gap
            gap.appendChild(tokenEl);
            gap.classList.add('filled');
            tokenEl.style.opacity = '1';

            // Apply "connected" style (blue)
            tokenEl.style.background = 'var(--pz-selected-bg)';
            tokenEl.style.borderColor = 'var(--pz-selected-border)';
            tokenEl.classList.remove('correct', 'wrong', 'is-correct', 'is-wrong');
        }

        if (DBG()) {
            console.debug('[PZ.cloze] dropped:', {gapId, tokenId: this._draggedToken});
        }
    }

    _onGapClick(gapId) {
        // Allow clicking on filled gap to return token to area
        if (!this._placements.has(gapId)) return;

        const tokenId = this._placements.get(gapId);
        this._returnTokenToArea(tokenId);
        this._placements.delete(gapId);

        const gap = this._gapEls.get(gapId);
        if (gap) {
            gap.classList.remove('filled');
            gap.innerHTML = '';
        }

        if (DBG()) {
            console.debug('[PZ.cloze] gap clicked, token returned:', {gapId, tokenId});
        }
    }

    _onAreaDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }

    _onAreaDrop(e) {
        e.preventDefault();
        if (!this._draggedToken) return;

        // Return token to area
        this._returnTokenToArea(this._draggedToken);

        // Remove from any gap
        for (const [gapId, tokenId] of this._placements.entries()) {
            if (tokenId === this._draggedToken) {
                this._placements.delete(gapId);
                const gap = this._gapEls.get(gapId);
                if (gap) {
                    gap.classList.remove('filled');
                    gap.innerHTML = '';
                }
            }
        }

        if (DBG()) {
            console.debug('[PZ.cloze] token returned to area:', this._draggedToken);
        }
    }

    /**
     * Return token element back to tokens area.
     */
    _returnTokenToArea(tokenId) {
        const tokenEl = this._tokenEls.get(tokenId);
        if (!tokenEl || !this._tokensArea) return;

        // Remove from current parent
        if (tokenEl.parentNode) {
            tokenEl.parentNode.removeChild(tokenEl);
        }

        // Reset styles
        tokenEl.style.background = '';
        tokenEl.style.borderColor = '';
        tokenEl.style.opacity = '1';
        tokenEl.classList.remove('correct', 'wrong', 'is-correct', 'is-wrong');

        // Add back to tokens area
        this._tokensArea.appendChild(tokenEl);
    }

    // ========================================================================
    // EVALUATION
    // ========================================================================

    onOk() {
        const solution = this.config.solution || {};
        let allCorrect = true;
        const correctGaps = new Set();

        // Evaluate each placement
        for (const [gapId, tokenId] of this._placements.entries()) {
            const expectedTokenId = String(solution[gapId] || '');
            const isCorrect = (tokenId === expectedTokenId);

            if (isCorrect) {
                correctGaps.add(gapId);
            } else {
                allCorrect = false;
            }

            // Visual feedback (unless aggregateOnly)
            if (!this.instanceOptions.aggregateOnly) {
                const tokenEl = this._tokenEls.get(tokenId);
                if (tokenEl) {
                    tokenEl.classList.remove('correct', 'wrong', 'is-correct', 'is-wrong');

                    if (isCorrect) {
                        tokenEl.classList.add('correct', 'is-correct');
                        tokenEl.style.background = 'var(--pz-correct-bg)';
                        tokenEl.style.borderColor = 'var(--pz-correct-border)';
                    } else {
                        tokenEl.classList.add('wrong', 'is-wrong');
                        tokenEl.style.background = 'var(--pz-wrong-bg)';
                        tokenEl.style.borderColor = 'var(--pz-wrong-border)';
                    }
                }
            }
        }

        // Check for missing placements
        for (const gapId of Object.keys(solution)) {
            if (!this._placements.has(gapId)) {
                allCorrect = false;
            }
        }

        // blockUntilSolved - return wrong tokens to area
        if (!allCorrect && this.instanceOptions.blockUntilSolved) {
            setTimeout(() => {
                const wrongPlacements = [];
                for (const [gapId, tokenId] of this._placements.entries()) {
                    if (!correctGaps.has(gapId)) {
                        wrongPlacements.push({gapId, tokenId});
                    }
                }

                wrongPlacements.forEach(({gapId, tokenId}) => {
                    this._returnTokenToArea(tokenId);
                    this._placements.delete(gapId);

                    const gap = this._gapEls.get(gapId);
                    if (gap) {
                        gap.classList.remove('filled');
                        gap.innerHTML = '';
                    }
                });

                if (DBG()) {
                    console.debug('[PZ.cloze] blockUntilSolved - wrong tokens returned:', wrongPlacements.length);
                }
            }, 800);

            return {hold: true};
        }

        if (DBG()) {
            console.debug('[PZ.cloze] onOk result:', {
                allCorrect, placements: Object.fromEntries(this._placements)
            });
        }

        return {
            ok: allCorrect, detail: {
                placements: Object.fromEntries(this._placements)
            }
        };
    }
}
