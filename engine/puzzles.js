// engine/puzzles.js
function normalizeText(s) { return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }

export async function openPhraseModal(game, opts) {
  const wrap = document.createElement('div');
  const p = document.createElement('p');
  p.textContent = opts.prompt || 'Zadej větu (heslo):';
  const input = document.createElement('input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.placeholder = opts.placeholder || '...';
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') game._closeModal(true); });
  wrap.appendChild(p);
  wrap.appendChild(input);
  setTimeout(() => input.focus(), 50);

  const ok = await game.openModal({
    title: opts.title || 'Hlavolam',
    body: wrap,
    okLabel: 'Odemknout',
    cancelLabel: 'Zrušit'
  });
  if (!ok) return false;

  const typed = normalizeText(input.value);
  const sol = normalizeText(opts.solution || '');
  return typed === sol;
}

export async function openCodeModal(game, opts) {
  const wrap = document.createElement('div');
  const p = document.createElement('p');
  p.textContent = opts.prompt || 'Zadej kód:';
  const input = document.createElement('input');
  input.type = opts.mask === 'password' ? 'password' : 'text';
  input.autocomplete = 'off';
  input.placeholder = opts.placeholder || '....';
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') game._closeModal(true); });
  wrap.appendChild(p);
  wrap.appendChild(input);
  setTimeout(() => input.focus(), 50);

  const ok = await game.openModal({
    title: opts.title || 'Zámek',
    body: wrap,
    okLabel: 'Ověřit',
    cancelLabel: 'Zrušit'
  });
  if (!ok) return false;

  const typed = normalizeText(input.value);
  const sol = normalizeText(opts.solution || '');
  return typed === sol;
}

export async function openOrderModal(game, opts) {
  const tokens = (opts.tokens || []).slice();
  if (!tokens.length) throw new Error('Chybí položky pro hlavolam s pořadím.');

  const solution = (opts.solution || tokens).map(normalizeText);
  const shuffled = tokens.slice().sort(() => Math.random() - 0.5);
  const chosen = [];

  const wrap = document.createElement('div');
  const p = document.createElement('p');
  p.textContent = opts.prompt || 'Klepni na kartičky a sestav správné pořadí:';

  const pool = document.createElement('div');
  pool.style.display = 'flex';
  pool.style.flexWrap = 'wrap';
  pool.style.gap = '6px';
  pool.style.margin = '8px 0';

  const out = document.createElement('div');
  out.style.display = 'flex';
  out.style.flexWrap = 'wrap';
  out.style.gap = '6px';
  out.style.margin = '8px 0';
  out.style.minHeight = '36px';

  function btn(label) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.padding = '6px 10px';
    b.style.borderRadius = '8px';
    b.style.border = '1px solid #3a3a47';
    b.style.background = '#22232a';
    b.style.color = '#fff';
    b.style.cursor = 'pointer';
    return b;
  }

  function render() {
    pool.innerHTML = '';
    out.innerHTML = '';
    shuffled.forEach((t, idx) => {
      if (chosen.includes(idx)) return;
      const b = btn(t);
      b.addEventListener('click', () => { chosen.push(idx); render(); });
      pool.appendChild(b);
    });
    chosen.forEach((idx, pos) => {
      const b = btn(shuffled[idx]);
      b.addEventListener('click', () => { chosen.splice(pos, 1); render(); });
      out.appendChild(b);
    });
  }
  render();

  wrap.appendChild(p);
  const lab1 = document.createElement('div'); lab1.textContent = 'Dostupné:'; wrap.appendChild(lab1);
  wrap.appendChild(pool);
  const lab2 = document.createElement('div'); lab2.textContent = 'Tvé pořadí:'; wrap.appendChild(lab2);
  wrap.appendChild(out);

  const ok = await game.openModal({
    title: opts.title || 'Pořadí',
    body: wrap,
    okLabel: 'Ověřit',
    cancelLabel: 'Zrušit'
  });
  if (!ok) return false;
  if (chosen.length !== shuffled.length) return false;

  const user = chosen.map(i => normalizeText(shuffled[i]));
  return user.every((v, i) => v === solution[i]);
}

export async function openMatchModal(game, opts) {
  const pairs = (opts.pairs || []);
  if (!pairs.length) throw new Error('Chybí dvojice pro hlavolam párování.');

  const left = pairs.map(p => p[0]);
  const right = pairs.map(p => p[1]);
  const idxL = left.map((_, i) => i).sort(() => Math.random() - 0.5);
  const idxR = right.map((_, i) => i).sort(() => Math.random() - 0.5);

  const matched = new Set();
  let selL = null, selR = null;

  const wrap = document.createElement('div');
  const p = document.createElement('p');
  p.textContent = opts.prompt || 'Spáruj položky z levého sloupce s pravým:';

  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = '1fr 1fr';
  grid.style.gap = '8px';

  function btn(label) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.padding = '6px 10px';
    b.style.borderRadius = '8px';
    b.style.border = '1px solid #3a3a47';
    b.style.background = '#22232a';
    b.style.color = '#fff';
    b.style.cursor = 'pointer';
    return b;
  }

  const leftCol = document.createElement('div');
  const rightCol = document.createElement('div');

  function render() {
    leftCol.innerHTML = '';
    rightCol.innerHTML = '';

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

  wrap.appendChild(p);
  const labL = document.createElement('div'); labL.textContent = 'Levá strana'; wrap.appendChild(labL);
  const labR = document.createElement('div'); labR.textContent = 'Pravá strana'; wrap.appendChild(labR);

  grid.appendChild(leftCol);
  grid.appendChild(rightCol);
  wrap.appendChild(grid);
  render();

  const ok = await game.openModal({
    title: opts.title || 'Párování',
    body: wrap,
    okLabel: 'Ověřit',
    cancelLabel: 'Zrušit'
  });
  if (!ok) return false;

  return matched.size === pairs.length * 2;
}
