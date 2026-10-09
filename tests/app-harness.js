// tests/app-harness.js - headless boot of the real app modules.
//
// The reset-lifecycle suite exercises the REAL engine end to end
// (state -> storage -> cycles -> render), so the harness stands in
// for the three browser globals the modules expect and then imports
// those modules for real:
//
//   1. Date - logic.js reads "now" through `new Date()`, cycles.js
//      and storage.js through `Date.now()`. The fake clock lets a
//      test cross a cycle boundary deterministically.
//   2. localStorage - storage.js persists on every command; an
//      in-memory Map isolates the tests and makes the reload test
//      (hydrate from a previous session's bytes) possible.
//   3. document - render.js grabs elements at module scope and
//      rebuilds the list on every command; a tiny stub element tree
//      absorbs that without a real DOM.
//
// The stubs go in BEFORE the dynamic imports because render.js
// touches document at module scope. logic.js itself is already
// loaded by tests/helpers.js (timezone pin) - importing the same
// specifier here resolves to the same module instance, so
// setAnchor() from the helpers drives the app's calendar math too.
//
// Each test file runs in its own process under `node --test`, so
// the global patches never leak into the other suites.

const RealDate = Date;

/* ---------- Fake clock ---------- */

// Monday, Oct 5 2026, 10:00 local - a plain weekday morning; the
// default anchor (00:00) puts the next boundary at Oct 6 00:00
let now = new RealDate(2026, 9, 5, 10, 0, 0, 0).getTime();

function setNow(value) {
  now = value instanceof RealDate ? value.getTime() : value;
}

function FakeDate(...args) {
  // Called as a function the native Date returns a timestamp string;
  // the app only ever uses `new Date()` (no args = "now") and
  // `new Date(y, m, ...)`, both covered here
  if (!new.target) return new RealDate(now).toString();
  return args.length === 0 ? new RealDate(now) : new RealDate(...args);
}
FakeDate.now = () => now;
FakeDate.parse = RealDate.parse;
FakeDate.UTC = RealDate.UTC;
FakeDate.prototype = RealDate.prototype;
globalThis.Date = FakeDate;

/* ---------- localStorage ---------- */

const memory = new Map();

globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => void memory.set(key, String(value)),
  removeItem: (key) => void memory.delete(key),
  clear: () => void memory.clear(),
};

/* ---------- document ---------- */

class StubElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.className = "";
    this.textContent = "";
    this.checked = false;
    this.disabled = false;
    this.classList = { toggle() {}, add() {}, remove() {} };
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  setAttribute() {}
  addEventListener() {}
}

// getElementById memoizes so render.js' module-scope handles stay
// valid across renders; querySelectorAll returns nothing (stats
// cells etc. simply don't exist - renderStats tolerates that)
const elements = new Map();

globalThis.document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, new StubElement("div"));
    return elements.get(id);
  },
  createElement: (tag) => new StubElement(tag),
  querySelectorAll: () => [],
};

/* ---------- Boot the real modules ---------- */

const state = await import("../state.js");
const storage = await import("../storage.js");
const cycles = await import("../cycles.js");
const render = await import("../render.js");

// Fresh session: clock at `at`, empty storage, default anchor.
// hydrate() reads the (now empty) storage and re-bridges the
// globals logic.js consumes at call time.
function resetApp(at = new RealDate(2026, 9, 5, 10, 0, 0, 0)) {
  setNow(at);
  globalThis.localStorage.clear();
  storage.hydrate();
}

export { state, storage, cycles, render, setNow, resetApp, RealDate };
export const store = state.store;
