// EI-010 end to end: a real Game, real puzzles, real reloads, and what reaches
// the transport. The unit tests pin each layer; these pin that the engine
// feeds them at the right choke points, and that nothing internal gets out.

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {createReloadHarness, waitFor, takeOverImageLoading} from './helpers/reload.js';
import {manualClock} from '../../engine/dashboard/clock.js';
import {checkReport} from '../../engine/dashboard/report.js';
import {HttpTransport} from '../../engine/dashboard/transports.js';

const SCENES = {
    meta: {
        id: 'ei010', version: '1.0.0', saveVersion: 1,
        dashboard: {
            labels: {tasks: {riddle: 'Hádanka u dveří'}},
            milestones: [
                {id: 'door', label: 'Dveře otevřeny', flag: 'door_open'},
                {id: 'met', label: 'Potkali průvodce', dialog: 'intro'},
                {id: 'lab', label: 'V laboratoři', scene: 'lab'},
            ],
        },
    },
    startScene: 'hall',
    items: [{id: 'key', label: 'Klíč'}],
    scenes: [
        {
            id: 'hall', title: 'Chodba', image: 'scenes/hall.jpg',
            hotspots: [
                {type: 'puzzle', puzzleRef: 'riddle', rect: {x: 1, y: 1, w: 5, h: 5},
                    options: {blockUntilSolved: true}, onSuccess: {setFlags: ['door_open']}},
                {type: 'puzzle', puzzleRef: 'series', rect: {x: 10, y: 1, w: 5, h: 5}},
                {type: 'pickup', itemId: 'key', rect: {x: 20, y: 1, w: 5, h: 5}},
            ],
        },
        {
            id: 'lab', title: 'Laboratoř', image: 'scenes/lab.jpg',
            hotspots: [{type: 'apply', acceptItems: [{id: 'key', consume: true}], onApply: {message: 'Odemčeno'},
                rect: {x: 1, y: 1, w: 5, h: 5}}],
        },
        {id: 'exit', title: 'Východ', image: 'scenes/exit.jpg', end: true},
    ],
};

const PUZZLES = {
    riddle: {id: 'riddle', kind: 'phrase', title: 'Hádanka', solution: 'ano'},
    series: {
        id: 'series', kind: 'list',
        steps: [
            {config: {kind: 'quiz', title: 'Otázka 1', tokens: [{id: 'a', text: 'A'}, {id: 'b', text: 'B'}], solutions: ['a']}},
            {config: {kind: 'quiz', title: 'Otázka 2', tokens: [{id: 'a', text: 'A'}, {id: 'b', text: 'B'}], solutions: ['b']}},
        ],
    },
    orphan: {id: 'orphan', kind: 'phrase', solution: 'x'},
};

const DIALOGS = {
    meta: {id: 'ei010'},
    characters: [],
    dialogs: [{id: 'intro', typewriter: false, sequence: [{speaker: 'left', text: 'Ahoj.'}, {speaker: 'left', text: 'Pojď.'}]}],
};

/** A transport that keeps every report it is given. */
const capture = () => ({enabled: true, sent: [], send(wire) { this.sent.push(wire); }, get last() { return this.sent.at(-1); }});

let clock, harness;
const opts = (extra = {}) => ({
    gameOpts: {
        clock,
        reportLifecycle: false,
        reporterOptions: {windowMs: 5, minIntervalMs: 0},
        ...extra,
    },
});
const boot = (extra) => harness.boot(opts(extra));
const reload = (extra) => harness.reload(opts(extra));

/** Build a report now, rather than waiting for the timer. */
const reportNow = (game, t) => {
    game.reporter.flush();
    return t.last;
};

const hotspot = (i) => document.querySelectorAll('#hotspotLayer .hotspot')[i];
const puzzleOpen = () => waitFor(() => document.querySelector('.pz-container'), {label: 'an open puzzle'});
const answerPhrase = async (text) => {
    const input = document.querySelector('.pz-container .pz-input');
    input.value = text;
    input.dispatchEvent(new Event('input', {bubbles: true}));   // what typing does
    document.querySelector('.pz-container .pz-btn--ok').click();
    await new Promise(r => setTimeout(r, 0));
};
const pickToken = async (id) => {
    document.querySelector(`.pz-container .pz-token[data-id="${id}"]`).click();
    document.querySelector('.pz-container .pz-btn--ok').click();
    await new Promise(r => setTimeout(r, 0));
};
const catalogueReady = (game) => waitFor(() => game.dashboardCatalogue().ready, {label: 'puzzle catalogue'});

beforeEach(() => {
    localStorage.clear();
    clock = manualClock(1_000_000);
    harness = createReloadHarness({scenes: SCENES, puzzles: PUZZLES, dialogs: DIALOGS});
});

describe('a run, as the dashboard sees it', () => {
    it('reports position, a wrong then right answer, the open task, a milestone and the totals', async () => {
        const t = capture();
        const game = await boot({reportTransport: t});
        await catalogueReady(game);

        let r = reportNow(game, t);
        expect(checkReport(r)).toEqual([]);
        expect(r).toMatchObject({
            api: 2, game: 'ei010', gameVersion: '1.0.0', completed: false,
            position: {scene: 'hall', label: 'Chodba', since: 1_000_000},
            activity: null,
            progress: {scenesVisited: 1, scenesTotal: 3, puzzlesSolved: 0, puzzlesTotal: 3},
            puzzles: [], milestones: [],
        });

        hotspot(0).click();
        await puzzleOpen();
        clock.advance(2000);
        await answerPhrase('ne');                              // held: blockUntilSolved
        r = reportNow(game, t);
        expect(r.activity).toEqual({ref: 'riddle', label: 'Hádanka u dveří', since: 1_000_000});
        expect(r.puzzles).toEqual([{ref: 'riddle', attempts: 1, mistakes: 1, solved: false}]);

        await answerPhrase('ano');
        await waitFor(() => !document.querySelector('.pz-container'), {label: 'the puzzle to close'});
        await waitFor(() => game.state.flags.door_open, {label: 'onSuccess'});

        r = reportNow(game, t);
        expect(r.activity).toBeNull();
        expect(r.puzzles).toEqual([{ref: 'riddle', attempts: 2, mistakes: 1, solved: true}]);
        expect(r.progress.puzzlesSolved).toBe(1);
        expect(r.milestones).toEqual(['door']);
        expect(r.revision).toBeGreaterThan(t.sent[0].revision);
    });

    it('sends nothing anywhere by default', async () => {
        const game = await boot();
        expect(game.reportTransport).toBeUndefined();
        expect(game.reporter._transport.enabled).toBe(false);
        game.reporter.flush();
        expect(game.reporter.pending).toBeNull();
    });
});

describe('reload', () => {
    it('a held wrong answer reaches storage through the flush, with no other move, and survives a reload', async () => {
        // A long window, so the scheduled commit cannot run before the check.
        const game = await boot({reporterOptions: {windowMs: 60_000, minIntervalMs: 0}});
        await catalogueReady(game);
        hotspot(0).click();
        await puzzleOpen();
        await answerPhrase('ne');

        const saved = () => JSON.parse(localStorage.getItem('state:ei010')).progress.puzzles;
        expect(saved().riddle).toBeUndefined();        // nothing the engine does saves a held wrong answer
        game.reporter.flush();                          // the scheduled commit
        expect(saved().riddle).toMatchObject({mistakes: 1, solved: false});

        const again = await reload();
        expect(again.state.progress.puzzles.riddle).toMatchObject({attempts: 1, mistakes: 1, solved: false});
    });

    it('the scheduled commit runs by itself: no explicit flush, no later move', async () => {
        const game = await boot();
        hotspot(0).click();
        await puzzleOpen();
        await answerPhrase('ne');
        await waitFor(() => JSON.parse(localStorage.getItem('state:ei010')).progress.puzzles.riddle,
            {label: 'the scheduled commit'});
        const again = await reload();
        expect(again.state.progress.puzzles.riddle.mistakes).toBe(1);
    });

    it('keeps the run, never reuses a revision, and keeps the scene clock running', async () => {
        const t1 = capture();
        const game = await boot({reportTransport: t1});
        clock.advance(5000);
        await game.goto('lab');
        const first = reportNow(game, t1);

        clock.advance(3000);
        const t2 = capture();
        const again = await reload({reportTransport: t2});
        again.signals.emit('item:given', {id: 'x'});
        const second = reportNow(again, t2);

        expect(second.run).toBe(first.run);
        expect(second.revision).toBeGreaterThan(first.revision);
        expect(second.position).toMatchObject({scene: 'lab', since: 1_005_000}); // not reset by the reload
        expect(again.state.progress.sceneTime).toEqual({hall: 5000});
    });

    it('a reset starts a new run', async () => {
        const game = await boot();
        const run = game.state.progress.run;
        history.replaceState(null, '', '?reset=1');
        try {
            const fresh = await reload();
            expect(fresh.state.progress.run).not.toBe(run);
            expect(fresh.state.progress.revision).toBe(0);
        } finally {
            history.replaceState(null, '', location.pathname);
        }
    });

    it('an older save without progress keeps the lesson and starts a record from now', async () => {
        localStorage.setItem('state:ei010', JSON.stringify({
            stateSchemaVersion: 1, signature: 'ei010|1', inventory: ['key'], solved: {'solved:pz:riddle': true},
            flags: {door_open: true}, visited: {hall: true, lab: true}, eventsFired: {}, scene: 'lab',
        }));
        const t = capture();
        const game = await boot({reportTransport: t});
        await catalogueReady(game);
        expect(game.state.scene).toBe('lab');
        expect(game.state.inventory).toEqual(['key']);
        const r = reportNow(game, t);
        expect(r.startedAt).toBe(1_000_000);
        expect(r.puzzles).toEqual([{ref: 'riddle', attempts: 0, mistakes: 0, solved: true}]);
        expect(r.milestones).toEqual(['door', 'lab']);
        expect(r.progress.scenesVisited).toBe(2);
    });
});

describe('what counts as an answer', () => {
    it('an empty answer is not a mistake and the puzzle stays open', async () => {
        const t = capture();
        const game = await boot({reportTransport: t});
        hotspot(0).click();
        await puzzleOpen();
        await answerPhrase('   ');
        expect(document.querySelector('.pz-container')).not.toBeNull();
        expect(reportNow(game, t).puzzles).toEqual([]);
    });

    it('a double tap on a wrong answer is one mistake; only a changed answer is another', async () => {
        const t = capture();
        const game = await boot({reportTransport: t});
        hotspot(0).click();
        await puzzleOpen();
        const input = document.querySelector('.pz-container .pz-input');
        input.value = 'ne';
        input.dispatchEvent(new Event('input', {bubbles: true}));
        const ok = document.querySelector('.pz-container .pz-btn--ok');
        ok.click();
        ok.click();
        await new Promise(r => setTimeout(r, 0));
        clock.advance(10_000);
        ok.click();                                    // much later, but nothing changed
        await new Promise(r => setTimeout(r, 0));
        expect(reportNow(game, t).puzzles[0]).toMatchObject({attempts: 1, mistakes: 1});

        input.value = 'nevím';
        input.dispatchEvent(new Event('input', {bubbles: true}));
        ok.click();
        await new Promise(r => setTimeout(r, 0));
        expect(reportNow(game, t).puzzles[0]).toMatchObject({attempts: 2, mistakes: 2});
    });
});

describe('lists', () => {
    it('reports each step by <list>#<index>, never the list, and follows the open step', async () => {
        const t = capture();
        const game = await boot({reportTransport: t});
        await catalogueReady(game);
        hotspot(1).click();
        await puzzleOpen();

        expect(reportNow(game, t).activity).toMatchObject({ref: 'series#0', label: 'Otázka 1'});
        await pickToken('b');                           // wrong; the list moves on
        await waitFor(() => game.progressModel.activity()?.ref === 'series#1', {label: 'step 2'});
        expect(reportNow(game, t).activity).toMatchObject({ref: 'series#1', label: 'Otázka 2'});
        await pickToken('b');                           // right

        await waitFor(() => document.querySelector('.pz-list-summary'), {label: 'the summary'});
        let r = reportNow(game, t);
        expect(r.activity).toBeNull();                  // the summary is not a task
        document.querySelector('.pz-list-summary .pz-btn--ok').click();
        await waitFor(() => !document.querySelector('.pz-container'), {label: 'the list to close'});

        r = reportNow(game, t);
        expect(r.puzzles).toEqual([
            {ref: 'series#0', attempts: 1, mistakes: 1, solved: false},
            {ref: 'series#1', attempts: 1, mistakes: 0, solved: true},
        ]);
        expect(r.puzzles.map(p => p.ref)).not.toContain('series');
        expect(r.progress.puzzlesSolved).toBe(1);
    });
});

describe('items and dialogs', () => {
    it('an item used is told apart from an item never had', async () => {
        const t = capture();
        const game = await boot({reportTransport: t});
        hotspot(2).click();
        await waitFor(() => game.state.inventory.includes('key'), {label: 'pickup'});
        expect(reportNow(game, t).inventory).toEqual(['key']);

        await game.goto('lab');
        game.enterUseMode('key');
        await game._activateHotspot(game.currentScene.hotspots[0]);
        const r = reportNow(game, t);
        expect(r.inventory).toEqual([]);
        expect(r.itemsUsed).toEqual(['key']);
    });

    it('a dialog opened by an alias is seen under its canonical id, and a declared one is a milestone', async () => {
        const t = capture();
        const game = await boot({reportTransport: t});
        const done = game.openDialog('story.intro');
        await waitFor(() => game.dialogUI.active?.dlg?.id === 'intro', {label: 'the dialog'});
        expect(reportNow(game, t).dialogsSeen).toEqual([]);
        while (game.dialogUI.active) await game.dialogUI.next();
        await done;
        const r = reportNow(game, t);
        expect(r.dialogsSeen).toEqual(['intro']);
        expect(r.milestones).toContain('met');
    });

    it('a dialog closed by force is not counted as seen', async () => {
        const t = capture();
        const game = await boot({reportTransport: t});
        void game.openDialog('intro');
        await waitFor(() => game.dialogUI.active, {label: 'the dialog'});
        await game.dialogUI.close();
        expect(reportNow(game, t).dialogsSeen).toEqual([]);
    });
});

describe('completion', () => {
    it('is the first successful entry to the end scene, and is stamped once', async () => {
        const t = capture();
        const game = await boot({reportTransport: t});
        clock.advance(60_000);
        await game.goto('exit');
        clock.advance(60_000);
        await game.goto('exit');
        const r = reportNow(game, t);
        expect(r.completed).toBe(true);
        expect(r.completedAt).toBe(1_060_000);
    });

    it('does not count when the end scene image failed and the team is not really there', async () => {
        const images = takeOverImageLoading();
        try {
            const t = capture();
            const {game, ready} = harness.bootDetached(opts({reportTransport: t}));
            await images.waitForRequest('hall');
            images.settle('hall');
            await ready;

            const going = game.goto('exit');
            await images.waitForRequest('exit');
            images.settle('exit', 'error');
            await going;
            expect(reportNow(game, t).completed).toBe(false);
            expect(game.state.progress.completedAt).toBeNull();
        } finally {
            images.restore();
        }
    });
});

describe('no writes of its own', () => {
    // Found by CI: a game left idle wrote its progress on a timer a moment after
    // starting. In a lesson that is harmless; in the test suite a retired game
    // wrote into the next test's storage. It must not happen at all: after
    // starting, the engine writes only when something happens.
    const counting = () => {
        const box = {saves: 0, value: null};
        return {box, storage: {load: () => box.value, save: (st) => { box.saves++; box.value = JSON.parse(JSON.stringify(st)); }, clear: () => { box.value = null; }}};
    };

    it('an idle game writes nothing after it has started', async () => {
        const {box, storage} = counting();
        await boot({storage, reporterOptions: {windowMs: 5, minIntervalMs: 0}});
        const afterStart = box.saves;
        await new Promise(r => setTimeout(r, 120));
        expect(box.saves).toBe(afterStart);
        expect(box.value.progress.scene).toBe('hall');   // and the first scene was stored while starting
    });

    it('a reload into the same scene writes nothing after starting either', async () => {
        const {box, storage} = counting();
        await boot({storage});
        const afterReload = await reload({storage}).then(() => box.saves);
        await new Promise(r => setTimeout(r, 120));
        expect(box.saves).toBe(afterReload);
    });
});

describe('restart and storage', () => {
    it('restart stops reporting, so leaving the page cannot write the old run back', async () => {
        const game = await boot();
        hotspot(0).click();
        await puzzleOpen();
        await answerPhrase('ne');                      // a deferred commit is pending
        game.restart();                                // clears storage, then navigates
        window.dispatchEvent(new Event('pagehide'));   // the way out
        game.reporter.flush({terminal: true});
        expect(localStorage.getItem('state:ei010')).toBeNull();
    });

    it('the default storage says when a save did not happen', async () => {
        const game = await boot();
        const setItem = localStorage.setItem;
        localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
        try {
            expect(game._saveState()).toBe(false);
        } finally {
            localStorage.setItem = setItem;
        }
        expect(game._saveState()).toBe(true);
    });

    it('a revision is not sent while it cannot be saved, and goes once storage works again', async () => {
        const t = capture();
        const game = await boot({reportTransport: t, reporterOptions: {windowMs: 5, minIntervalMs: 0, retryMs: [20]}});
        const before = t.sent.length;
        const setItem = localStorage.setItem;
        localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
        const warn = console.warn;
        console.warn = () => {};
        try {
            game.signals.emit('item:given', {id: 'x'});
            game.reporter.flush();
            expect(t.sent.length).toBe(before);        // nothing sent under an unsaved revision
        } finally {
            localStorage.setItem = setItem;
            console.warn = warn;
        }
        await waitFor(() => t.sent.length > before, {label: 'the retry'});
        const saved = JSON.parse(localStorage.getItem('state:ei010')).progress.revision;
        expect(t.last.revision).toBe(saved);           // what was sent is what was saved
    });
});

describe('dialogs arriving later', () => {
    it('a milestone on a flag only a dialog sets is kept once the dialogs load', async () => {
        const scenes = structuredClone(SCENES);
        scenes.meta.dashboard.milestones.push({id: 'told', label: 'Vyslechli průvodce', flag: 'told_story'});
        const dialogs = structuredClone(DIALOGS);
        dialogs.dialogs[0].onEnd = {setFlags: ['told_story']};
        harness = createReloadHarness({scenes, puzzles: PUZZLES, dialogs});
        const game = await boot();
        // Before the dialogs load the flag cannot be checked, so it is not refused.
        expect(game.dashboardCatalogue().milestones.map(m => m.id)).toContain('told');
        await game._ensureDialogsLoaded();
        expect(game.dashboardCatalogue().milestones.map(m => m.id)).toContain('told');
        expect(game.dashboardCatalogue().errors).toEqual([]);
    });
});

describe('a dialogs file that fails to load', () => {
    it('does not make the catalogue drop milestones it could not check', async () => {
        const game = await boot();
        const realFetch = globalThis.fetch;
        globalThis.fetch = async () => { throw new Error('network dropped'); };
        const err = console.error;
        console.error = () => {};
        try {
            await game._ensureDialogsLoaded();
        } finally {
            globalThis.fetch = realFetch;
            console.error = err;
        }
        expect(game.dashboardCatalogue().milestones.map(m => m.id)).toContain('met'); // a dialog milestone
    });
});

describe('the puzzle catalogue', () => {
    it('is unknown, never zero, until loaded; concurrent loads share one request', async () => {
        const t = capture();
        const game = await boot({reportTransport: t, prefetchPuzzles: false});
        expect(reportNow(game, t).progress.puzzlesTotal).toBeNull();

        const realFetch = globalThis.fetch;
        let puzzleRequests = 0;
        globalThis.fetch = async (url, init) => {
            if (String(url).includes('puzzles.json')) puzzleRequests++;
            return realFetch(url, init);
        };
        try {
            await Promise.all([game._ensurePuzzlesLoaded(), game._ensurePuzzlesLoaded()]);
        } finally {
            globalThis.fetch = realFetch;
        }
        expect(puzzleRequests).toBe(1);
        expect(reportNow(game, t).progress.puzzlesTotal).toBe(3); // riddle + two steps; not the list, not the orphan
    });

    it('is fetched after the first render without anyone opening a puzzle', async () => {
        const game = await boot();
        await catalogueReady(game);
        expect(game.dashboardCatalogue().totals).toEqual({scenes: 3, tasks: 3});
    });
});

describe('no leak, end to end', () => {
    afterEach(() => {
        history.replaceState(null, '', location.pathname);
    });

    it('the HTTP body is exactly the contract and carries nothing internal', async () => {
        const bodies = [];
        const transport = new HttpTransport({
            url: '/report',
            fetch: async (_url, init) => {
                bodies.push(init.body);
                return {ok: true};
            },
        });
        const game = await boot({reportTransport: transport});
        await catalogueReady(game);
        hotspot(2).click();
        await waitFor(() => game.state.inventory.includes('key') && !game._hotspotBusy, {label: 'pickup'});
        hotspot(0).click();
        await puzzleOpen();
        await answerPhrase('ano');
        await waitFor(() => game.state.flags.door_open, {label: 'onSuccess'});
        game.reporter.flush();
        await new Promise(r => setTimeout(r, 0));

        const body = bodies.at(-1);
        expect(checkReport(JSON.parse(body))).toEqual([]);
        for (const internal of ['solved:pz:', 'door_open', 'eventsFired', 'signature', 'stateSchemaVersion',
            'hero', 'puzzleResults', 'contentShown', 'sceneImages', 'useItemId', 'sceneTime', 'orphan']) {
            expect(body).not.toContain(internal);
        }
    });
});
