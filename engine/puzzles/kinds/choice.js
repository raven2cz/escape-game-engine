// engine/puzzles/kinds/choice.js
// Kind: choice – text + selectable value (dropdown or editable input)

import { BasePuzzle } from '../base.js';

const DBG = () => (typeof window !== 'undefined' && /\bdebug=1\b/.test(window.location.search));

export default class ChoicePuzzle extends BasePuzzle {
    constructor(args) {
        super(args);
        this._valueMap = new Map(); // tokenId -> selected value
        this._rows = new Map(); // tokenId -> DOM row element
    }

    mount(container, workRect, backgroundUrl) {
        super.mount?.(container, workRect, backgroundUrl);
        const flow = this.flowEl;
        this.root?.classList.add('pz-kind-choice');

        // List container for choice rows
        const list = document.createElement('div');
        list.className = 'pz-choice-list';
        Object.assign(list.style, {
            flex: '1 1 auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--pz-token-gap)',
            overflowY: 'auto'
        });

        // Create choice rows
        (this.config.tokens || []).forEach((t, i) => {
            const id = String(t.id ?? i);
            const row = this._makeRow(t, id);
            list.appendChild(row);
            this._rows.set(id, row);
        });

        // Insert list BEFORE footer
        const footer = flow.querySelector('.pz-footer');
        if (footer) {
            flow.insertBefore(list, footer);
        } else {
            flow.appendChild(list);
        }

        if (DBG()) {
            console.debug('[PZ.choice] mounted', { rowCount: this.config.tokens?.length || 0 });
        }
    }

    _makeRow(token, id) {
        const row = document.createElement('div');
        row.className = 'pz-choice-row';
        row.setAttribute('data-id', id);
        Object.assign(row.style, {
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: 'var(--pz-token-gap)',
            alignItems: 'center'
        });

        // Text label (left side) - can be hidden via style.visible
        const textEl = document.createElement('div');
        textEl.className = 'pz-choice-text';
        textEl.textContent = this.t(token.label || token.text || '', '');

        const textStyle = {
            ...(this.config.theme?.text || {}),
            ...(token.textStyle || {})
        };
        this.applyStyle(textEl, textStyle);

        row.appendChild(textEl);

        // Choice control (right side) - dropdown or editable input
        const controlWrap = document.createElement('div');
        controlWrap.className = 'pz-choice-control';
        controlWrap.style.position = 'relative';

        const choices = token.choices || [];
        const editable = token.editable || (choices.length === 0);

        if (editable) {
            // Editable input
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'pz-input pz-choice-input';
            input.placeholder = this.t(token.placeholder || '', '');
            input.addEventListener('input', () => {
                this._valueMap.set(id, input.value);
            });

            const inputStyle = {
                minWidth: '120px',
                ...(this.config.theme?.input || {}),
                ...(token.style || {})
            };
            this.applyStyle(input, inputStyle);

            controlWrap.appendChild(input);
        } else {
            // Dropdown (token-styled button + menu)
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'pz-token pz-choice-button';
            btn.textContent = this.t(token.placeholder || '@engine.select@Vyberte…', 'Vyberte…');

            const btnStyle = {
                minWidth: '120px',
                cursor: 'pointer',
                ...(this.config.theme?.token || {}),
                ...(token.style || {})
            };
            this.applyStyle(btn, btnStyle);

            // Dropdown menu
            const menu = document.createElement('div');
            menu.className = 'pz-dropdown';
            Object.assign(menu.style, {
                position: 'absolute',
                top: 'calc(100% + 4px)',
                right: '0', // Right-align with button
                minWidth: '160px',
                maxWidth: '300px',
                maxHeight: '200px',
                overflowY: 'auto',
                background: 'rgba(17, 17, 20, 0.95)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: 'var(--pz-token-radius)',
                padding: '4px',
                display: 'none',
                zIndex: '100',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)'
            });

            choices.forEach(opt => {
                const optBtn = document.createElement('button');
                optBtn.type = 'button';
                optBtn.className = 'pz-token pz-choice-option';
                optBtn.textContent = this.t(opt.label || String(opt.value), String(opt.value));
                optBtn.style.width = '100%';
                optBtn.style.marginBottom = '2px';

                optBtn.addEventListener('click', () => {
                    const val = String(opt.value ?? opt.label ?? '');
                    this._valueMap.set(id, val);
                    btn.textContent = this.t(opt.label || val, val);
                    menu.style.display = 'none';
                });

                menu.appendChild(optBtn);
            });

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = menu.style.display === 'block';
                // Close all other dropdowns
                document.querySelectorAll('.pz-dropdown').forEach(m => m.style.display = 'none');
                menu.style.display = isOpen ? 'none' : 'block';
            });

            // Close on outside click
            document.addEventListener('click', () => {
                menu.style.display = 'none';
            });

            controlWrap.appendChild(btn);
            controlWrap.appendChild(menu);
        }

        row.appendChild(controlWrap);
        return row;
    }

    _solutions() {
        // Expected: solutions: { [tokenId]: "value", ... }
        // IMPORTANT: Translate solution values (may have @key@fallback format)
        const raw = this.config.solutions || {};
        const translated = {};

        for (const [id, val] of Object.entries(raw)) {
            translated[id] = this.t(val, val);
        }

        // FALLBACK: Check individual tokens for 'solution' property
        if (Object.keys(translated).length === 0) {
            (this.config.tokens || []).forEach((t, i) => {
                const id = String(t.id ?? i);
                if (t.solution !== undefined) {
                    translated[id] = this.t(t.solution, t.solution);
                }
            });
        }

        if (DBG()) {
            console.debug('[PZ.choice] solutions translated:', { raw, translated });
        }

        return translated;
    }

    onOk() {
        const sol = this._solutions();
        let allOk = true;

        for (const [id, row] of this._rows.entries()) {
            const got = String(this._valueMap.get(id) ?? '');
            const expect = String(sol[id] ?? '');
            const good = (got === expect);

            if (!this.instanceOptions.aggregateOnly) {
                row.classList.remove('correct', 'wrong', 'is-correct', 'is-wrong');
                row.classList.add(good ? 'correct' : 'wrong', good ? 'is-correct' : 'is-wrong');
            }

            if (!good) allOk = false;
        }

        if (!allOk && this.instanceOptions.blockUntilSolved) {
            return { hold: true };
        }

        const detail = {};
        for (const [id, val] of this._valueMap.entries()) {
            detail[id] = val;
        }

        if (DBG()) {
            console.debug('[PZ.choice] onOk result:', { allOk, values: detail, solutions: sol });
        }

        return {
            ok: allOk,
            detail: { values: detail }
        };
    }
}
