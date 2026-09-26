// EI-010: the teacher's board, built on the public API only, and the dev
// server's two dashboard endpoints.
//
// Reports here are produced the real way (project + toWire), so these tests
// also prove that the public contract carries everything the board needs.

import {describe, it, expect, beforeAll, afterAll, vi} from 'vitest';
import {join, resolve} from 'node:path';
import {buildCatalogue} from '../../engine/dashboard/catalogue.js';
import {project} from '../../engine/dashboard/projector.js';
import {toWire} from '../../engine/dashboard/report.js';
import {ReportStore, summarize, formatDuration, teamKey, avatarFor, BOARD_DEFAULTS} from '../../board/board-model.js';
import {renderBoard} from '../../board/board-view.js';
import {localSource, httpSource} from '../../board/sources.js';
import {localBoardKey} from '../../engine/dashboard/transports.js';
import {createDevServer, findGames, resolveRequest, MAX_REPORT_BYTES} from '../../scripts/dev-server.mjs';

const MIN = 60_000;
const NOW = 10_000_000;

const catalogue = buildCatalogue({
    meta: {id: 'g', dashboard: {milestones: [{id: 'door', label: 'Dveře', flag: 'door_open'}]}},
    items: [{id: 'key', label: 'Klíč'}, {id: 'lamp', label: 'Lampa'}],
    scenes: [
        {id: 'hall', title: 'Chodba', hotspots: [{type: 'puzzle', puzzleRef: 'p1', onSuccess: {setFlags: ['door_open']}}, {type: 'puzzle', puzzleRef: 'p2'}]},
        {id: 'lab', title: 'Laboratoř'},
        {id: 'exit', title: 'Východ', end: true},
    ],
}, {p1: {kind: 'phrase', title: 'První'}, p2: {kind: 'quiz', title: 'Druhá'}});

/** A real report for a team, built by the engine's own projector. */
function report({team, run = `run-${team}`, revision = 1, scene = 'hall', since = NOW - MIN, puzzles = {}, solved = {},
    flags = {}, inventory = [], itemsUsed = {}, completedAt = null, activity = null, startedAt = NOW - 10 * MIN, session = '7A', avatar = null}) {
    return toWire(project({
        state: {inventory, solved, flags, visited: {[scene]: true}, scene},
        progress: {run, revision, startedAt, scene, sceneEnteredAt: since, completedAt, puzzles, itemsUsed, dialogsSeen: {}},
        activity,
        catalogue,
        identity: {game: 'g', session, player: team, avatar},
        now: NOW,
        revision,
    }));
}

describe('ReportStore', () => {
    it('keeps the highest revision of a run, and ignores repeats and late arrivals', () => {
        const store = new ReportStore();
        expect(store.ingest(report({team: 'a', revision: 2}), 1)).toBe('accepted');
        expect(store.ingest(report({team: 'a', revision: 2}), 2)).toBe('stale');
        expect(store.ingest(report({team: 'a', revision: 1}), 3)).toBe('stale');
        expect(store.ingest(report({team: 'a', revision: 3}), 4)).toBe('accepted');
        expect(store.list()).toHaveLength(1);
        expect(store.list()[0].report.revision).toBe(3);
    });

    it('a restart (a later run) replaces the old one, an earlier run does not', () => {
        const store = new ReportStore();
        store.ingest(report({team: 'a', run: 'r1', revision: 9, startedAt: NOW - 20 * MIN}), 1);
        expect(store.ingest(report({team: 'a', run: 'r2', revision: 1, startedAt: NOW - MIN}), 2)).toBe('accepted');
        expect(store.ingest(report({team: 'a', run: 'r1', revision: 10, startedAt: NOW - 20 * MIN}), 3)).toBe('stale');
        expect(store.list()[0].report.run).toBe('r2');
    });

    it('refuses anything that is not a report, including one carrying extra fields', () => {
        const store = new ReportStore();
        expect(store.ingest(null, 1)).toBe('invalid');
        expect(store.ingest({hello: 'world'}, 1)).toBe('invalid');
        expect(store.ingest({...report({team: 'a'}), flags: {x: true}}, 1)).toBe('invalid');
    });

    it('keeps a report from a newer engine, marked and reduced to position, never verbatim', () => {
        const store = new ReportStore();
        const newer = {...report({team: 'a', puzzles: {p1: {seq: 1, attempts: 1, mistakes: 1, solved: false}}}),
            api: 99, somethingNew: 1, state: {flags: {secret: true}}};
        expect(store.ingest(newer, 1)).toBe('accepted');
        const kept = store.list()[0];
        expect(kept.newerApi).toBe(true);
        expect(JSON.stringify(kept.report)).not.toContain('secret');
        expect(kept.report).not.toHaveProperty('somethingNew');
        expect(kept.report.position.scene).toBe('hall');
        expect(kept.report.puzzles).toEqual([]);
    });

    it('files teams per lesson and game, and filters on both', () => {
        const store = new ReportStore();
        store.ingest(report({team: 'a', session: '7A'}), 1);
        store.ingest(report({team: 'a', session: '7B'}), 1);
        expect(store.list({game: 'g'})).toHaveLength(2);
        expect(store.list({game: 'g', session: '7B'})).toHaveLength(1);
        expect(store.list({game: 'other'})).toHaveLength(0);
        expect(teamKey({session: 'a|b', game: 'g', player: 'c'})).toBe('a%7Cb|g|c');
    });
});

describe('summarize', () => {
    const entries = (...reports) => reports.map(r => ({report: r, receivedAt: NOW - 5000}));

    it('a row per player: room, stay, progress, mistakes, open task, milestones, state', () => {
        const m = summarize(catalogue, entries(report({
            team: 'Anička', scene: 'lab', since: NOW - 3 * MIN,
            puzzles: {p1: {seq: 1, attempts: 3, mistakes: 2, solved: true}}, flags: {door_open: true},
            activity: {ref: 'p2', since: NOW - 30_000},
        })), {now: NOW});
        const t = m.players[0];
        expect(t).toMatchObject({
            name: 'Anička', sceneLabel: 'Laboratoř', sceneForMs: 3 * MIN, solved: 1, total: 2, mistakes: 2,
            activity: {ref: 'p2', label: 'Druhá', forMs: 30_000}, completed: false, connection: 'ok', stuck: false,
        });
        expect(t.milestones).toEqual([{id: 'door', label: 'Dveře', reached: true}]);
    });

    it('each player row carries a strip, one cell per task in game order', () => {
        const m = summarize(catalogue, entries(
            report({team: 'a', puzzles: {p1: {seq: 1, attempts: 1, mistakes: 0, solved: true}, p2: {seq: 2, attempts: 2, mistakes: 2, solved: false}}}),
            report({team: 'b', puzzles: {p1: {seq: 1, attempts: 4, mistakes: 3, solved: true}}}),
        ), {now: NOW});
        expect(m.players.map(t => t.cells.map(c => [c.task, c.state, c.mistakes]))).toEqual([
            [['p1', 'first', 0], ['p2', 'open', 2]],
            [['p1', 'after', 3], ['p2', 'none', 0]],
        ]);
    });

    it('per task across the class: solved by, tried by, with mistakes, and which are hard', () => {
        const m = summarize(catalogue, entries(
            report({team: 'a', puzzles: {p1: {seq: 1, attempts: 2, mistakes: 1, solved: true}}}),
            report({team: 'b', puzzles: {p1: {seq: 1, attempts: 4, mistakes: 3, solved: false}}}),
            report({team: 'c', puzzles: {p1: {seq: 1, attempts: 1, mistakes: 0, solved: true}}}),
        ), {now: NOW});
        expect(m.taskSummary).toEqual([
            {id: 'p1', label: 'První', solvedBy: 2, touchedBy: 3, withMistakes: 2, hard: true},
            {id: 'p2', label: 'Druhá', solvedBy: 0, touchedBy: 0, withMistakes: 0, hard: false},
        ]);
    });

    it('calls a player stuck only when it is long in absolute terms and long against the class', () => {
        const m = summarize(catalogue, entries(
            report({team: 'a', since: NOW - 2 * MIN}),
            report({team: 'b', since: NOW - 3 * MIN}),
            report({team: 'c', since: NOW - 12 * MIN}),
        ), {now: NOW});
        expect(m.players.map(t => [t.name, t.stuck])).toEqual([['a', false], ['b', false], ['c', true]]);
        expect(m.summary.stuck).toBe(1);

        // Everyone slow together is a hard room, not a stuck player (below the
        // ten minutes after which the teacher is told regardless).
        const allSlow = summarize(catalogue, entries(
            report({team: 'a', since: NOW - 7 * MIN}), report({team: 'b', since: NOW - 8 * MIN}),
        ), {now: NOW});
        expect(allSlow.players.every(t => !t.stuck)).toBe(true);
    });

    it('ten minutes in one place is too long even when most of the class has finished', () => {
        // Found in the demo: with nearly everyone done, the median came from the
        // two still playing and a pupil 43 minutes on one puzzle was not flagged.
        const m = summarize(catalogue, entries(
            report({team: 'done', scene: 'exit', completedAt: NOW - MIN}),
            report({team: 'new', since: NOW - 5000}),
            report({team: 'stuck', since: NOW - 43 * MIN}),
        ), {now: NOW});
        expect(m.players.find(t => t.name === 'stuck').stuck).toBe(true);
    });

    it('a long-open puzzle counts as stuck too; a disconnected player is shown as that instead', () => {
        const m = summarize(catalogue, [
            {report: report({team: 'a', activity: {ref: 'p1', since: NOW - 9 * MIN}}), receivedAt: NOW},
            {report: report({team: 'b', since: NOW - 20 * MIN}), receivedAt: NOW - 10 * MIN},
            {report: report({team: 'c'}), receivedAt: NOW - 90_000},
        ], {now: NOW});
        const byName = Object.fromEntries(m.players.map(t => [t.name, t]));
        expect(byName.a.stuck).toBe(true);
        expect(byName.b.connection).toBe('offline');
        expect(byName.b.stuck).toBe(false);
        expect(byName.c.connection).toBe('stale');
    });

    it('lists who needs attention first: stuck longest first, then disconnected', () => {
        const m = summarize(catalogue, [
            {report: report({team: 'a', since: NOW - MIN}), receivedAt: NOW},
            {report: report({team: 'b', since: NOW - MIN}), receivedAt: NOW},
            {report: report({team: 'f', since: NOW - MIN}), receivedAt: NOW},
            {report: report({team: 'g', since: NOW - 2 * MIN}), receivedAt: NOW},
            {report: report({team: 'c', since: NOW - 9 * MIN, puzzles: {p1: {seq: 1, attempts: 3, mistakes: 3, solved: false}}}), receivedAt: NOW},
            {report: report({team: 'd', since: NOW - 14 * MIN}), receivedAt: NOW},
            {report: report({team: 'e'}), receivedAt: NOW - 10 * MIN},
        ], {now: NOW});
        expect(m.attention.map(a => [a.name, a.reason])).toEqual([['d', 'stuck'], ['c', 'stuck'], ['e', 'offline']]);
        expect(m.attention[1]).toMatchObject({place: 'Chodba', mistakes: 3});
    });

    it('a disconnected player does not inflate the class baseline', () => {
        const m = summarize(catalogue, [
            {report: report({team: 'a', since: NOW - MIN}), receivedAt: NOW},
            {report: report({team: 'b', since: NOW - MIN}), receivedAt: NOW},
            {report: report({team: 'c', since: NOW - 10 * MIN}), receivedAt: NOW},
            {report: report({team: 'd', since: NOW - 60 * MIN}), receivedAt: NOW - 20 * MIN},
            {report: report({team: 'e', since: NOW - 60 * MIN}), receivedAt: NOW - 20 * MIN},
        ], {now: NOW});
        expect(m.players.find(t => t.name === 'c').stuck).toBe(true);
    });

    it('never shows one stay longer than a lesson (a tablet that slept through the break)', () => {
        const m = summarize(catalogue, entries(report({team: 'a', since: NOW - 300 * MIN})), {now: NOW});
        expect(m.players[0].sceneForMs).toBe(BOARD_DEFAULTS.lessonMs);
    });

    it('items: has, used, or not', () => {
        const m = summarize(catalogue, entries(report({team: 'a', inventory: ['lamp'], itemsUsed: {key: 1}})), {now: NOW});
        expect(m.players[0].items.map(i => [i.id, i.state])).toEqual([['key', 'used'], ['lamp', 'has']]);
        expect(m.show).toEqual({items: true, milestones: true});
    });

    it('a finished player: completion time, time played, and no stay clock', () => {
        const m = summarize(catalogue, entries(report({team: 'a', scene: 'exit', completedAt: NOW - 2 * MIN, startedAt: NOW - 32 * MIN})), {now: NOW});
        expect(m.players[0]).toMatchObject({completed: true, playedMs: 30 * MIN, sceneForMs: 0, stuck: false});
        expect(m.summary.completed).toBe(1);
    });

    it('works without a catalogue, from what the players reported', () => {
        const m = summarize(null, entries(report({team: 'a', puzzles: {p1: {seq: 1, attempts: 1, mistakes: 0, solved: true}}})), {now: NOW});
        expect(m.catalogueReady).toBe(false);
        expect(m.tasks.map(t => t.id)).toEqual(['p1']);
    });

    it('sorts players by name the Czech way', () => {
        const m = summarize(catalogue, entries(...['Šimon', 'Adam', 'Čeněk', 'Zuzana', 'Hynek'].map(team => report({team}))), {now: NOW});
        expect(m.players.map(t => t.name)).toEqual(['Adam', 'Čeněk', 'Hynek', 'Šimon', 'Zuzana']);
    });

    it('needs to be told the time', () => {
        expect(() => summarize(catalogue, [], {})).toThrow('now');
    });

    it('formats durations briefly', () => {
        expect(formatDuration(45_000)).toBe('45 s');
        expect(formatDuration(185_000)).toBe('3 min 05 s');
        expect(formatDuration(3_900_000)).toBe('1 h 05 min');
    });
});

describe('avatarFor', () => {
    it('initials from one or two names, and the same colour for the same name', () => {
        expect(avatarFor('Anička').initials).toBe('AN');
        expect(avatarFor('Jan Novák').initials).toBe('JN');
        expect(avatarFor('Anička').hue).toBe(avatarFor('Anička').hue);
        expect(avatarFor('Anička').hue).not.toBe(avatarFor('Bára').hue);
        expect(avatarFor('').initials).toBe('?');
    });
});

describe('renderBoard', () => {
    const draw = (reports, opts = {}) => {
        const root = document.createElement('div');
        renderBoard(root, summarize(catalogue, reports.map(r => ({report: r, receivedAt: NOW})), {now: NOW, ...opts}));
        return root;
    };

    it('draws a row per player with avatar, task strip, milestones; the task summary and items', () => {
        const root = draw([
            report({team: 'Bára', puzzles: {p1: {seq: 1, attempts: 2, mistakes: 1, solved: true}}, flags: {door_open: true}, inventory: ['key']}),
            report({team: 'Adam'}),
        ]);
        expect([...root.querySelectorAll('.board-players .board-player-name')].map(e => e.textContent)).toEqual(['Adam', 'Bára']);
        const bara = root.querySelectorAll('.board-player')[1];
        expect(bara.querySelector('.board-avatar').textContent).toBe('BÁ');
        expect([...bara.querySelectorAll('.board-strip .board-cell')].map(c => c.className)).toEqual(['board-cell is-after', 'board-cell is-none']);
        expect(bara.querySelector('.board-cell.is-after').title).toBe('1. První: vyřešeno po chybách, chyb: 1');
        expect(bara.querySelectorAll('.board-dot.is-reached')).toHaveLength(1);
        expect(root.querySelector('.board-tasks tr[data-task="p1"]').textContent).toContain('1/2');
        expect(root.querySelector('.board-item.is-has').title).toBe('Klíč: má');
    });

    it('shows the animal a player picked, and initials for one who did not', () => {
        const root = draw([report({team: 'Anička', avatar: 'unicorn'}), report({team: 'Bára'})]);
        const [anicka, bara] = root.querySelectorAll('.board-players .board-avatar');
        expect(anicka.querySelector('img').getAttribute('src')).toMatch(/\/engine\/avatars\/unicorn\.webp$/);
        expect(anicka.title).toBe('Anička (Jednorožec)');
        expect(bara.textContent).toBe('BÁ');
    });

    it('shows who needs attention above the table', () => {
        const root = draw([report({team: 'a', since: NOW - MIN}), report({team: 'b', since: NOW - MIN}), report({team: 'c', since: NOW - 15 * MIN})]);
        const cards = [...root.querySelectorAll('.board-attention .board-card')];
        expect(cards.map(c => c.querySelector('strong').textContent)).toEqual(['c']);
        expect(root.querySelector('.board-player.is-stuck .board-player-name').textContent).toBe('c');
    });

    it('stays one row per player for a whole class of thirty', () => {
        const names = Array.from({length: 30}, (_, i) => `Hráč ${String(i + 1).padStart(2, '0')}`);
        const root = draw(names.map(team => report({team})));
        expect(root.querySelectorAll('.board-players tbody tr')).toHaveLength(30);
        expect(root.querySelectorAll('.board-tasks tbody tr')).toHaveLength(2); // per task, not per player
        expect(root.querySelector('.board-summary').textContent).toContain('Hráčů: 30');
    });

    it('treats every name as text, never markup', () => {
        const root = draw([report({team: '<img src=x onerror=alert(1)>'})]);
        expect(root.querySelector('img')).toBeNull();
        expect(root.querySelector('.board-player-name').textContent).toBe('<img src=x onerror=alert(1)>');
    });

    it('says so when nobody has joined yet', () => {
        expect(draw([]).textContent).toContain('Zatím se nepřipojil žádný hráč.');
    });
});

describe('sources', () => {
    it('localSource reads what is stored and then listens', () => {
        const stored = report({team: 'a'});
        localStorage.setItem(localBoardKey(stored), JSON.stringify(stored));
        localStorage.setItem('unrelated', '{}');
        let listener = null;
        const Original = globalThis.BroadcastChannel;
        globalThis.BroadcastChannel = class {
            set onmessage(fn) { listener = fn; }
            close() {}
        };
        try {
            const seen = [];
            const src = localSource({onReport: (r) => seen.push(r.player), now: () => NOW});
            listener({data: JSON.stringify(report({team: 'b'}))});
            listener({data: 'not json'});
            expect(seen).toEqual(['a', 'b']);
            src.stop();
        } finally {
            globalThis.BroadcastChannel = Original;
            localStorage.clear();
        }
    });

    it('httpSource polls and hands over each report with its receive time', async () => {
        vi.useFakeTimers();
        try {
            const r = report({team: 'a'});
            const fetchImpl = vi.fn(async () => ({ok: true, json: async () => [{report: r, receivedAt: 123}]}));
            const seen = [];
            const src = httpSource({url: '/api/reports', onReport: (rep, at) => seen.push([rep.player, at]), intervalMs: 1000, fetchImpl});
            await vi.advanceTimersByTimeAsync(0);
            await vi.advanceTimersByTimeAsync(1000);
            expect(fetchImpl).toHaveBeenCalledTimes(2);
            expect(seen[0]).toEqual(['a', 123]);
            src.stop();
            await vi.advanceTimersByTimeAsync(5000);
            expect(fetchImpl).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('the dev server dashboard endpoints', () => {
    let server;
    let base;
    beforeAll(async () => {
        const {games} = findGames([join(resolve(process.cwd()), 'games')]);
        server = createDevServer(games, {now: () => 42});
        await new Promise(res => server.listen(0, '127.0.0.1', res));
        base = `http://127.0.0.1:${server.address().port}`;
    });
    afterAll(async () => {
        await new Promise(res => server.close(res));
    });

    const post = (body) => fetch(`${base}/api/report`, {method: 'POST', headers: {'content-type': 'application/json'}, body});

    it('takes a report, and lists the latest per team', async () => {
        expect((await post(JSON.stringify(report({team: 'a', revision: 1})))).status).toBe(204);
        expect((await post(JSON.stringify(report({team: 'a', revision: 2})))).status).toBe(204);
        expect((await post(JSON.stringify(report({team: 'a', revision: 1})))).status).toBe(204); // late: fine, ignored
        const list = await (await fetch(`${base}/api/reports?game=g&session=7A`)).json();
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({receivedAt: 42, report: {player: 'a', revision: 2}});
    });

    it('never hands on anything beyond the contract, even from a newer engine', async () => {
        const res = await post(JSON.stringify({api: 99, game: 'g', run: 'r', session: 'x', player: 'z', state: {flags: {secret: true}}}));
        expect(res.status).toBe(204);
        const body = await (await fetch(`${base}/api/reports?game=g&session=x`)).text();
        expect(body).not.toContain('secret');
        expect(body).not.toContain('"state"');
    });

    it('refuses what is not a report, or too big', async () => {
        expect((await post('not json')).status).toBe(400);
        expect((await post(JSON.stringify({flags: {}}))).status).toBe(400);
        expect((await post('x'.repeat(MAX_REPORT_BYTES + 10))).status).toBe(413);
    });

    it('answers only the right methods, and POST anywhere else is still refused', async () => {
        expect((await fetch(`${base}/api/report`)).status).toBe(405);
        expect((await fetch(`${base}/api/reports`, {method: 'POST', body: '{}'})).status).toBe(405);
        expect((await fetch(`${base}/engine/engine.js`, {method: 'POST'})).status).toBe(405);
    });

    it('serves the board at the documented address, /board/?game=...', async () => {
        // Found by the browser end-to-end run: the tests asked for
        // /board/index.html, the README says /board/, and that was a 404.
        for (const path of ['/board/?game=demo&source=http', '/board']) {
            const res = await fetch(`${base}${path}`);
            expect(res.status, path).toBe(200);
            expect(await res.text(), path).toContain('Přehled hodiny');
        }
    });

    it('serves the board', async () => {
        const res = await fetch(`${base}/board/index.html`);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('Přehled hodiny');
        expect(resolveRequest('/board/../scripts/dev-server.mjs', new Map()).status).toBe(403);
    });
});
