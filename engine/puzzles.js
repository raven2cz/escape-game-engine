// engine/puzzles.js
// Puzzles with i18n via game._text/_t and optional graphic backgrounds.
// Tokens/pairs can be strings or objects: { text?, key?, image?, matchKey? }

import { normalizeText } from './utils.js';

// ---- Helpers ---------------------------------------------------------------

function tokenLabel(game, t) {
    // Returns a { type: 'text'|'image', text?, src?, alt?, keyForMatch? }
    if (t && typeof t === 'object') {
        const text = t.key ? game._t(String(t.key), t.text || '') : (t.text || '');
        const alt = text || t.alt || '';
        const src = t.image || null;
        const keyForMatch = t.matchKey || t.key || text || '';
        if (src) return { type: 'image', src, alt, keyForMatch };
        return { type: 'text', text, keyForMatch };
    }
    const text = String(t ?? '');
    return { type: 'text', text, keyForMatch: text };
}

function normKey(v) {
    return normalizeText(String(v || ''));
}

function applyBackgroundWrap(wrap, opts) {
    if (!opts?.background) return wrap;
    const out = document.createElement('div');
    out.style.position = 'relative';
    out.style.minHeight = '40vh';

    const bg = document.createElement('div');
    bg.style.position = 'absolute';
    bg.style.inset = '0';
    bg.style.background = `center / cover no-repeat url("${opts.background}")`;
    bg.style.borderRadius = '14px';
    bg.style.opacity = '0.9';

    const fg = document.createElement('div');
    fg.style.position = 'relative';
    fg.style.padding = '12px';
    fg.style.display = 'grid';
    fg.style.gap = '10px';

    fg.appendChild(wrap);
    out.appendChild(bg);
    out.appendChild(fg);
    return out;
}

function pillButtonBase() {
    const b = document.createElement('button');
    b.style.padding = '10px 14px';
    b.style.borderRadius = '14px';
    b.style.border = '1px solid #3a3a47';
    b.style.background = 'rgba(0,0,0,.35)';
    b.style.backdropFilter = 'blur(6px)';
    b.style.color = '#fff';
    b.style.cursor = 'pointer';
    b.style.minHeight = '44px';
    b.style.display = 'inline-flex';
    b.style.alignItems = 'center';
    b.style.gap = '8px';
    return b;
}

function tokenButton(game, t) {
    const meta = tokenLabel(game, t);
    const b = pillButtonBase();
    if (meta.type === 'image') {
        const img = document.createElement('img');
        img.src = meta.src;
        img.alt = meta.alt || '';
        img.style.width = '48px';
        img.style.height = '48px';
        img.style.objectFit = 'contain';
        b.appendChild(img);
        if (meta.alt) {
            const cap = document.createElement('span');
            cap.textContent = meta.alt;
            b.appendChild(cap);
        }
    } else {
        b.textContent = meta.text || '';
    }
    b.__matchKey = meta.keyForMatch; // keep for comparisons
    return b;
}

// ---- Phrase ---------------------------------------------------------------

export async function openPhraseModal(game, opts) {
    const inner = document.createElement('div');

    const p = document.createElement('p');
    p.textContent = game._text(opts.prompt, 'Zadej frázi (heslo):');

    const input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.placeholder = opts.placeholder || '...';
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') game._closeModal(true); });

    inner.appendChild(p);
    inner.appendChild(input);

    const body = applyBackgroundWrap(inner, opts);
    setTimeout(() => input.focus(), 50);

    const ok = await game.openModal({
        title: game._text(opts.title, 'Puzzle'),
        body,
        okLabel: game._t('engine.modal.ok', 'OK'),
        cancelLabel: game._t('engine.modal.cancel', 'Zavřít')
    });

    if (!ok) return false;
    const typed = normalizeText(input.value), sol = normalizeText(opts.solution || '');
    return typed === sol;
}

// ---- Code -----------------------------------------------------------------

export async function openCodeModal(game, opts) {
    const inner = document.createElement('div');

    const p = document.createElement('p');
    p.textContent = game._text(opts.prompt, 'Zadej kód:');

    const input = document.createElement('input');
    input.type = opts.mask === 'password' ? 'password' : 'text';
    input.autocomplete = 'off';
    input.placeholder = opts.placeholder || '....';
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') game._closeModal(true); });

    inner.appendChild(p);
    inner.appendChild(input);

    const body = applyBackgroundWrap(inner, opts);
    setTimeout(() => input.focus(), 50);

    const ok = await game.openModal({
        title: game._text(opts.title, 'Zámek'),
        body,
        okLabel: game._t('engine.modal.ok', 'OK'),
        cancelLabel: game._t('engine.modal.cancel', 'Zavřít')
    });

    if (!ok) return false;
    const typed = normalizeText(input.value), sol = normalizeText(opts.solution || '');
    return typed === sol;
}

// ---- Order ----------------------------------------------------------------

export async function openOrderModal(game, opts) {
    const tokens = (opts.tokens || []).slice();
    if (!tokens.length) throw new Error('Order puzzle missing tokens');

    // Solution keys: allow objects; prefer matchKey/key/text → normalized
    const solution = (opts.solution || tokens).map(t => {
        const meta = tokenLabel(game, t);
        return normKey(meta.keyForMatch);
    });

    // Shuffle pool (by index for stability)
    const indices = tokens.map((_, i) => i).sort(() => Math.random() - 0.5);
    const chosen = [];

    const inner = document.createElement('div');

    const p = document.createElement('p');
    p.textContent = game._text(opts.prompt, 'Tapni na pořadí:');
    inner.appendChild(p);

    const pool = document.createElement('div');
    pool.style.display = 'flex';
    pool.style.flexWrap = 'wrap';
    pool.style.gap = '8px';
    pool.style.margin = '8px 0';

    const out = document.createElement('div');
    out.style.display = 'flex';
    out.style.flexWrap = 'wrap';
    out.style.gap = '8px';
    out.style.margin = '8px 0';
    out.style.minHeight = '48px';

    function render() {
        pool.innerHTML = '';
        out.innerHTML = '';

        indices.forEach((idx) => {
            if (chosen.includes(idx)) return;
            const b = tokenButton(game, tokens[idx]);
            b.addEventListener('click', () => { chosen.push(idx); render(); });
            pool.appendChild(b);
        });

        chosen.forEach((idx, pos) => {
            const b = tokenButton(game, tokens[idx]);
            b.addEventListener('click', () => { chosen.splice(pos, 1); render(); });
            out.appendChild(b);
        });
    }
    render();

    const lab1 = document.createElement('div'); lab1.textContent = game._text(opts.availableLabel, 'Dostupné:');
    const lab2 = document.createElement('div'); lab2.textContent = game._text(opts.yourOrderLabel, 'Tvoje pořadí:');
    inner.appendChild(lab1); inner.appendChild(pool);
    inner.appendChild(lab2); inner.appendChild(out);

    const body = applyBackgroundWrap(inner, opts);

    const ok = await game.openModal({
        title: game._text(opts.title, 'Pořadí'),
        body,
        okLabel: game._t('engine.modal.ok', 'OK'),
        cancelLabel: game._t('engine.modal.cancel', 'Zavřít')
    });

    if (!ok) return false;
    if (chosen.length !== tokens.length) return false;

    const user = chosen.map(i => {
        const b = tokenButton(game, tokens[i]);
        return normKey(b.__matchKey);
    });

    return user.every((v, i) => v === solution[i]);
}

// ---- Match ----------------------------------------------------------------

export async function openMatchModal(game, opts) {
    const pairs = (opts.pairs || []);
    if (!pairs.length) throw new Error('Match puzzle missing pairs');

    // Build left/right arrays and shuffle by index
    const left = pairs.map(p => p[0]);
    const right = pairs.map(p => p[1]);
    const idxL = left.map((_, i) => i).sort(() => Math.random() - 0.5);
    const idxR = right.map((_, i) => i).sort(() => Math.random() - 0.5);

    const matched = new Set(); // 'L<i>' | 'R<j>'
    let selL = null, selR = null;

    const inner = document.createElement('div');

    const p = document.createElement('p');
    p.textContent = game._text(opts.prompt, 'Spáruj dvojice:');
    inner.appendChild(p);

    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = '1fr 1fr';
    grid.style.gap = '10px';

    const leftCol = document.createElement('div');
    const rightCol = document.createElement('div');

    function render() {
        leftCol.innerHTML = '';
        rightCol.innerHTML = '';

        idxL.forEach(i => {
            const b = tokenButton(game, left[i]);
            const key = 'L' + i;
            if (matched.has(key)) { b.style.opacity = '0.55'; b.disabled = true; }
            if (selL === i) b.style.outline = '2px solid #1e90ff';
            b.addEventListener('click', () => { selL = (selL === i ? null : i); tryMatch(); render(); });
            leftCol.appendChild(b);
        });

        idxR.forEach(j => {
            const b = tokenButton(game, right[j]);
            const key = 'R' + j;
            if (matched.has(key)) { b.style.opacity = '0.55'; b.disabled = true; }
            if (selR === j) b.style.outline = '2px solid #1e90ff';
            b.addEventListener('click', () => { selR = (selR === j ? null : j); tryMatch(); render(); });
            rightCol.appendChild(b);
        });
    }

    function tryMatch() {
        if (selL == null || selR == null) return;

        const keyL = normKey(tokenLabel(game, left[selL]).keyForMatch);
        const keyR = normKey(tokenLabel(game, right[selR]).keyForMatch);

        const ok = pairs.some(([l, r]) => {
            const lk = normKey(tokenLabel(game, l).keyForMatch);
            const rk = normKey(tokenLabel(game, r).keyForMatch);
            return lk === keyL && rk === keyR;
        });

        if (ok) {
            matched.add('L' + selL);
            matched.add('R' + selR);
        }
        selL = selR = null;
    }

    const labL = document.createElement('div'); labL.textContent = game._text(opts.leftLabel, 'Levá');
    const labR = document.createElement('div'); labR.textContent = game._text(opts.rightLabel, 'Pravá');

    inner.appendChild(labL);
    inner.appendChild(labR);
    grid.appendChild(leftCol);
    grid.appendChild(rightCol);
    inner.appendChild(grid);

    render();

    const body = applyBackgroundWrap(inner, opts);

    const ok = await game.openModal({
        title: game._text(opts.title, 'Přiřazení'),
        body,
        okLabel: game._t('engine.modal.ok', 'OK'),
        cancelLabel: game._t('engine.modal.cancel', 'Zavřít')
    });

    if (!ok) return false;
    return matched.size === pairs.length * 2;
}
