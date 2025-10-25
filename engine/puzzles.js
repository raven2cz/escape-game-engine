// engine/puzzles.js
// Puzzles that are i18n-aware via game._text() and engine modal labels.

import { normalizeText } from './utils.js';

export async function openPhraseModal(game, opts) {
  const wrap = document.createElement('div');

  const p = document.createElement('p');
  p.textContent = game._text(opts.prompt, 'Zadej frázi (heslo):');

  const input = document.createElement('input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.placeholder = opts.placeholder || '...';
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') game._closeModal(true); });

  wrap.appendChild(p); wrap.appendChild(input);
  setTimeout(() => input.focus(), 50);

  const ok = await game.openModal({
    title: game._text(opts.title, 'Puzzle'),
    body: wrap,
    okLabel: game._t('engine.modal.ok', 'OK'),
    cancelLabel: game._t('engine.modal.cancel', 'Zavřít')
  });

  if (!ok) return false;
  const typed = normalizeText(input.value), sol = normalizeText(opts.solution || '');
  return typed === sol;
}

export async function openCodeModal(game, opts) {
  const wrap = document.createElement('div');

  const p = document.createElement('p');
  p.textContent = game._text(opts.prompt, 'Zadej kód:');

  const input = document.createElement('input');
  input.type = opts.mask === 'password' ? 'password' : 'text';
  input.autocomplete = 'off';
  input.placeholder = opts.placeholder || '....';
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') game._closeModal(true); });

  wrap.appendChild(p); wrap.appendChild(input);
  setTimeout(() => input.focus(), 50);

  const ok = await game.openModal({
    title: game._text(opts.title, 'Zámek'),
    body: wrap,
    okLabel: game._t('engine.modal.ok', 'OK'),
    cancelLabel: game._t('engine.modal.cancel', 'Zavřít')
  });

  if (!ok) return false;
  const typed = normalizeText(input.value), sol = normalizeText(opts.solution || '');
  return typed === sol;
}

export async function openOrderModal(game, opts) {
  const tokens = (opts.tokens || []).slice();
  if (!tokens.length) throw new Error('Order puzzle missing tokens');

  const solution = (opts.solution || tokens).map(normalizeText);
  const shuffled = tokens.slice().sort(() => Math.random() - 0.5);
  const chosen = [];

  const wrap = document.createElement('div');

  const p = document.createElement('p');
  p.textContent = game._text(opts.prompt, 'Tapni na pořadí:');
  wrap.appendChild(p);

  const pool = document.createElement('div');
  pool.style.display = 'flex'; pool.style.flexWrap = 'wrap';
  pool.style.gap = '6px'; pool.style.margin = '8px 0';

  const out = document.createElement('div');
  out.style.display = 'flex'; out.style.flexWrap = 'wrap';
  out.style.gap = '6px'; out.style.margin = '8px 0'; out.style.minHeight = '36px';

  function btn(label) {
    const b = document.createElement('button');
    b.textContent = typeof label === 'string' ? label : (label?.text || '');
    b.style.padding = '8px 12px';
    b.style.borderRadius = '12px';
    b.style.border = '1px solid #3a3a47';
    b.style.background = 'rgba(0,0,0,.35)';
    b.style.backdropFilter = 'blur(6px)';
    b.style.color = '#fff';
    b.style.cursor = 'pointer';
    b.style.minHeight = '44px';
    return b;
  }

  function render() {
    pool.innerHTML = ''; out.innerHTML = '';
    shuffled.forEach((t, idx) => {
      if (chosen.includes(idx)) return;
      const label = t?.text || t?.image || t;
      const b = btn(label);
      b.addEventListener('click', () => { chosen.push(idx); render(); });
      pool.appendChild(b);
    });
    chosen.forEach((idx, pos) => {
      const label = shuffled[idx]?.text || shuffled[idx]?.image || shuffled[idx];
      const b = btn(label);
      b.addEventListener('click', () => { chosen.splice(pos, 1); render(); });
      out.appendChild(b);
    });
  }
  render();

  const lab1 = document.createElement('div'); lab1.textContent = 'Dostupné:';
  const lab2 = document.createElement('div'); lab2.textContent = 'Tvoje pořadí:';
  wrap.appendChild(lab1); wrap.appendChild(pool);
  wrap.appendChild(lab2); wrap.appendChild(out);

  const ok = await game.openModal({
    title: game._text(opts.title, 'Pořadí'),
    body: wrap,
    okLabel: game._t('engine.modal.ok', 'OK'),
    cancelLabel: game._t('engine.modal.cancel', 'Zavřít')
  });

  if (!ok) return false;
  if (chosen.length !== shuffled.length) return false;

  const user = chosen.map(i => normalizeText(shuffled[i]?.text || shuffled[i]));
  return user.every((v, i) => v === solution[i]);
}

export async function openMatchModal(game, opts) {
  const pairs = (opts.pairs || []);
  if (!pairs.length) throw new Error('Match puzzle missing pairs');

  const left = pairs.map(p => p[0]), right = pairs.map(p => p[1]);
  const idxL = left.map((_, i) => i).sort(() => Math.random() - 0.5);
  const idxR = right.map((_, i) => i).sort(() => Math.random() - 0.5);

  const matched = new Set(); let selL = null, selR = null;

  const wrap = document.createElement('div');

  const p = document.createElement('p');
  p.textContent = game._text(opts.prompt, 'Spáruj dvojice:');
  wrap.appendChild(p);

  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = '1fr 1fr';
  grid.style.gap = '8px';

  function btn(label) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.padding = '8px 12px';
    b.style.borderRadius = '12px';
    b.style.border = '1px solid #3a3a47';
    b.style.background = 'rgba(0,0,0,.35)';
    b.style.backdropFilter = 'blur(6px)';
    b.style.color = '#fff';
    b.style.cursor = 'pointer';
    b.style.minHeight = '44px';
    return b;
  }

  const leftCol = document.createElement('div'); const rightCol = document.createElement('div');

  function render() {
    leftCol.innerHTML = ''; rightCol.innerHTML = '';

    idxL.forEach(i => {
      const b = btn(left[i]);
      const key = 'L' + i;
      if (matched.has(key)) { b.style.opacity = '0.5'; b.disabled = true; }
      if (selL === i) b.style.outline = '2px solid #1e90ff';
      b.addEventListener('click', () => { selL = (selL === i ? null : i); tryMatch(); render(); });
      leftCol.appendChild(b);
    });

    idxR.forEach(j => {
      const b = btn(right[j]);
      const key = 'R' + j;
      if (matched.has(key)) { b.style.opacity = '0.5'; b.disabled = true; }
      if (selR === j) b.style.outline = '2px solid #1e90ff';
      b.addEventListener('click', () => { selR = (selR === j ? null : j); tryMatch(); render(); });
      rightCol.appendChild(b);
    });
  }

  function tryMatch() {
    if (selL == null || selR == null) return;
    const labelL = left[selL], labelR = right[selR];
    const ok = pairs.some(([l, r]) => normalizeText(l) === normalizeText(labelL) && normalizeText(r) === normalizeText(labelR));
    if (ok) { matched.add('L' + selL); matched.add('R' + selR); }
    selL = selR = null;
  }

  const labL = document.createElement('div'); labL.textContent = 'Levá'; wrap.appendChild(labL);
  const labR = document.createElement('div'); labR.textContent = 'Pravá'; wrap.appendChild(labR);
  grid.appendChild(leftCol); grid.appendChild(rightCol);
  wrap.appendChild(grid);
  render();

  const ok = await game.openModal({
    title: game._text(opts.title, 'Přiřazení'),
    body: wrap,
    okLabel: game._t('engine.modal.ok', 'OK'),
    cancelLabel: game._t('engine.modal.cancel', 'Zavřít')
  });

  if (!ok) return false;
  return matched.size === pairs.length * 2;
}
