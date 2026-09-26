// board/board-view.js
//
// Draws a summarize() result. Built for a class of up to thirty or so players
// at once: one compact row per player, the per-task picture as a strip of cells
// inside that row, and the class-wide view per task underneath.
//
// Everything is built with textContent, never innerHTML: player names and
// labels come from reports, and a report is input.

import {formatDuration} from './board-model.js';

const h = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = String(text);
    return el;
};

const CELL = {
    first: 'vyřešeno napoprvé',
    after: 'vyřešeno po chybách',
    open: 'rozpracováno',
    none: 'zatím nezačato',
};
const CONNECTION = {ok: 'připojeno', stale: 'dlouho bez zprávy', offline: 'odpojeno'};
const ITEM = {none: {symbol: '·', title: 'nemá'}, has: {symbol: '●', title: 'má'}, used: {symbol: '✓', title: 'použil'}};

function clock(ms) {
    return new Date(ms).toLocaleTimeString('cs-CZ', {hour: '2-digit', minute: '2-digit'});
}

function avatar(av, name) {
    if (av.src) {
        const el = h('span', 'board-avatar board-avatar--img');
        const img = document.createElement('img');
        img.src = av.src;
        img.alt = '';
        el.append(img);
        el.setAttribute('aria-hidden', 'true');
        el.title = `${name} (${av.label})`;
        return el;
    }
    const el = h('span', 'board-avatar', av.initials);
    el.style.setProperty('--hue', String(av.hue));
    el.setAttribute('aria-hidden', 'true');
    el.title = name;
    return el;
}

function summaryBar(model) {
    const s = model.summary;
    const bar = h('div', 'board-summary');
    bar.append(
        h('span', 'board-pill', `Hráčů: ${s.players}`),
        h('span', 'board-pill board-pill--done', `Dohráno: ${s.completed}`),
        h('span', `board-pill${s.stuck ? ' board-pill--warn' : ''}`, `Možná zaseklí: ${s.stuck}`),
        h('span', `board-pill${s.offline ? ' board-pill--off' : ''}`, `Odpojeno: ${s.offline}`),
    );
    if (!model.catalogueReady) bar.append(h('span', 'board-pill board-pill--off', 'Seznam úloh se načítá'));
    return bar;
}

function attentionStrip(model) {
    const wrap = h('section', 'board-attention');
    wrap.append(h('h2', null, 'Potřebují pozornost'));
    const list = h('div', 'board-attention-list');
    for (const a of model.attention) {
        const card = h('div', `board-card is-${a.reason}`);
        card.dataset.player = a.key;
        card.append(avatar(a.avatar, a.name));
        const text = h('div', 'board-card-text');
        text.append(h('strong', null, a.name));
        text.append(h('span', null, a.reason === 'stuck'
            ? `${a.place ?? '?'}, ${formatDuration(a.forMs)}, chyb: ${a.mistakes}`
            : `odpojeno ${formatDuration(a.forMs)}${a.place ? `, naposledy: ${a.place}` : ''}`));
        card.append(text);
        list.append(card);
    }
    wrap.append(list);
    return wrap;
}

function strip(player) {
    const el = h('span', 'board-strip');
    player.cells.forEach((c, i) => {
        const cell = h('span', `board-cell is-${c.state}`, c.mistakes && c.state !== 'first' ? c.mistakes : '');
        cell.title = `${i + 1}. ${c.label}: ${CELL[c.state]}${c.mistakes ? `, chyb: ${c.mistakes}` : ''}`;
        el.append(cell);
    });
    return el;
}

function playersTable(model) {
    const table = h('table', 'board-players');
    const head = h('tr');
    const cols = ['Hráč', 'Místnost', 'V místnosti', 'Úlohy', 'Průběh úloh', 'Chyby', 'Právě řeší'];
    if (model.show.milestones) cols.push('Milníky');
    cols.push('Stav');
    cols.forEach(c => head.append(h('th', null, c)));
    const thead = h('thead');
    thead.append(head);
    table.append(thead);
    const body = h('tbody');
    table.append(body);

    for (const t of model.players) {
        const tr = h('tr', [
            'board-player',
            t.stuck ? 'is-stuck' : '',
            t.completed ? 'is-done' : '',
            `is-${t.connection}`,
        ].filter(Boolean).join(' '));
        tr.dataset.player = t.key;

        const who = h('td', 'board-who');
        who.append(avatar(t.avatar, t.name));
        const dot = h('span', `board-conn is-${t.connection}`);
        dot.title = `${CONNECTION[t.connection]}, poslední zpráva před ${formatDuration(t.lastSeenMs)}`;
        who.append(h('span', 'board-player-name', t.name), dot);
        if (t.newerApi) who.append(h('span', 'board-note', ' (novější verze hry)'));
        tr.append(who);

        tr.append(h('td', 'board-room', t.sceneLabel ?? '?'));
        const stay = h('td', 'board-stay', t.completed ? '' : formatDuration(t.sceneForMs));
        if (t.stuck) stay.append(h('span', 'board-flag', ' zasekl se?'));
        tr.append(stay);

        const tasks = h('td', 'board-progress');
        tasks.append(h('span', 'board-count', t.total != null ? `${t.solved}/${t.total}` : `${t.solved}/?`));
        if (t.total) {
            const meter = h('span', 'board-meter');
            const fill = h('span', 'board-meter-fill');
            fill.style.width = `${Math.round((t.solved / t.total) * 100)}%`;
            meter.append(fill);
            tasks.append(meter);
        }
        tr.append(tasks);

        const stripCell = h('td');
        stripCell.append(strip(t));
        tr.append(stripCell);

        tr.append(h('td', `board-mistakes${t.mistakes ? ' has-mistakes' : ''}`, t.mistakes));
        tr.append(h('td', 'board-activity', t.activity ? `${t.activity.label} (${formatDuration(t.activity.forMs)})` : ''));

        if (model.show.milestones) {
            const ms = h('td', 'board-milestones');
            for (const m of t.milestones) {
                const d = h('span', `board-dot${m.reached ? ' is-reached' : ''}`);
                d.title = `${m.label}: ${m.reached ? 'splněno' : 'zatím ne'}`;
                ms.append(d);
            }
            ms.append(h('span', 'board-ms-count', `${t.milestones.filter(m => m.reached).length}/${t.milestones.length}`));
            tr.append(ms);
        }

        tr.append(h('td', 'board-state',
            t.completed ? `Dohráno ${clock(t.completedAt)} (${formatDuration(t.playedMs)})` : `Hraje ${formatDuration(t.playedMs)}`));
        body.append(tr);
    }
    if (!model.players.length) {
        const tr = h('tr');
        const td = h('td', 'board-empty', 'Zatím se nepřipojil žádný hráč.');
        td.colSpan = cols.length;
        tr.append(td);
        body.append(tr);
    }
    return table;
}

function legend() {
    const p = h('p', 'board-legend');
    for (const [state, text] of Object.entries(CELL)) {
        p.append(h('span', `board-cell is-${state}`, state === 'after' ? '2' : ''), h('span', null, ` ${text}   `));
    }
    p.append(h('span', null, 'Najeďte myší na políčko pro název úlohy.'));
    return p;
}

function taskTable(model) {
    const wrap = h('section', 'board-section');
    wrap.append(h('h2', null, 'Úlohy ve třídě'));
    const table = h('table', 'board-tasks');
    const head = h('tr');
    ['#', 'Úloha', 'Vyřešilo', 'Zkoušelo', 'Chybovalo'].forEach(c => head.append(h('th', null, c)));
    const thead = h('thead');
    thead.append(head);
    table.append(thead);
    const body = h('tbody');
    const n = model.players.length;
    model.taskSummary.forEach((row, i) => {
        const tr = h('tr', row.hard ? 'is-hard' : '');
        tr.dataset.task = row.id;
        tr.append(h('td', 'board-num', i + 1), h('td', 'board-task', row.label));
        const solved = h('td', 'board-solved');
        solved.append(h('span', null, `${row.solvedBy}/${n}`));
        const meter = h('span', 'board-meter');
        const fill = h('span', 'board-meter-fill');
        fill.style.width = n ? `${Math.round((row.solvedBy / n) * 100)}%` : '0%';
        meter.append(fill);
        solved.append(meter);
        tr.append(solved, h('td', null, row.touchedBy), h('td', 'board-hard', row.hard ? `${row.withMistakes}, obtížná` : row.withMistakes));
        body.append(tr);
    });
    table.append(body);
    wrap.append(table);
    return wrap;
}

function itemsTable(model) {
    const wrap = h('section', 'board-section');
    wrap.append(h('h2', null, 'Předměty'));
    const table = h('table', 'board-items');
    const head = h('tr');
    head.append(h('th', null, 'Hráč'));
    (model.players[0]?.items || []).forEach(it => head.append(h('th', null, it.label)));
    const thead = h('thead');
    thead.append(head);
    table.append(thead);
    const body = h('tbody');
    for (const t of model.players) {
        const tr = h('tr');
        const who = h('th', 'board-who');
        who.append(avatar(t.avatar, t.name), h('span', 'board-player-name', t.name));
        tr.append(who);
        t.items.forEach(it => {
            const td = h('td', `board-item is-${it.state}`, ITEM[it.state].symbol);
            td.title = `${it.label}: ${ITEM[it.state].title}`;
            tr.append(td);
        });
        body.append(tr);
    }
    table.append(body);
    wrap.append(table, h('p', 'board-legend', '● má   ✓ použil   · nemá'));
    return wrap;
}

/** Replace the contents of `root` with the board for `model`. */
export function renderBoard(root, model) {
    const frag = document.createDocumentFragment();
    frag.append(summaryBar(model));
    if (model.attention.length) frag.append(attentionStrip(model));
    frag.append(playersTable(model));
    if (model.tasks.length) frag.append(legend(), taskTable(model));
    if (model.show.items && model.players.length) frag.append(itemsTable(model));
    root.replaceChildren(frag);
}
