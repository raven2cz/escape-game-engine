// engine/dashboard/reporter.js
//
// Turns signals into reports without ever doing the work inside one. A signal
// only sets a dirty flag and, if nothing is scheduled yet, schedules a flush on
// a timer. The flush then does, once for the whole burst:
//
//   1. reserve: revision + 1, written into state.progress
//   2. persist: the state is saved, so a reload never reuses that revision for
//      different content, and so a mutation from a transition that saves nothing
//      by itself (a held wrong answer, a plain dialog end) reaches storage
//   3. send: project, toWire(), hand to the transport
//
// Honest about where it runs (plans/EI-010-DESIGN-API.md, Revision 1 §5): a
// timer task is still Safari's main thread. What is guaranteed is that
// projection, serialisation and the extra save never run in the engine's
// transition stack, and that one burst of signals costs one flush.
//
// Delivery is best effort and self-healing. Every report is a complete
// snapshot, so the newest one supersedes anything lost. The latest unsent
// report is kept and retried with backoff even if the game goes quiet, and the
// page going away triggers a terminal send through the transport. Neither the
// retry nor the beacon is a guarantee; continuous sending is what bounds loss.

import {SIGNALS} from './signals.js';
import {project} from './projector.js';
import {toWire} from './report.js';

/** Signals that change what the private progress holds, and so need a save. */
const PROGRESS_SIGNALS = new Set([
    SIGNALS.SCENE_ENTERED,
    SIGNALS.PUZZLE_EVALUATED,
    SIGNALS.PUZZLE_SOLVED,
    SIGNALS.ITEM_USED,
    SIGNALS.DIALOG_ENDED,
    SIGNALS.RUN_COMPLETED,
]);

export class DashboardReporter {
    /**
     * @param {object} deps
     * @param {import('./signals.js').GameSignals} deps.signals
     * @param {object} deps.source  what the reporter reads and the one thing it may do:
     *   state(), progress(), activity(), catalogue(), identity(), persist()
     * @param {{enabled: boolean, send: Function}} deps.transport
     * @param {{now: () => number}} deps.clock
     * @param {object} [deps.options]
     */
    constructor({signals, source, transport, clock, options = {}}) {
        this._source = source;
        this._transport = transport;
        this._clock = clock;
        this._timers = options.timers || {setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis)};
        this.windowMs = options.windowMs ?? 250;
        this.minIntervalMs = options.minIntervalMs ?? 1000;
        this.retryMs = options.retryMs ?? [2000, 5000, 10000, 30000];

        this._reportDirty = false;
        this._progressDirty = false;
        this._timer = null;
        this._retryTimer = null;
        this._persisting = false;
        this._sending = false;
        this._pending = null;      // latest wire not yet accepted by the transport
        this._lastSentAt = 0;
        this._failures = 0;
        this._persistFailures = 0;
        this._stopped = false;
        this._detach = [];

        this._unsubscribe = signals.on('*', (_payload, name) => {
            // Our own save announces itself too. It is the result of a flush,
            // not a new change, and reacting to it would flush forever.
            if (name === SIGNALS.STATE_SAVED && this._persisting) return;
            this._markDirty(PROGRESS_SIGNALS.has(name));
        });
    }

    /** The newest report that has not been accepted yet, if any. For tests and diagnostics. */
    get pending() {
        return this._pending;
    }

    _markDirty(progressChanged) {
        if (this._stopped) return;
        this._reportDirty = true;
        if (progressChanged) this._progressDirty = true;
        if (this._timer != null) return;
        const sinceLast = this._clock.now() - this._lastSentAt;
        const wait = Math.max(this.windowMs, this._lastSentAt ? this.minIntervalMs - sinceLast : 0);
        this._timer = this._timers.setTimeout(() => {
            this._timer = null;
            this.flush();
        }, wait);
    }

    /**
     * Build and send now. Called by the scheduled timer, by the lifecycle hooks
     * with `terminal: true`, and by tests.
     */
    flush({terminal = false} = {}) {
        if (this._stopped) return;
        if (this._timer != null) {
            this._timers.clearTimeout(this._timer);
            this._timer = null;
        }
        const enabled = !!this._transport?.enabled;
        const progress = this._source.progress();

        if ((this._reportDirty || this._progressDirty) && progress) {
            const needSave = this._progressDirty || enabled;
            const previous = progress.revision || 0;
            if (enabled) progress.revision = previous + 1;
            if (needSave && !this._persist()) {
                // The reservation did not reach storage (quota, private mode).
                // Sending it anyway would let a reload hand the same revision to
                // different content, so give it back, keep the changes dirty,
                // and try again later. Nothing is sent until a save succeeds.
                progress.revision = previous;
                this._persistFailures++;
                this._scheduleRetry(this._persistFailures);
                return;
            }
            this._persistFailures = 0;
            this._reportDirty = false;
            this._progressDirty = false;
            if (enabled) {
                try {
                    this._pending = toWire(project({
                        state: this._source.state(),
                        progress,
                        activity: this._source.activity(),
                        catalogue: this._source.catalogue(),
                        identity: this._source.identity(),
                        now: this._clock.now(),
                        revision: progress.revision,
                    }));
                } catch (err) {
                    this._warn('projection failed', err);
                }
            }
        }

        if (enabled && this._pending) this._send(this._pending, terminal);
    }

    /** @returns {boolean} whether the state reached storage */
    _persist() {
        this._persisting = true;
        try {
            const ok = this._source.persist() !== false;
            if (!ok) this._warn('persist failed', 'storage refused the write');
            return ok;
        } catch (err) {
            this._warn('persist failed', err);
            return false;
        } finally {
            this._persisting = false;
        }
    }

    _send(wire, terminal) {
        // One request in flight. A newer snapshot waits for it and then goes,
        // so reports cannot overtake each other on a slow network. A terminal
        // send does not wait: the page may be gone before the first returns.
        if (this._sending && !terminal) return;
        this._sending = true;
        const done = (ok, err) => {
            this._sending = false;
            if (this._stopped) return;
            if (ok) {
                if (this._pending === wire) this._pending = null;
                this._lastSentAt = this._clock.now();
                this._failures = 0;
                const dirty = this._reportDirty || this._progressDirty;
                // A retry scheduled for something still outstanding (a newer
                // change whose save failed while this was on the wire) must
                // survive this success; only an idle reporter drops its retry.
                if (this._retryTimer != null && !dirty && !this._pending) {
                    this._timers.clearTimeout(this._retryTimer);
                    this._retryTimer = null;
                }
                // Something newer arrived, or is still waiting, while this was on the wire.
                if ((this._pending || dirty) && this._timer == null && this._retryTimer == null) {
                    this._timer = this._timers.setTimeout(() => {
                        this._timer = null;
                        this.flush();
                    }, this.windowMs);
                }
            } else {
                this._failures++;
                this._warn('send failed', err);
                // Terminal too: if the page survives (the tab came back), the
                // unsent report must still go without waiting for a new signal.
                this._scheduleRetry(this._failures);
            }
        };
        let result;
        try {
            result = this._transport.send(wire, {terminal});
        } catch (err) {
            done(false, err);
            return;
        }
        if (result && typeof result.then === 'function') {
            result.then(() => done(true), (err) => done(false, err));
        } else {
            done(true);
        }
    }

    /** Backoff by the number of consecutive failures of whatever is being retried. */
    _scheduleRetry(failures) {
        if (this._stopped || this._retryTimer != null) return;
        const delay = this.retryMs[Math.min(Math.max(failures, 1) - 1, this.retryMs.length - 1)];
        this._retryTimer = this._timers.setTimeout(() => {
            this._retryTimer = null;
            this.flush();
        }, delay);
    }

    /**
     * Send on the way out: tab hidden (primary on iOS), page hidden (backup),
     * and ask for a fresh report when a page comes back from the bfcache.
     * @returns {() => void} detach
     */
    attachLifecycle(win = globalThis.window, doc = globalThis.document) {
        const add = (target, type, fn) => {
            if (!target?.addEventListener) return;
            target.addEventListener(type, fn);
            this._detach.push(() => target.removeEventListener(type, fn));
        };
        add(doc, 'visibilitychange', () => {
            if (doc.visibilityState === 'hidden') this.flush({terminal: true});
        });
        add(win, 'pagehide', () => this.flush({terminal: true}));
        add(win, 'pageshow', (e) => {
            if (e?.persisted) this._markDirty(false);
        });
        return () => this.stop();
    }

    /** Stop listening and cancel timers. Pending data stays in `pending`. */
    stop() {
        this._stopped = true;
        this._unsubscribe?.();
        this._unsubscribe = null;
        this._detach.forEach(fn => fn());
        this._detach = [];
        if (this._timer != null) this._timers.clearTimeout(this._timer);
        if (this._retryTimer != null) this._timers.clearTimeout(this._retryTimer);
        this._timer = this._retryTimer = null;
    }

    _warn(msg, err) {
        try {
            console.warn('[dashboard]', msg, err);
        } catch { /* noop */
        }
    }
}
