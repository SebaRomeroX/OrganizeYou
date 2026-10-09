// OrganizeYou - recurring cycle engine (ES module)
//
// Keeps every cycle task's dueAt in sync with its progress and
// resets the ones whose time has come. Calendar math itself lives
// in logic.js (nextCycleBoundary / streakOnBoundary).
//
// Deliberately does NOT render: callers decide when the DOM needs
// updating, which keeps this file free of a cycles -> render edge.
import { store } from "./state.js";
import { saveTasks } from "./storage.js";
import { nextCycleBoundary, streakOnBoundary } from "./logic.js";

// Keep cycle.dueAt in sync with the task's progress: a done task
// is due at the next boundary, an active one WITH partial progress
// too (so stale ticks clear when the cycle turns over), one
// without progress has nothing pending.
export function syncCycleDue(task) {
  if (!task.cycle) return;
  // A dueAt that already passed stays: resetDueCycles() clears the
  // stale state at the next tick instead of losing the deadline
  if (task.cycle.dueAt != null && task.cycle.dueAt <= Date.now()) return;
  if (task.done) {
    task.cycle.dueAt = nextCycleBoundary(task.cycle);
    return;
  }
  // Undone: only partial progress needs a pending reset
  const progress =
    (task.repeats != null && task.repeats.current > 0) || task.subtasks.some((s) => s.done);
  if (!progress) {
    task.cycle.dueAt = null;
    return;
  }
  // Calendar units reset at the next anchor-aware boundary; an
  // hourly cycle counts N hours from the FIRST partial tick (later
  // ticks don't push the moment away)
  if (task.cycle.unit !== "hour" || task.cycle.dueAt == null) {
    task.cycle.dueAt = nextCycleBoundary(task.cycle);
  }
}

// Clear one cycle task's progress at its boundary: main flag,
// repeat counter AND subtask ticks together, so the task restarts
// as a whole (streak rides along - it must see `done` first)
function resetCycleTask(t) {
  streakOnBoundary(t); // must see `done` before it is cleared
  t.done = false;
  if (t.repeats) t.repeats.current = 0;
  t.subtasks.forEach((s) => (s.done = false));
  t.cycle.dueAt = null;
}

// Reset every cycle task whose time has come (progress cleared),
// no matter whether it was completed or only partially started.
// Returns true if anything changed - the caller re-renders then.
export function resetDueCycles() {
  const now = Date.now();
  let changed = false;
  store.tasks.forEach((t) => {
    if (t.cycle && t.cycle.dueAt != null && now >= t.cycle.dueAt) {
      resetCycleTask(t);
      changed = true;
    }
  });
  if (changed) saveTasks();
  return changed;
}

// At load, reconcile cycle tasks the boundary engine never got a
// deadline for: orphan progress from earlier versions (partial
// tasks used to be saved without a dueAt) is reset on sight -
// scheduling it now would keep the stale ticks around for a whole
// extra cycle - and every other started-but-unfinished task gets
// its pending reset scheduled. Returns true if anything changed.
export function backfillPartialCycles() {
  let changed = false;
  store.tasks.forEach((t) => {
    if (!t.cycle || t.done) return;
    const progress = (t.repeats != null && t.repeats.current > 0) || t.subtasks.some((s) => s.done);
    if (progress && t.cycle.dueAt == null) {
      resetCycleTask(t);
      changed = true;
      return;
    }
    const before = t.cycle.dueAt;
    syncCycleDue(t);
    if (t.cycle.dueAt !== before) changed = true;
  });
  if (changed) saveTasks();
  return changed;
}

// Re-anchor pending cycle resets after the global setting changed;
// runs the reset check right away so an anchor that already passed
// fires immediately. Returns true if a task actually reset.
export function applyCycleAnchor() {
  let changed = false;
  store.tasks.forEach((t) => {
    // Re-anchor done tasks and started-but-unfinished ones (their
    // pending partial reset follows the anchor too); clean undone
    // tasks have no dueAt and stay untouched
    if (t.cycle && t.cycle.unit !== "hour" && (t.done || t.cycle.dueAt != null)) {
      const due = nextCycleBoundary(t.cycle);
      if (t.cycle.dueAt !== due) {
        t.cycle.dueAt = due;
        changed = true;
      }
    }
  });
  if (changed) saveTasks();
  return resetDueCycles();
}
