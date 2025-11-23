// engine/puzzles/kinds/cloze.js
// Kind: cloze – doplňovačka
// FIX 5: Ignorování 'click' eventu bezprostředně po 'drop' eventu.

import {BasePuzzle} from '../base.js';

const DBG = () => (typeof window !== 'undefined' && /\bdebug=1\b/.test(window.location.search));

export default class ClozePuzzle extends BasePuzzle {
    constructor(args) {
        super(args);
        this._tokenEls = new Map();
        this._gapEls = new Map();
        this._placements = new Map();
        this._tokensArea = null;

        // Drag state
        this._dragState = {
            active: false,
            tokenId: null,
            originalEl: null,
            ghostEl: null,
            startX: 0,
            startY: 0,
            offsetX: 0,
            offsetY: 0,
            hoveredGapId: null
        };

        // Flag to prevent 'click' triggering immediately after drop
        this._ignoreNextClick = false;

        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);
    }

    mount(container, workRect, backgroundUrl) {
        super.mount?.(container, workRect, backgroundUrl);
        const flow = this.flowEl;
        this.root?.classList.add('pz-kind-cloze');

        const layoutCfg = this.instanceOptions.layout || this.config.layout || {};
        const direction = layoutCfg.direction || 'vertical';

        const clozeContainer = document.createElement('div');
        clozeContainer.className = 'pz-cloze-container';
        Object.assign(clozeContainer.style, {
            flex: '1 1 auto',
            display: 'flex',
            flexDirection: direction === 'horizontal' ? 'row' : 'column',
            gap: 'calc(var(--pz-token-gap) * 2)',
            minHeight: '0',
            position: 'relative',
            touchAction: 'none'
        });

        const textArea = this._createTextArea();
        clozeContainer.appendChild(textArea);

        const tokensArea = this._createTokensArea();
        this._tokensArea = tokensArea;
        clozeContainer.appendChild(tokensArea);

        const footer = flow.querySelector('.pz-footer');
        if (footer) {
            flow.insertBefore(clozeContainer, footer);
        } else {
            flow.appendChild(clozeContainer);
        }
    }

    _createTextArea() {
        const area = document.createElement('div');
        area.className = 'pz-cloze-text-area';
        const text = this.t(this.config.text || '', '');
        const parts = text.split(/(\{gap\d+})/g);

        parts.forEach(part => {
            if (/^\{gap\d+}$/.test(part)) {
                const gapId = part.slice(1, -1);
                const gap = this._createGap(gapId);
                area.appendChild(gap);
                this._gapEls.set(gapId, gap);
            } else if (part.trim()) {
                const textSpan = document.createElement('span');
                textSpan.textContent = part;
                textSpan.style.whiteSpace = 'pre-wrap';
                area.appendChild(textSpan);
            }
        });
        return area;
    }

    _createGap(gapId) {
        const gap = document.createElement('span');
        gap.className = 'pz-cloze-gap';
        gap.setAttribute('data-gap-id', gapId);

        // Click to return token to bank
        gap.addEventListener('click', (e) => {
            // FIX: Pokud jsme právě dokončili drag&drop, tento klik ignorujeme
            if (this._ignoreNextClick) {
                if (DBG()) console.debug('[CLOZE] Click ignored (just dropped)');
                this._ignoreNextClick = false;
                return;
            }

            if (this._placements.has(gapId)) {
                this._returnTokenToArea(this._placements.get(gapId));
                this._placements.delete(gapId);
                gap.classList.remove('filled');
                gap.innerHTML = '';
                if (DBG()) console.debug('[CLOZE] Token removed by click:', gapId);
            }
        });
        return gap;
    }

    _createTokensArea() {
        const area = document.createElement('div');
        area.className = 'pz-cloze-tokens-area';
        const tokens = [...(this.config.tokens || [])];

        for (let i = tokens.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [tokens[i], tokens[j]] = [tokens[j], tokens[i]];
        }

        tokens.forEach(t => {
            const id = String(t.id);
            const el = this.createToken(t);
            el.setAttribute('data-token-id', id);
            this._enablePointerDrag(el, id);
            this._tokenEls.set(id, el);
            area.appendChild(el);
        });

        return area;
    }

    // ========================================================================
    // POINTER EVENTS
    // ========================================================================

    _enablePointerDrag(el, tokenId) {
        el.style.touchAction = 'none';
        el.style.userSelect = 'none';
        el.style.cursor = 'grab';

        el.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            this._startDrag(e, el, tokenId);
        });
    }

    _startDrag(e, el, tokenId) {
        if (this._dragState.active) return;
        if (DBG()) console.log('[CLOZE-DEBUG] Start Drag:', tokenId);

        const rect = el.getBoundingClientRect();
        const computed = window.getComputedStyle(el);

        this._dragState = {
            active: true,
            tokenId: tokenId,
            originalEl: el,
            ghostEl: null,
            startX: e.clientX,
            startY: e.clientY,
            offsetX: e.clientX - rect.left,
            offsetY: e.clientY - rect.top,
            hoveredGapId: null
        };

        const ghost = el.cloneNode(true);
        ghost.className = 'pz-token pz-cloze-ghost';
        ghost.style.borderRadius = computed.borderRadius;
        ghost.style.backgroundColor = computed.backgroundColor;
        ghost.style.border = computed.border;
        ghost.style.color = computed.color;
        ghost.style.fontFamily = computed.fontFamily;
        ghost.style.fontSize = computed.fontSize;
        ghost.style.padding = computed.padding;
        ghost.style.boxSizing = 'border-box';
        ghost.style.margin = '0';

        Object.assign(ghost.style, {
            position: 'fixed',
            left: (rect.left) + 'px',
            top: (rect.top) + 'px',
            width: rect.width + 'px',
            height: rect.height + 'px',
            zIndex: '9999',
            pointerEvents: 'none',
            opacity: '0.95',
            transform: 'scale(1.05)',
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
            textAlign: computed.textAlign,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
        });

        document.body.appendChild(ghost);
        this._dragState.ghostEl = ghost;

        el.style.opacity = '0.3';
        el.classList.add('dragging');

        document.addEventListener('pointermove', this._onPointerMove);
        document.addEventListener('pointerup', this._onPointerUp);
        document.addEventListener('pointercancel', this._onPointerUp);
    }

    _onPointerMove(e) {
        if (!this._dragState.active || !this._dragState.ghostEl) return;
        e.preventDefault();

        const x = e.clientX - this._dragState.offsetX;
        const y = e.clientY - this._dragState.offsetY;
        this._dragState.ghostEl.style.left = x + 'px';
        this._dragState.ghostEl.style.top = y + 'px';

        this._updateHoveredGap(e.clientX, e.clientY);
    }

    _updateHoveredGap(x, y) {
        this._gapEls.forEach(gap => gap.classList.remove('drag-over'));

        const elements = document.elementsFromPoint(x, y);
        let foundGapId = null;

        for (const el of elements) {
            const gap = el.closest('.pz-cloze-gap');
            if (gap) {
                foundGapId = gap.getAttribute('data-gap-id');
                break;
            }
        }

        if (foundGapId) {
            this._dragState.hoveredGapId = foundGapId;
            const gap = this._gapEls.get(foundGapId);
            if (gap) gap.classList.add('drag-over');
        }
    }

    _onPointerUp(e) {
        if (!this._dragState.active) return;

        document.removeEventListener('pointermove', this._onPointerMove);
        document.removeEventListener('pointerup', this._onPointerUp);
        document.removeEventListener('pointercancel', this._onPointerUp);

        if (DBG()) console.log('[CLOZE-DEBUG] PointerUp');

        // 1. Hide ghost first
        if (this._dragState.ghostEl) {
            this._dragState.ghostEl.style.display = 'none';
        }

        // 2. Detect target (Live check)
        let targetGapId = null;
        const freshElements = document.elementsFromPoint(e.clientX, e.clientY);
        for (const el of freshElements) {
            const gap = el.closest('.pz-cloze-gap');
            if (gap) {
                targetGapId = gap.getAttribute('data-gap-id');
                break;
            }
        }

        // 3. Fallback to cache
        if (!targetGapId && this._dragState.hoveredGapId) {
            targetGapId = this._dragState.hoveredGapId;
        }

        if (targetGapId) {
            this._dropIntoGap(targetGapId);
        } else {
            this._returnToBank();
        }

        // Cleanup
        if (this._dragState.ghostEl) this._dragState.ghostEl.remove();
        if (this._dragState.originalEl) {
            this._dragState.originalEl.style.opacity = '1';
            this._dragState.originalEl.classList.remove('dragging');
            this._dragState.originalEl.style.cursor = 'grab';
        }

        this._gapEls.forEach(g => g.classList.remove('drag-over'));
        this._dragState = { active: false, tokenId: null, originalEl: null, ghostEl: null, hoveredGapId: null };
    }

    _dropIntoGap(gapId) {
        if (DBG()) console.log('[CLOZE-DEBUG] Dropping into:', gapId);

        const tokenId = this._dragState.tokenId;
        const gap = this._gapEls.get(gapId);

        if (!gap) return;

        // Set flag to ignore the immediate subsequent click event
        this._ignoreNextClick = true;
        // Reset flag safely after short delay (browser click fires typically within ~10-50ms)
        setTimeout(() => {
            this._ignoreNextClick = false;
        }, 100);

        if (this._placements.has(gapId)) {
            const existingTokenId = this._placements.get(gapId);
            if (existingTokenId !== tokenId) {
                this._returnTokenToArea(existingTokenId);
            }
        }

        for (const [otherGap, placedToken] of this._placements.entries()) {
            if (placedToken === tokenId && otherGap !== gapId) {
                this._placements.delete(otherGap);
                const oldGapEl = this._gapEls.get(otherGap);
                if (oldGapEl) {
                    oldGapEl.classList.remove('filled');
                    oldGapEl.innerHTML = '';
                }
            }
        }

        this._placements.set(gapId, tokenId);

        const tokenEl = this._dragState.originalEl;
        if (tokenEl.parentNode === this._tokensArea) {
            this._tokensArea.removeChild(tokenEl);
        }

        gap.innerHTML = '';
        gap.appendChild(tokenEl);
        gap.classList.add('filled');
        gap.classList.remove('drag-over');

        tokenEl.style.background = 'var(--pz-selected-bg)';
        tokenEl.style.borderColor = 'var(--pz-selected-border)';
        tokenEl.classList.remove('correct', 'wrong', 'is-correct', 'is-wrong');
    }

    _returnToBank() {
        const tokenId = this._dragState.tokenId;
        for (const [gapId, placedToken] of this._placements.entries()) {
            if (placedToken === tokenId) {
                this._placements.delete(gapId);
                const gap = this._gapEls.get(gapId);
                if (gap) {
                    gap.classList.remove('filled');
                    gap.innerHTML = '';
                }
            }
        }
        this._returnTokenToArea(tokenId);
    }

    _returnTokenToArea(tokenId) {
        const tokenEl = this._tokenEls.get(tokenId);
        if (!tokenEl || !this._tokensArea) return;

        tokenEl.style.background = '';
        tokenEl.style.borderColor = '';
        tokenEl.classList.remove('correct', 'wrong', 'is-correct', 'is-wrong');
        this._tokensArea.appendChild(tokenEl);
    }

    onOk() {
        const solution = this.config.solution || {};
        let allCorrect = true;
        const correctGaps = new Set();

        for (const [gapId, tokenId] of this._placements.entries()) {
            const expectedTokenId = String(solution[gapId] || '');
            const isCorrect = (tokenId === expectedTokenId);

            if (isCorrect) correctGaps.add(gapId);
            else allCorrect = false;

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

        for (const gapId of Object.keys(solution)) {
            if (!this._placements.has(gapId)) allCorrect = false;
        }

        if (!allCorrect && this.instanceOptions.blockUntilSolved) {
            setTimeout(() => {
                const wrongPlacements = [];
                for (const [gapId, tokenId] of this._placements.entries()) {
                    if (!correctGaps.has(gapId)) wrongPlacements.push({gapId, tokenId});
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
            }, 800);
            return {hold: true};
        }

        return { ok: allCorrect, detail: { placements: Object.fromEntries(this._placements) } };
    }
}
