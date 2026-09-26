// engine/dashboard/transports.js
//
// Where a report goes. The engine never picks a destination on its own: the
// default is NullTransport, so a tablet sends pupil data nowhere unless whoever
// hosts the game wires a transport in explicitly. See docs/DASHBOARD-API.md.
//
// The contract, for anyone writing another one:
//
//   send(wire, {terminal}) -> void | Promise<void>
//
//   - `wire` is the output of toWire(): a plain DashboardReport, nothing else.
//   - Resolve (or return) on success; throw or reject on failure. The reporter
//     keeps the latest unsent report and retries it.
//   - `terminal: true` is the page going away. Use whatever survives unload.
//   - URL, credentials and retry-at-the-HTTP-level belong in here, never in the
//     engine. The server must bind session and team from its own authenticated
//     context; the ids inside a report are hints for correlation, not trust.
//   - `enabled: false` tells the reporter not to build reports at all.

/** Sends nothing. The default. */
export class NullTransport {
    get enabled() {
        return false;
    }

    send() { /* by design */
    }
}

/**
 * POSTs each report as JSON. For the hosted runtime and the dev server.
 *
 * A normal send is a `fetch` with `keepalive`. A terminal send uses
 * `navigator.sendBeacon` when there are no custom headers (a beacon cannot carry
 * them), and a keepalive fetch otherwise. A beacon that the browser refuses
 * (`false`, e.g. a full queue) is reported as a failure, not swallowed.
 */
export class HttpTransport {
    /**
     * @param {object} opts
     * @param {string} opts.url
     * @param {Record<string,string>} [opts.headers]
     * @param {typeof fetch} [opts.fetch]
     * @param {(url: string, data: any) => boolean} [opts.sendBeacon]
     */
    constructor({url, headers = {}, fetch: fetchImpl, sendBeacon} = {}) {
        if (!url) throw new Error('HttpTransport needs a url');
        this.url = url;
        this.headers = {...headers};
        this._fetch = fetchImpl || globalThis.fetch?.bind(globalThis);
        this._beacon = sendBeacon
            || (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
                ? navigator.sendBeacon.bind(navigator)
                : null);
    }

    get enabled() {
        return true;
    }

    async send(wire, {terminal = false} = {}) {
        const body = JSON.stringify(wire);
        const custom = Object.keys(this.headers).length > 0;
        if (terminal && this._beacon && !custom) {
            const blob = typeof Blob !== 'undefined' ? new Blob([body], {type: 'application/json'}) : body;
            if (!this._beacon(this.url, blob)) throw new Error('beacon refused');
            return;
        }
        if (!this._fetch) throw new Error('no fetch available');
        const res = await this._fetch(this.url, {
            method: 'POST',
            headers: {'content-type': 'application/json', ...this.headers},
            body,
            keepalive: true,
            credentials: 'same-origin',
        });
        if (!res || !res.ok) throw new Error(`report rejected: ${res?.status ?? 'no response'}`);
    }
}

/** Storage key under which LocalBoardTransport keeps a team's latest report. */
export function localBoardKey(wire) {
    const part = (v) => encodeURIComponent(v ?? '');
    return `dashboard:report:${part(wire.game)}:${part(wire.session)}:${part(wire.team)}`;
}

/**
 * For a board open in another tab of the same browser: the dev loop, and a
 * teacher testing a game on one machine. Writes the latest report per team to
 * localStorage (so a board opened later sees the current picture) and announces
 * it on a BroadcastChannel (so an open board updates at once).
 */
export class LocalBoardTransport {
    constructor({channel = 'escape-dashboard', storage} = {}) {
        this._storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
        this._channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channel) : null;
    }

    get enabled() {
        return true;
    }

    send(wire) {
        const json = JSON.stringify(wire);
        this._storage?.setItem(localBoardKey(wire), json);
        this._channel?.postMessage(json);
    }
}
