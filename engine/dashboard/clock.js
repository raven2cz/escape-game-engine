// engine/dashboard/clock.js
//
// The only place the dashboard layer reads the time. Injected everywhere, so a
// test can move time by hand instead of sleeping, and so "what time is it" is a
// dependency you can see rather than a global you cannot.
//
// It is the tablet's clock. A tablet that sleeps through a break counts the
// break; the dashboard treats times as a teaching hint, not a stopwatch.

export const systemClock = Object.freeze({
    now: () => Date.now(),
});

/** A clock a test drives by hand. */
export function manualClock(start = 1_700_000_000_000) {
    let t = start;
    return {
        now: () => t,
        set: (value) => { t = value; },
        advance: (ms) => { t += ms; return t; },
    };
}
