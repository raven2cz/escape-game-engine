// board/board-view.js
//
// Draws a summarize() result. Everything is built with textContent, never
// innerHTML: team names and labels come from reports, and a report is input.

import {formatDuration} from './board-model.js';

const h = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = String(text);
    return el;
};

const CELL = {
    first: {symbol: '✓', title: 'vyřešeno napoprvé'},
    after: {symbol: '✓', title: 'vyřešeno po chybách'},
    open: {symbol: '…', title: 'rozpracováno'},
    none: {symbol: '·', title: 'zatím nedotčeno'},
};
const CONNECTION = {ok: 'připojeno', stale: 'dlouho bez zprávy', offline: 'odpojeno'};
const ITEM = {none: 'nemá', has: 'má', used: 'použil'};

function clock(ms) {
    return new Date(ms).toLocaleTimeString('cs-CZ', {hour: '2-digit', minute: '2-digit'});
}

function summaryBar(model) {
    const s = model.summary;
    const bar = h('div', 'board-summary');
    bar.append(
        h('span', 'board-pill', `Týmů: ${s.teams}`),
        h('span', 'board-pill board-pill--done', `Dohráno: ${s.completed}`),
        h('span', `board-pill${s.stuck ? ' board-pill--warn' : ''}`, `Možná zaseklí: ${s.stuck}`),
        h('span', `board-pill${s.offline ? ' board-pill--off' : ''}`, `Odpojeno: ${s.offline}`),
    );
    if (!model.catalogueReady) bar.append(h('span', 'board-pill board-pill--off', 'Seznam úloh se načítá'));
    return bar;
}

function teamsTable(model) {
    const table = h('table', 'board-teams');
    const head = h('tr');
    const cols = ['Tým', 'Místnost', 'V místnosti', 'Úlohy', 'Chyby', 'Právě řeší'];
    if (model.show.milestones) cols.push('Milníky');
    cols.push('Spojení', 'Stav');
    cols.forEach(c => head.append(h('th', null, c)));
    const thead = h('thead');
    thead.append(head);
    table.append(thead);
    const body = h('tbody');
    table.append(body);

    for (const t of model.teams) {
        const tr = h('tr', [
            'board-team',
            t.stuck ? 'is-stuck' : '',
            t.completed ? 'is-done' : '',
            `is-${t.connection}`,
        ].filter(Boolean).join(' '));
        tr.dataset.team = t.key;

        const name = h('td', 'board-team-name', t.team);
        if (t.newerApi) name.append(h('span', 'board-note', ' (novější verze hry, zobrazeno jen základní)'));
        tr.append(name);
        tr.append(h('td', null, t.sceneLabel ?? '?'));

        const stay = h('td', 'board-stay', t.completed ? '' : formatDuration(t.sceneForMs));
        if (t.stuck) stay.append(h('span', 'board-flag', ' možná zaseklí'));
        tr.append(stay);

        const tasks = h('td', 'board-progress');
        tasks.append(h('span', null, t.total != null ? `${t.solved} / ${t.total}` : `${t.solved} / ?`));
        if (t.total) {
            const meter = h('span', 'board-meter');
            const fill = h('span', 'board-meter-fill');
            fill.style.width = `${Math.round((t.solved / t.total) * 100)}%`;
            meter.append(fill);
            tasks.append(meter);
        }
        tr.append(tasks);
        tr.append(h('td', 'board-mistakes', t.mistakes));
        tr.append(h('td', 'board-activity', t.activity ? `${t.activity.label} (${formatDuration(t.activity.forMs)})` : ''));

        if (model.show.milestones) {
            const ms = h('td', 'board-milestones');
            for (const m of t.milestones) {
                const chip = h('span', `board-chip${m.reached ? ' is-reached' : ''}`, m.label);
                chip.title = m.reached ? 'splněno' : 'zatím ne';
                ms.append(chip);
            }
            tr.append(ms);
        }

        const conn = h('td', `board-connection is-${t.connection}`, CONNECTION[t.connection]);
        conn.title = `poslední zpráva před ${formatDuration(t.lastSeenMs)}`;
        tr.append(conn);
        tr.append(h('td', 'board-state',
            t.completed ? `Dohráno v ${clock(t.completedAt)} (${formatDuration(t.playedMs)})` : `Hraje ${formatDuration(t.playedMs)}`));
        body.append(tr);
    }
    if (!model.teams.length) {
        const tr = h('tr');
        const td = h('td', 'board-empty', 'Zatím se nepřipojil žádný tým.');
        td.colSpan = cols.length;
        tr.append(td);
        body.append(tr);
    }
    return table;
}

function taskGrid(model) {
    const wrap = h('section', 'board-section');
    wrap.append(h('h2', null, 'Úlohy a týmy'));
    const table = h('table', 'board-grid');
    const head = h('tr');
    head.append(h('th', null, 'Úloha'));
    model.teams.forEach(t => head.append(h('th', null, t.team)));
    head.append(h('th', null, 'Chybovalo týmů'));
    const thead = h('thead');
    thead.append(head);
    table.append(thead);
    const body = h('tbody');
    for (const row of model.grid) {
        const tr = h('tr');
        tr.dataset.task = row.id;
        tr.append(h('th', 'board-task', row.label));
        row.cells.forEach(c => {
            const td = h('td', `board-cell is-${c.state}`,
                c.state === 'after' || (c.state === 'open' && c.mistakes) ? `${CELL[c.state].symbol}${c.mistakes}` : CELL[c.state].symbol);
            td.title = c.mistakes ? `${CELL[c.state].title}, chyb: ${c.mistakes}` : CELL[c.state].title;
            tr.append(td);
        });
        tr.append(h('td', `board-hard${row.withMistakes && row.withMistakes >= model.teams.length / 2 ? ' is-hard' : ''}`,
            row.withMistakes));
        body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    const legend = h('p', 'board-legend');
    legend.append(
        h('span', 'board-cell is-first', '✓'), h('span', null, ' napoprvé   '),
        h('span', 'board-cell is-after', '✓2'), h('span', null, ' po chybách   '),
        h('span', 'board-cell is-open', '…'), h('span', null, ' rozpracováno   '),
        h('span', 'board-cell is-none', '·'), h('span', null, ' nedotčeno'),
    );
    wrap.append(legend);
    return wrap;
}

function itemsTable(model) {
    const wrap = h('section', 'board-section');
    wrap.append(h('h2', null, 'Předměty'));
    const table = h('table', 'board-items');
    const head = h('tr');
    head.append(h('th', null, 'Tým'));
    (model.teams[0]?.items || []).forEach(it => head.append(h('th', null, it.label)));
    const thead = h('thead');
    thead.append(head);
    table.append(thead);
    const body = h('tbody');
    for (const t of model.teams) {
        const tr = h('tr');
        tr.append(h('th', null, t.team));
        t.items.forEach(it => tr.append(h('td', `board-item is-${it.state}`, ITEM[it.state])));
        body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    return wrap;
}

/** Replace the contents of `root` with the board for `model`. */
export function renderBoard(root, model) {
    const frag = document.createDocumentFragment();
    frag.append(summaryBar(model), teamsTable(model));
    if (model.grid.length) frag.append(taskGrid(model));
    if (model.show.items && model.teams.length) frag.append(itemsTable(model));
    root.replaceChildren(frag);
}
