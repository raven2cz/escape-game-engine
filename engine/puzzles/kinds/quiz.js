// engine/puzzles/kinds/quiz.js
// Kind: quiz – selectable tokens (text/image), single/multi-select, auto coloring

import { BasePuzzle } from '../base.js';

const DBG = () => (typeof window !== 'undefined' && /\bdebug=1\b/.test(window.location.search));

export default class QuizPuzzle extends BasePuzzle {
    constructor(args) {
        super(args);
        this._tokenEls = new Map();
        this._selected = new Set();
        this._locked = false;
    }

    mount(container, workRect, backgroundUrl) {
        super.mount?.(container, workRect, backgroundUrl);
        const flow = this.flowEl;
        this.root?.classList.add('pz-kind-quiz');

        // Token area (auto layout respects config)
        const area = this.createTokenArea();

        // For horizontal layout, ensure wrapping
        const layoutCfg = this.instanceOptions.layout || this.config.layout || {};
        if (layoutCfg.direction === 'horizontal') {
            Object.assign(area.style, {
                display: 'flex',
                flexDirection: 'row',
                flexWrap: 'wrap', // IMPORTANT: wrap to next line
                gap: 'var(--pz-token-gap)',
                width: '100%'
            });
        }

        // Build tokens using base factory
        const tokens = this.config.tokens || [];
        tokens.forEach((t, idx) => {
            const id = String(t.id ?? idx);
            const el = this.createToken(t);
            el.addEventListener('click', () => this._toggleSelect(id));

            area.appendChild(el);
            this._tokenEls.set(id, el);
        });

        // Insert area BEFORE footer
        const footer = flow.querySelector('.pz-footer');
        if (footer) {
            flow.insertBefore(area, footer);
        } else {
            flow.appendChild(area);
        }

        if (DBG()) {
            console.debug('[PZ.quiz] mounted', {
                tokenCount: tokens.length,
                multiSelect: this.instanceOptions.multiSelect,
                direction: layoutCfg.direction
            });
        }
    }

    _toggleSelect(id) {
        if (this._locked) return;

        const multi = !!(this.instanceOptions.multiSelect || this.config.multiSelect);

        if (!multi) {
            // Single select: clear all others
            this._clearSelection();
        }

        const el = this._tokenEls.get(id);
        if (!el) return;

        if (this._selected.has(id)) {
            this._selected.delete(id);
            el.classList.remove('selected', 'is-selected');
        } else {
            this._selected.add(id);
            el.classList.add('selected', 'is-selected');
        }

        if (DBG()) {
            console.debug('[PZ.quiz] toggle:', { id, selected: Array.from(this._selected) });
        }
    }

    _clearSelection() {
        for (const id of Array.from(this._selected)) {
            this._tokenEls.get(id)?.classList.remove('selected', 'is-selected');
        }
        this._selected.clear();
    }

    _solutionIds() {
        // Prefer explicit solutionIds, fallback to tokens[].correct === true
        if (Array.isArray(this.config.solutionIds) && this.config.solutionIds.length) {
            return this.toIdSet(this.config.solutionIds);
        }
        if (Array.isArray(this.config.solutions) && this.config.solutions.length) {
            return this.toIdSet(this.config.solutions);
        }

        const s = new Set();
        (this.config.tokens || []).forEach((t, idx) => {
            const id = String(t.id ?? idx);
            if (t.correct) s.add(id);
        });
        return s;
    }

    _markCorrectness(showHints = false) {
        const sol = this._solutionIds();

        for (const [id, el] of this._tokenEls.entries()) {
            el.classList.remove('correct', 'wrong', 'hint', 'is-correct', 'is-wrong', 'is-hint');

            const isSel = this._selected.has(id);
            const isOk = sol.has(id);

            if (isSel && isOk) {
                el.classList.add('correct', 'is-correct');
            } else if (isSel && !isOk) {
                el.classList.add('wrong', 'is-wrong');
            } else if (!isSel && isOk && showHints) {
                el.classList.add('hint', 'is-hint');
            }
        }

        if (DBG()) {
            console.debug('[PZ.quiz] marked correctness:', {
                selected: Array.from(this._selected),
                solution: Array.from(sol),
                showHints
            });
        }
    }

    onOk() {
        if (this._locked) return { hold: true };

        const sol = this._solutionIds();
        const sel = this.toIdSet(Array.from(this._selected));
        const ok = (sel.size === sol.size) && [...sel].every(x => sol.has(x));

        const aggregateOnly = !!this.instanceOptions.aggregateOnly;

        if (!aggregateOnly) {
            // Show visual feedback
            this._markCorrectness(true);
        }

        if (!ok && this.instanceOptions.blockUntilSolved) {
            // Keep open; optional reset
            if (this.instanceOptions.resetOnFail !== false) {
                setTimeout(() => {
                    this._clearSelection();
                    this._markCorrectness(false);
                }, 300);
            }
            return { hold: true };
        }

        if (DBG()) {
            console.debug('[PZ.quiz] onOk result:', { ok, selected: Array.from(sel), solution: Array.from(sol) });
        }

        return {
            ok,
            detail: {
                selectedIds: Array.from(sel),
                solutionIds: Array.from(sol)
            }
        };
    }
}
