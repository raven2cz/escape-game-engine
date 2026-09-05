// games/tests/setup.localstorage.js
// Simple in-memory localStorage polyfill for Vitest (Node) runs.
// Some environments expose a stub without methods; we ensure a real implementation exists.

class MemoryStorage {
  constructor() { this._m = new Map(); }
  get length() { return this._m.size; }
  key(n) { return Array.from(this._m.keys())[n] ?? null; }
  getItem(k) { k = String(k); return this._m.has(k) ? this._m.get(k) : null; }
  setItem(k, v) { this._m.set(String(k), String(v)); }
  removeItem(k) { this._m.delete(String(k)); }
  clear() { this._m.clear(); }
}

const ensureStorage = () => {
  const store = new MemoryStorage();
  // attach to global and window (if present)
  globalThis.localStorage = store;
  if (globalThis.window) {
    globalThis.window.localStorage = store;
  } else {
    // minimal window shim for code paths that check window.localStorage
    globalThis.window = { localStorage: store };
  }
};

ensureStorage();

// Optional: silence unhandled pointer events in JSDOM <-> Node
if (!globalThis.PointerEvent) {
  globalThis.PointerEvent = class extends Event {
    constructor(type, opts = {}) { super(type, opts); Object.assign(this, opts); }
  };
}

// jsdom does not fetch images, so neither `load` nor `error` ever fires on an
// <img>. Any engine code that awaits a load therefore hangs forever, and the test
// times out somewhere unrelated to the actual assertion. Individual test files
// used to work around this one by one; doing it here means a new test does not
// have to know about it.
//
// A test that needs a failing image (see EI-003) can override this descriptor.
if (globalThis.HTMLImageElement) {
  Object.defineProperty(globalThis.HTMLImageElement.prototype, 'src', {
    configurable: true,
    get() { return this.getAttribute('src') || ''; },
    set(value) {
      this.setAttribute('src', value);
      // Asynchronously, like a real browser: code that assigns `src` and then
      // attaches `onload` must still see the event.
      setTimeout(() => {
        // Reload tests deliberately abandon a run that is blocked on the player,
        // so a suspended continuation can still assign `src` after the test file
        // is done and jsdom has been torn down. Dispatching then throws, and the
        // failure has nothing to do with the assertions. Swallow only that.
        try {
          this.dispatchEvent(new Event('load'));
        } catch { /* environment already torn down */ }
      }, 0);
    },
  });
}

// jsdom has no ResizeObserver. The match puzzle in column mode uses it, which is
// a standard browser API, not a bug. Stub it so the puzzle can mount; layout is
// not what those tests assert.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
