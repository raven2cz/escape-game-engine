// engine/puzzles/kinds/code.js
// Kind: code – password-style input with strong fail feedback

import { BasePuzzle } from '../base.js';
import { normalizeText } from '../../utils.js';

const DBG = () => (typeof window !== 'undefined' && /\bdebug=1\b/.test(window.location.search));

export default class CodePuzzle extends BasePuzzle {
    constructor(args) {
        super(args);
        this._els = {};
        this._locked = false;
    }

    mount(container, workRect, backgroundUrl) {
        super.mount?.(container, workRect, backgroundUrl);
        const flow = this.flowEl;
        this.root?.classList.add('pz-kind-code');

        // Input wrapper (centered vertically like phrase)
        const inputWrap = document.createElement('div');
        inputWrap.className = 'pz-input-wrap';

        const input = document.createElement('input');
        input.setAttribute('data-id','input');
        input.className = 'pz-input';
        input.type = 'password'; // KEY: password type for code
        const placeholderText = this.t(this.config.placeholder, '******');
        input.placeholder = placeholderText;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter')  { e.preventDefault(); this.onOk(); }
            if (e.key === 'Escape') { e.preventDefault(); this.onCancel(); }
        });

        if (DBG()) {
            console.debug('[PZ.code] placeholder:', {
                raw: this.config.placeholder,
                translated: placeholderText
            });
        }

        inputWrap.appendChild(input);

        // Insert input BEFORE footer
        const footer = flow.querySelector('.pz-footer');
        if (footer) {
            flow.insertBefore(inputWrap, footer);
        } else {
            flow.appendChild(inputWrap);
        }

        this._els.input = input;
        setTimeout(() => input.focus(), 0);
    }

    _isCorrect(val) {
        const target = this.config.solution || this.config.solutions || '';
        const typed = normalizeText(val);
        const pool = Array.isArray(target) ? target : [target];

        const result = pool.some(s => {
            const resolved = this.t(s, s);
            return normalizeText(resolved) === typed;
        });

        if (DBG()) {
            console.debug('[PZ.code] validation:', {
                typed,
                solutions: pool.map(s => normalizeText(this.t(s, s))),
                result
            });
        }

        return result;
    }

    onOk() {
        if (this._locked) return { hold: true };

        const v = this._els.input?.value || '';
        const ok = this._isCorrect(v);

        if (!ok) {
            // Code: always show strong fail feedback
            this._els.input.classList.add('invalid');
            setTimeout(() => this._els.input.classList.remove('invalid'), 700);
        }

        if (!ok && this.instanceOptions.blockUntilSolved) {
            return { hold: true };
        }

        return { ok, detail: { value: v } };
    }
}
