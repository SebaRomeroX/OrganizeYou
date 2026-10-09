// OrganizeYou - localStorage persistence (ES module)
//
// Keys, validation/migrations on load and every save. Loaders are
// defensive: corrupt JSON or broken entries fall back to empty
// data instead of crashing (see roadmap goal 1).
import { CYCLE_UNITS, store } from "./state.js";
import { defaultCycleAnchor, nextCycleBoundary, normalizeCycleAnchor } from "./logic.js";

const TASKS_KEY = "organizeyou.tasks";
const CATEGORIES_KEY = "organizeyou.categories";
const CYCLE_ANCHOR_KEY = "organizeyou.cycleAnchor";
const DONE_LOG_KEY = "organizeyou.doneLog";

function loadTasks() {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // Migrate tasks created before repeats/subtasks existed
    return parsed.map((t) => {
      const repeats =
        t.repeats && typeof t.repeats.target === "number" && t.repeats.target >= 1
          ? {
              current: Math.min(Math.max(0, Number(t.repeats.current) || 0), t.repeats.target),
              target: t.repeats.target,
            }
          : null;
      const subtasks = Array.isArray(t.subtasks)
        ? t.subtasks.map((s) => ({
            id: s.id || makeId(),
            text: String(s.text || ""),
            done: !!s.done,
          }))
        : [];
      // Normalize the done flag for repetition/subtask tasks
      let done = !!t.done;
      if (repeats) done = repeats.current >= repeats.target;
      else if (subtasks.length > 0) done = subtasks.every((s) => s.done);

      // Cycle: valid schedule object or null
      const cycle =
        t.cycle &&
        CYCLE_UNITS.includes(t.cycle.unit) &&
        Number(t.cycle.every) >= 1
          ? {
              every: Math.floor(Number(t.cycle.every)),
              unit: t.cycle.unit,
              dueAt: Number.isFinite(t.cycle.dueAt) ? t.cycle.dueAt : null,
            }
          : null;
      // A done cycle task with no dueAt is unknown data: treat as
      // completed now. Past dueAts are left alone (reset engine
      // handles them right after load).
      if (cycle && done && cycle.dueAt == null) {
        cycle.dueAt = nextCycleBoundary(cycle);
      }

      // Deadline / appointment: "YYYY-MM-DD" (deadline ends that day,
      // appointment starts it) or "YYYY-MM-DDTHH:mm". Mutually
      // exclusive; deadline wins on hand-edited data.
      const validDue = (v) =>
        typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(v);
      const deadline = validDue(t.deadline) ? t.deadline : null;
      const appointment = !deadline && validDue(t.appointment) ? t.appointment : null;
      // Time since: an independent record (same string forms),
      // valid value or null - no exclusivity with the two above
      const since = validDue(t.since) ? t.since : null;

      // Streak (goal 14): non-negative integer, 0 = none yet.
      // Hour cycles never count, but the field stays on the task
      const streak = Number.isFinite(t.streak) && t.streak >= 1 ? Math.floor(t.streak) : 0;

      return { ...t, tags: Array.isArray(t.tags) ? t.tags : [], repeats, subtasks, cycle, deadline, appointment, since, streak, done };
    });
  } catch {
    return [];
  }
}

function loadCategories() {
  try {
    const raw = localStorage.getItem(CATEGORIES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Completion history for the done counter: [{ id, t }]. Validated
// on load (broken entries dropped), default []
function loadDoneLog() {
  try {
    const raw = localStorage.getItem(DONE_LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && typeof e.id === "string" && Number.isFinite(e.t));
  } catch {
    return [];
  }
}

export function saveTasks() {
  localStorage.setItem(TASKS_KEY, JSON.stringify(store.tasks));
}

export function saveCategories() {
  localStorage.setItem(CATEGORIES_KEY, JSON.stringify(store.categories));
}

export function saveDoneLog() {
  localStorage.setItem(DONE_LOG_KEY, JSON.stringify(store.doneLog));
}

// Keep the done counter log in step with USER-driven transitions:
// becoming done pushes an entry, undoing removes that task's most
// recent one. Automatic cycle resets never call this - the
// completion stands and the task simply restarts.
export function logDoneChange(id, done) {
  if (done) {
    store.doneLog.push({ id, t: Date.now() });
  } else {
    for (let i = store.doneLog.length - 1; i >= 0; i--) {
      if (store.doneLog[i].id === id) {
        store.doneLog.splice(i, 1);
        break;
      }
    }
  }
  saveDoneLog();
}

export function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---------- Settings: global cycle anchor ---------- */

export function loadCycleAnchor() {
  try {
    const raw = localStorage.getItem(CYCLE_ANCHOR_KEY);
    return normalizeCycleAnchor(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultCycleAnchor();
  }
}

export function saveCycleAnchor() {
  localStorage.setItem(CYCLE_ANCHOR_KEY, JSON.stringify(store.cycleAnchor));
}

// Read everything from localStorage into the store. The anchor is
// hydrated FIRST and bridged onto globalThis before loadTasks():
// that loader's migration calls nextCycleBoundary, which reads the
// bare `cycleAnchor` global at call time (ESM is strict - an
// unbridged read would throw). `doneLog` is only read by the
// counters, so its bridge can wait. Both objects are mutated in
// place afterwards (push / splice / Object.assign), never
// reassigned, so one bridge is enough for the whole session.
export function hydrate() {
  store.cycleAnchor = loadCycleAnchor();
  globalThis.cycleAnchor = store.cycleAnchor;
  store.tasks = loadTasks();
  store.categories = loadCategories();
  store.doneLog = loadDoneLog();
  globalThis.doneLog = store.doneLog;
}
