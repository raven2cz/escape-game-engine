// engine/puzzles/kinds/order.js
// Kind: order â€“ click tokens to move from shuffled â†’ ordered; verify final sequence

import { BasePuzzle } from '../base.js';

const DBG = () => (typeof window !== 'undefined' && /\bdebug=1\b/.test(window.location.search));

export default class OrderPuzzle extends BasePuzzle {
    constructor(args) {
        super(args);
        this._tokenEls = new Map();
        this._ordered = [];
        this._shuffledIds = [];
    }

    mount(container, workRect, backgroundUrl) {
        super.mount?.(container, workRect, backgroundUrl);
        const flow = this.flowEl;
        this.root?.classList.add('pz-kind-order');

        // Container for two areas: shuffled + ordered
        const container2 = document.createElement('div');
        container2.className = 'pz-order-container';

        const layoutCfg = this.instanceOptions.layout || this.config.layout || {};
        const dir = layoutCfg.direction || 'vertical';

        // Grid layout: vertical = 2 columns, horizontal = 2 rows
        Object.assign(container2.style, {
            flex: '1 1 auto',
            display: 'grid',
            gap: 'var(--pz-token-gap)',
            gridTemplateColumns: dir === 'horizontal' ? '1fr' : '1fr 1fr',
            gridTemplateRows: dir === 'horizontal' ? '1fr 1fr' : '1fr'
        });

        // Shuffled area
        const shuffledArea = document.createElement('div');
        shuffledArea.className = 'pz-area pz-area-shuffled';
        Object.assign(shuffledArea.style, {
            display: 'flex',
            flexDirection: dir === 'horizontal' ? 'row' : 'column',
            flexWrap: dir === 'horizontal' ? 'wrap' : 'nowrap',
            justifyContent: dir === 'horizontal' ? 'center' : 'flex-start',
            alignItems: dir === 'horizontal' ? 'center' : 'stretch',
            gap: 'var(--pz-token-gap)',
            padding: '1vh 1vw',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: 'var(--pz-token-radius)',
            background: 'rgba(255, 255, 255, 0.03)'
        });

        // Ordered area
        const orderedArea = document.createElement('div');
        orderedArea.className = 'pz-area pz-area-ordered';
        Object.assign(orderedArea.style, {
            display: 'flex',
            flexDirection: dir === 'horizontal' ? 'row' : 'column',
            flexWrap: dir === 'horizontal' ? 'wrap' : 'nowrap',
            justifyContent: dir === 'horizontal' ? 'center' : 'flex-start',
            alignItems: dir === 'horizontal' ? 'center' : 'stretch',
            gap: 'var(--pz-token-gap)',
            padding: '1vh 1vw',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: 'var(--pz-token-radius)',
            background: 'rgba(255, 255, 255, 0.03)'
        });

        container2.appendChild(shuffledArea);
        container2.appendChild(orderedArea);

        // Create and shuffle tokens
        const tokens = (this.config.tokens || []).map((t, idx) => ({
            id: String(t.id ?? idx),
            ...t
        }));

        this._shuffledIds = this._shuffle(tokens.map(t => t.id));

        this._shuffledIds.forEach(id => {
            const token = tokens.find(t => t.id === id);
            if (!token) return;

            const el = this.createToken(token);
            el.addEventListener('click', () => this._togglePlacement(id));

            shuffledArea.appendChild(el);
            this._tokenEls.set(id, el);
        });

        this._shuffledArea = shuffledArea;
        this._orderedArea = orderedArea;

        // Insert container BEFORE footer
        const footer = flow.querySelector('.pz-footer');
        if (footer) {
            flow.insertBefore(container2, footer);
        } else {
            flow.appendChild(container2);
        }

        if (DBG()) {
            console.debug('[PZ.order] mounted', {
                tokenCount: tokens.length,
                shuffled: this._shuffledIds,
                direction: dir
            });
        }
    }

    _togglePlacement(id) {
        const inOrdered = this._ordered.includes(id);
        const el = this._tokenEls.get(id);
        if (!el) return;

        if (inOrdered) {
            // Move back to shuffled
            this._ordered = this._ordered.filter(x => x !== id);
            this._shuffledArea.appendChild(el);
        } else {
            // Move to ordered (append at end)
            this._ordered.push(id);
            this._orderedArea.appendChild(el);
        }

        this._clearMarks();

        if (DBG()) {
            console.debug('[PZ.order] toggle:', { id, ordered: this._ordered });
        }
    }

    _solution() {
        // Prefer explicit array
        if (Array.isArray(this.config.solution)) {
            return this.config.solution.map(String);
        }
        if (Array.isArray(this.config.solutionIds)) {
            return this.config.solutionIds.map(String);
        }
        // Fallback: order equals tokens order in config
        return (this.config.tokens || []).map((t, idx) => String(t.id ?? idx));
    }

    _markCorrectness(showHints = false) {
        const want = this._solution();
        const got = this._ordered;
        const n = Math.max(want.length, got.length);

        for (let i = 0; i < n; i++) {
            const id = got[i];
            const el = id ? this._tokenEls.get(id) : null;
            if (!el) continue;

            el.classList.remove('correct', 'wrong', 'hint', 'is-correct', 'is-wrong', 'is-hint');

            if (want[i] === id) {
                el.classList.add('correct', 'is-correct');
            } else {
                el.classList.add('wrong', 'is-wrong');
            }
        }

        if (showHints) {
            // Tokens not placed but needed â†’ gentle hint
            const missing = new Set(want.filter(id => !got.includes(id)));
            for (const id of missing) {
                const el = this._tokenEls.get(id);
                if (el) el.classList.add('hint', 'is-hint');
            }
        }

        if (DBG()) {
            console.debug('[PZ.order] marked correctness:', { got, want, showHints });
        }
    }

    _clearMarks() {
        for (const el of this._tokenEls.values()) {
            el.classList.remove('correct', 'wrong', 'hint', 'is-correct', 'is-wrong', 'is-hint');
        }
    }

    onOk() {
        const want = this._solution();
        const ok = (want.length === this._ordered.length) &&
            want.every((id, i) => this._ordered[i] === id);

        if (!this.instanceOptions.aggregateOnly) {
            this._markCorrectness(true);
        }

        if (!ok && this.instanceOptions.blockUntilSolved) {
            return { hold: true };
        }

        if (DBG()) {
            console.debug('[PZ.order] onOk result:', { ok, ordered: this._ordered, solution: want });
        }

        return {
            ok,
            detail: {
                orderedIds: [...this._ordered],
                solution: want
            }
        };
    }

    _shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }
}