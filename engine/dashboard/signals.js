// engine/dashboard/signals.js
//
// The observation seam between the engine and everything that watches it. The
// engine *publishes* a named signal at a transition it already funnels through
// (a scene committed, a puzzle evaluated, an item consumed) and knows nothing
// about who listens. See plans/EI-010-DESIGN-API.md §4.1.
//
// Publishing is synchronous and cheap on purpose. The subscribers that run in
// that moment are O(1): the progress model writes a few integers, the reporter
// sets a dirty flag. Everything expensive (projection, serialisation, network)
// happens later, in the reporter's deferred flush.
//
// A subscriber that throws must never reach the engine. A broken dashboard is
// an annoyance; a broken lesson is a refund.

/** Every signal the engine publishes. A typo in an emit() is a bug, so they are named once. */
export const SIGNALS = Object.freeze({
    RUN_STARTED: 'run:started',
    SCENE_ENTERED: 'scene:entered',
    PUZZLE_OPENED: 'puzzle:opened',
    PUZZLE_SETTLED: 'puzzle:settled',
    PUZZLE_EVALUATED: 'puzzle:evaluated',
    PUZZLE_SOLVED: 'puzzle:solved',
    ITEM_GIVEN: 'item:given',
    ITEM_USED: 'item:used',
    DIALOG_ENDED: 'dialog:ended',
    RUN_COMPLETED: 'run:completed',
    CATALOGUE_READY: 'catalogue:ready',
    STATE_SAVED: 'state:saved',
});

export class GameSignals {
    constructor() {
        /** @type {Map<string, Set<Function>>} */
        this._subs = new Map();
        /** Listeners for every signal, in subscription order. */
        this._any = new Set();
    }

    /**
     * Subscribe to one signal, or to every signal with '*'.
     * @returns {() => void} unsubscribe
     */
    on(name, fn) {
        if (typeof fn !== 'function') throw new TypeError('GameSignals.on needs a function');
        if (name === '*') {
            this._any.add(fn);
            return () => this._any.delete(fn);
        }
        let set = this._subs.get(name);
        if (!set) {
            set = new Set();
            this._subs.set(name, set);
        }
        set.add(fn);
        return () => set.delete(fn);
    }

    /** Publish. Never throws, whatever a subscriber does. */
    emit(name, payload = {}) {
        const direct = this._subs.get(name);
        if (direct) {
            for (const fn of [...direct]) this._call(fn, name, payload);
        }
        for (const fn of [...this._any]) this._call(fn, name, payload);
    }

    _call(fn, name, payload) {
        try {
            fn(payload, name);
        } catch (err) {
            try {
                console.warn('[signals] subscriber failed on', name, err);
            } catch { /* a console that throws is not our problem */
            }
        }
    }
}
