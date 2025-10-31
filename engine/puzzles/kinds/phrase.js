import { BasePuzzle } from '../base.js';
import { normalizeText } from '../../utils.js';

const DBG = () => (typeof window !== 'undefined' && /\bdebug=1\b/.test(window.location.search));

export default class PhrasePuzzle extends BasePuzzle {
    constructor(args) {
        super(args);
        this._els = {};
    }

    mount(container, workRect, backgroundUrl) {
        super.mount?.(container, workRect, backgroundUrl);
        const flow = this.flowEl;
        this.root?.classList.add('pz-kind-phrase');

        // Kontejner pro input (expanduje na plnou šířku, centruje vertikálně)
        const inputWrap = document.createElement('div');
        inputWrap.className = 'pz-input-wrap';

        const input = document.createElement('input');
        input.setAttribute('data-id','input');
        input.className = 'pz-input';
        input.type = 'text';
        const placeholderText = this.t(this.config.placeholder, '…');
        input.placeholder = placeholderText;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter')  { e.preventDefault(); this.onOk(); }
            if (e.key === 'Escape') { e.preventDefault(); this.onCancel(); }
        });

        if (DBG()) {
            console.debug('[PZ.phrase] placeholder:', {
                raw: this.config.placeholder,
                translated: placeholderText
            });
        }

        inputWrap.appendChild(input);

        // CRITICAL: Vložíme input PŘED footer (musí být na stejné řádce v horizontal mode)
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
        const pool = this.config.solutions ?? this.config.solution ?? '';
        const typed = normalizeText(val);
        const arr = Array.isArray(pool) ? pool : [pool];

        const result = arr.some(s => {
            const resolved = this.t(s, s);
            return normalizeText(resolved) === typed;
        });

        if (DBG()) {
            console.debug('[PZ.phrase] validation:', {
                typed,
                solutions: arr.map(s => normalizeText(this.t(s, s))),
                result
            });
        }

        return result;
    }

    onOk() {
        const v = this._els.input?.value || '';
        const ok = this._isCorrect(v);

        if (!ok && this.instanceOptions.blockUntilSolved) {
            this._els.input.classList.add('invalid');
            setTimeout(() => this._els.input.classList.remove('invalid'), 600);
            return { hold: true };
        }

        return { ok, detail: { value: v } };
    }
}