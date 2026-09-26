// board/sources.js
//
// Where the board's reports come from. Each source hands every report it sees
// to `onReport(report, receivedAt)` and lets the ReportStore decide what is new.

import {localBoardKey} from '../engine/dashboard/transports.js';

const PREFIX = 'dashboard:report:';

/**
 * Tablets in other tabs of the same browser (LocalBoardTransport). Reads what
 * is already stored, then listens.
 */
export function localSource({onReport, storage = globalThis.localStorage, channel = 'escape-dashboard', now = () => Date.now()}) {
    const take = (json) => {
        try {
            onReport(JSON.parse(json), now());
        } catch { /* not a report */
        }
    };
    for (let i = 0; i < (storage?.length ?? 0); i++) {
        const key = storage.key(i);
        if (key?.startsWith(PREFIX)) take(storage.getItem(key));
    }
    const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channel) : null;
    if (bc) bc.onmessage = (e) => take(e.data);
    return {stop: () => bc?.close()};
}

/**
 * The dev server (or any server with the same GET): polls the latest report of
 * every team. The server's own receive time is used for "last seen".
 */
export function httpSource({url, onReport, intervalMs = 2000, fetchImpl = globalThis.fetch?.bind(globalThis), setTimer = setTimeout, clearTimer = clearTimeout}) {
    let timer = null;
    let stopped = false;
    const poll = async () => {
        try {
            const res = await fetchImpl(url, {cache: 'no-store'});
            if (res.ok) {
                const list = await res.json();
                for (const e of Array.isArray(list) ? list : []) onReport(e.report, e.receivedAt);
            }
        } catch { /* try again next time */
        }
        if (!stopped) timer = setTimer(poll, intervalMs);
    };
    poll();
    return {
        stop: () => {
            stopped = true;
            if (timer != null) clearTimer(timer);
        },
    };
}

export {localBoardKey};
