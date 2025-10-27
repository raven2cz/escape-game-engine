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
