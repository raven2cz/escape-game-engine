// EI-010: the reporter (non-blocking, coalesced, reserve-persist-send, retry,
// terminal send) and the transports.

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {GameSignals, SIGNALS} from '../../engine/dashboard/signals.js';
import {manualClock} from '../../engine/dashboard/clock.js';
import {DashboardReporter} from '../../engine/dashboard/reporter.js';
import {freshProgress} from '../../engine/dashboard/progress-model.js';
import {buildCatalogue} from '../../engine/dashboard/catalogue.js';
import {checkReport} from '../../engine/dashboard/report.js';
import {
    NullTransport, HttpTransport, LocalBoardTransport, localBoardKey,
} from '../../engine/dashboard/transports.js';

let signals, clock, state, log, persisted, transport, reporter;
const catalogue = buildCatalogue({meta: {id: 'g'}, scenes: [{id: 'hall'}]}, {});

/** A transport that records what it was given and answers how the test says. */
const recordingTransport = (mode = 'ok') => {
    const t = {
        enabled: true,
        sent: [],
        mode,
        send(wire, opts) {
            log.push(`send:${wire.revision}${opts.terminal ? ':terminal' : ''}`);
            t.sent.push({wire, opts});
            if (t.mode === 'throw') throw new Error('offline');
            if (t.mode === 'reject') return Promise.reject(new Error('503'));
            if (t.mode === 'hang') return new Promise(() => {});
            return Promise.resolve();
        },
    };
    return t;
};

const makeReporter = (t, options = {}) => new DashboardReporter({
    signals,
    transport: t,
    clock,
    options: {windowMs: 250, minIntervalMs: 1000, retryMs: [2000, 5000], ...options},
    source: {
        state: () => state,
        progress: () => state.progress,
        activity: () => null,
        catalogue: () => catalogue,
        identity: () => ({game: 'g', session: 's', team: 't'}),
        persist: () => {
            log.push(`persist:${state.progress.revision}`);
            persisted.push(structuredClone(state.progress));
            signals.emit(SIGNALS.STATE_SAVED); // what the engine's _saveState does
        },
    },
});

beforeEach(() => {
    vi.useFakeTimers();
    signals = new GameSignals();
    clock = manualClock(100_000);
    state = {inventory: [], solved: {}, flags: {}, visited: {}, scene: 'hall', progress: freshProgress(clock, () => 'run-1')};
    log = [];
    persisted = [];
});
afterEach(() => {
    reporter?.stop();
    vi.useRealTimers();
});

const tick = async (ms) => {
    clock.advance(ms);
    await vi.advanceTimersByTimeAsync(ms);
};

describe('non-blocking and coalesced', () => {
    it('does no projection, save or send inside the signal', () => {
        transport = recordingTransport();
        reporter = makeReporter(transport);
        for (let i = 0; i < 20; i++) signals.emit(SIGNALS.PUZZLE_EVALUATED, {ref: 'q', ok: false});
        expect(log).toEqual([]);
        expect(transport.sent).toHaveLength(0);
    });

    it('turns a burst of signals into one save and one send', async () => {
        transport = recordingTransport();
        reporter = makeReporter(transport);
        for (let i = 0; i < 9; i++) signals.emit(SIGNALS.PUZZLE_EVALUATED, {ref: `q${i}`, ok: true});
        await tick(250);
        expect(log).toEqual(['persist:1', 'send:1']);
    });

    it('reserves the revision and persists it before the report is sent', async () => {
        transport = recordingTransport();
        reporter = makeReporter(transport);
        signals.emit(SIGNALS.SCENE_ENTERED, {scene: 'hall'});
        await tick(250);
        expect(persisted[0].revision).toBe(1);
        expect(log.indexOf('persist:1')).toBeLessThan(log.indexOf('send:1'));
        expect(checkReport(transport.sent[0].wire)).toEqual([]);
    });

    it('its own save does not schedule another flush (no loop)', async () => {
        transport = recordingTransport();
        reporter = makeReporter(transport);
        signals.emit(SIGNALS.ITEM_USED, {id: 'key'});
        await tick(250);
        await tick(5000);
        expect(transport.sent).toHaveLength(1);
    });

    it('an engine save alone produces a report but not an extra save', async () => {
        transport = recordingTransport();
        reporter = makeReporter(transport);
        signals.emit(SIGNALS.STATE_SAVED);
        await tick(250);
        // The revision still has to be persisted before it is used.
        expect(log).toEqual(['persist:1', 'send:1']);
    });

    it('keeps at least minIntervalMs between sends', async () => {
        transport = recordingTransport();
        reporter = makeReporter(transport);
        signals.emit(SIGNALS.ITEM_GIVEN, {id: 'a'});
        await tick(250);
        signals.emit(SIGNALS.ITEM_GIVEN, {id: 'b'});
        await tick(250);
        expect(transport.sent).toHaveLength(1);
        await tick(700);   // 950 ms after the first send: still waiting
        expect(transport.sent).toHaveLength(1);
        await tick(50);    // 1000 ms: goes
        expect(transport.sent).toHaveLength(2);
    });
});

describe('failure', () => {
    it('a transport that throws does not reach the emitter, and the report is kept', async () => {
        transport = recordingTransport('throw');
        reporter = makeReporter(transport);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        signals.emit(SIGNALS.PUZZLE_EVALUATED, {ref: 'q', ok: false});
        await expect(tick(250)).resolves.toBeUndefined();
        expect(reporter.pending?.revision).toBe(1);
        warn.mockRestore();
    });

    it('retries the latest unsent report with backoff, even if nothing else happens', async () => {
        transport = recordingTransport('reject');
        reporter = makeReporter(transport);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        signals.emit(SIGNALS.PUZZLE_EVALUATED, {ref: 'q', ok: false});
        await tick(250);
        expect(transport.sent).toHaveLength(1);
        await tick(2000);
        expect(transport.sent).toHaveLength(2);
        transport.mode = 'ok';
        await tick(5000);
        expect(transport.sent).toHaveLength(3);
        expect(transport.sent.map(s => s.wire.revision)).toEqual([1, 1, 1]); // same snapshot, same revision
        expect(reporter.pending).toBeNull();
        await tick(60_000);
        expect(transport.sent).toHaveLength(3);
        warn.mockRestore();
    });

    it('a newer snapshot supersedes the unsent one', async () => {
        transport = recordingTransport('reject');
        reporter = makeReporter(transport);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        signals.emit(SIGNALS.PUZZLE_EVALUATED, {ref: 'q', ok: false});
        await tick(250);
        signals.emit(SIGNALS.PUZZLE_EVALUATED, {ref: 'q', ok: true});
        transport.mode = 'ok';
        await tick(1000);
        expect(transport.sent.at(-1).wire.revision).toBe(2);
        warn.mockRestore();
    });

    it('one request in flight at a time; the newer one goes when it returns', async () => {
        transport = recordingTransport();
        let release;
        transport.send = function (wire, opts) {
            log.push(`send:${wire.revision}`);
            this.sent.push({wire, opts});
            return new Promise(res => { release = res; });
        };
        reporter = makeReporter(transport);
        signals.emit(SIGNALS.ITEM_GIVEN, {id: 'a'});
        await tick(250);
        signals.emit(SIGNALS.ITEM_GIVEN, {id: 'b'});
        await tick(2000);
        expect(transport.sent).toHaveLength(1);
        release();
        await tick(250);
        expect(transport.sent.map(s => s.wire.revision)).toEqual([1, 2]);
    });
});

describe('what the SOL review found', () => {
    it('a failed save gives the revision back, sends nothing, and retries', async () => {
        transport = recordingTransport();
        let fail = true;
        reporter = new DashboardReporter({
            signals, transport, clock,
            options: {windowMs: 250, minIntervalMs: 0, retryMs: [2000]},
            source: {
                state: () => state, progress: () => state.progress, activity: () => null,
                catalogue: () => catalogue, identity: () => ({game: 'g'}),
                persist: () => !fail,
            },
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        signals.emit(SIGNALS.PUZZLE_EVALUATED, {ref: 'q', ok: false});
        await tick(250);
        expect(transport.sent).toHaveLength(0);
        expect(state.progress.revision).toBe(0);
        fail = false;
        await tick(2000);
        expect(transport.sent.map(s => s.wire.revision)).toEqual([1]);
        warn.mockRestore();
    });

    it('an older send finishing does not cancel the retry of a newer change whose save failed', async () => {
        transport = recordingTransport();
        let release;
        transport.send = function (wire) { this.sent.push({wire}); return new Promise(res => { release = res; }); };
        let fail = false;
        reporter = new DashboardReporter({
            signals, transport, clock,
            options: {windowMs: 250, minIntervalMs: 0, retryMs: [2000]},
            source: {
                state: () => state, progress: () => state.progress, activity: () => null,
                catalogue: () => catalogue, identity: () => ({game: 'g'}),
                persist: () => !fail,
            },
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        signals.emit(SIGNALS.ITEM_GIVEN, {id: 'a'});
        await tick(250);                              // revision 1 goes on the wire
        fail = true;
        signals.emit(SIGNALS.PUZZLE_EVALUATED, {ref: 'q', ok: false});
        await tick(250);                              // its save fails: retry scheduled
        release();                                    // revision 1 is accepted now
        await tick(0);
        fail = false;
        transport.send = function (wire) { this.sent.push({wire}); return Promise.resolve(); };
        await tick(2500);
        expect(transport.sent.map(s => s.wire.revision)).toEqual([1, 2]);
        warn.mockRestore();
    });

    it('a save that keeps failing backs off instead of retrying every 2 s forever', async () => {
        reporter = new DashboardReporter({
            signals, transport: new NullTransport(), clock,
            options: {windowMs: 250, minIntervalMs: 0, retryMs: [2000, 5000, 10000]},
            source: {
                state: () => state, progress: () => state.progress, activity: () => null,
                catalogue: () => catalogue, identity: () => ({game: 'g'}),
                persist: () => { log.push('persist'); return false; },
            },
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        signals.emit(SIGNALS.PUZZLE_EVALUATED, {ref: 'q', ok: false});
        await tick(250);                              // attempt 1
        await tick(2000);                             // attempt 2
        await tick(5000);                             // attempt 3
        await tick(9999);
        expect(log).toHaveLength(3);                  // not yet: the third wait is 10 s
        await tick(1);
        expect(log).toHaveLength(4);
        warn.mockRestore();
    });

    it('a failed terminal send is retried if the page lives on', async () => {
        transport = recordingTransport('reject');
        reporter = makeReporter(transport);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        signals.emit(SIGNALS.PUZZLE_EVALUATED, {ref: 'q', ok: false});
        reporter.flush({terminal: true});
        await tick(0);
        transport.mode = 'ok';
        await tick(2000);
        expect(transport.sent.map(s => s.opts.terminal)).toEqual([true, false]);
        expect(reporter.pending).toBeNull();
        warn.mockRestore();
    });

    it('once stopped, nothing more happens, even when a pending send fails later', async () => {
        transport = recordingTransport();
        let reject;
        transport.send = function (wire) { this.sent.push({wire}); return new Promise((_, r) => { reject = r; }); };
        reporter = makeReporter(transport);
        signals.emit(SIGNALS.ITEM_GIVEN, {id: 'a'});
        await tick(250);
        reporter.stop();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        reject(new Error('late'));
        signals.emit(SIGNALS.ITEM_GIVEN, {id: 'b'});
        reporter.flush({terminal: true});
        await tick(60_000);
        expect(transport.sent).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);
        warn.mockRestore();
    });
});

describe('the page going away', () => {
    it('sends at once, terminal, on pagehide and on a hidden tab', async () => {
        transport = recordingTransport();
        reporter = makeReporter(transport);
        reporter.attachLifecycle(window, document);
        signals.emit(SIGNALS.PUZZLE_EVALUATED, {ref: 'q', ok: false});
        window.dispatchEvent(new Event('pagehide'));
        expect(log).toEqual(['persist:1', 'send:1:terminal']);

        signals.emit(SIGNALS.PUZZLE_EVALUATED, {ref: 'q', ok: true});
        Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'hidden'});
        document.dispatchEvent(new Event('visibilitychange'));
        delete document.visibilityState;
        expect(log.at(-1)).toBe('send:2:terminal');
    });

    it('resends an unsent snapshot under the same revision, and nothing if all was sent', async () => {
        transport = recordingTransport('reject');
        reporter = makeReporter(transport);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        signals.emit(SIGNALS.PUZZLE_EVALUATED, {ref: 'q', ok: false});
        await tick(250);
        transport.mode = 'ok';
        reporter.flush({terminal: true});
        expect(transport.sent.map(s => [s.wire.revision, s.opts.terminal])).toEqual([[1, false], [1, true]]);
        await tick(0);
        reporter.flush({terminal: true});
        expect(transport.sent).toHaveLength(2);
        warn.mockRestore();
    });
});

describe('with the default NullTransport', () => {
    it('builds no reports, but still persists a progress change nothing else saved', async () => {
        reporter = makeReporter(new NullTransport());
        signals.emit(SIGNALS.PUZZLE_EVALUATED, {ref: 'q', ok: false});
        await tick(250);
        expect(log).toEqual(['persist:0']); // saved; no revision spent, nothing sent
    });

    it('does nothing at all for an engine save it had no part in', async () => {
        reporter = makeReporter(new NullTransport());
        signals.emit(SIGNALS.STATE_SAVED);
        await tick(1000);
        expect(log).toEqual([]);
    });
});

describe('transports', () => {
    it('NullTransport is disabled and sends nothing', () => {
        const t = new NullTransport();
        expect(t.enabled).toBe(false);
        expect(t.send({})).toBeUndefined();
    });

    it('HttpTransport POSTs JSON with keepalive and custom headers', async () => {
        const fetch = vi.fn(async () => ({ok: true}));
        const t = new HttpTransport({url: '/r', headers: {authorization: 'Bearer x'}, fetch});
        await t.send({revision: 1}, {terminal: false});
        const [url, init] = fetch.mock.calls[0];
        expect(url).toBe('/r');
        expect(init).toMatchObject({method: 'POST', keepalive: true, body: '{"revision":1}'});
        expect(init.headers).toMatchObject({'content-type': 'application/json', authorization: 'Bearer x'});
    });

    it('HttpTransport rejects a refused report', async () => {
        const t = new HttpTransport({url: '/r', fetch: async () => ({ok: false, status: 503})});
        await expect(t.send({}, {})).rejects.toThrow('503');
    });

    it('HttpTransport uses a beacon for a terminal send, and reports a refused beacon', async () => {
        const beacon = vi.fn(() => true);
        const fetch = vi.fn();
        const t = new HttpTransport({url: '/r', fetch, sendBeacon: beacon});
        await t.send({revision: 2}, {terminal: true});
        expect(beacon).toHaveBeenCalledOnce();
        expect(fetch).not.toHaveBeenCalled();
        beacon.mockReturnValueOnce(false);
        await expect(t.send({}, {terminal: true})).rejects.toThrow('beacon refused');
    });

    it('HttpTransport falls back to keepalive fetch when it must carry headers', async () => {
        const beacon = vi.fn(() => true);
        const fetch = vi.fn(async () => ({ok: true}));
        const t = new HttpTransport({url: '/r', headers: {authorization: 'x'}, fetch, sendBeacon: beacon});
        await t.send({}, {terminal: true});
        expect(beacon).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledOnce();
    });

    it('LocalBoardTransport keeps the latest report per team and announces it', () => {
        const posted = [];
        const Original = globalThis.BroadcastChannel;
        globalThis.BroadcastChannel = class { postMessage(m) { posted.push(m); } };
        try {
            const t = new LocalBoardTransport({storage: localStorage});
            const wire = {game: 'g', session: '7A', team: 'modri', revision: 1};
            t.send(wire);
            expect(JSON.parse(localStorage.getItem(localBoardKey(wire)))).toEqual(wire);
            expect(localBoardKey(wire)).toBe('dashboard:report:g:7A:modri');
            expect(posted).toEqual([JSON.stringify(wire)]);
        } finally {
            globalThis.BroadcastChannel = Original;
        }
    });
});
