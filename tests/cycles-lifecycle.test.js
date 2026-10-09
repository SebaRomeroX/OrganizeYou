// Reset lifecycle: what the boundary reset must actually clear.
//
// tests/cycles.test.js covers the boundary MATH; this suite drives
// the real modules (see app-harness.js) through the full life of a
// cycle task - tick, complete, cross the boundary, reload - and
// asserts the reset clears the WHOLE compound state: main flag,
// repeat counter AND subtask ticks together.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetAnchor } from "./helpers.js";
import { store, storage, cycles, render, setNow, resetApp, RealDate } from "./app-harness.js";

const at = (y, m, d, h = 0, min = 0) => new RealDate(y, m, d, h, min, 0, 0).getTime();

// A daily compound task as the task modal creates it: repeats +
// subtasks + cycle combined
function addCompound(subCount = 3, target = subCount) {
  render.addTask("compound", [], {
    repeats: { current: 0, target },
    subtasks: Array.from({ length: subCount }, (_, i) => ({
      id: `sub${i}`,
      text: `sub ${i}`,
      done: false,
    })),
    cycle: { every: 1, unit: "day", dueAt: null },
  });
  return store.tasks.at(-1);
}

beforeEach(() => {
  resetApp();
  resetAnchor();
});

describe("daily compound task (repeats + subtasks + cycle)", () => {
  it("resets fully at the boundary when completed via the main checkbox", () => {
    const t = addCompound(3);

    render.toggleSubtask(t.id, "sub0");
    render.toggleSubtask(t.id, "sub1");
    render.toggleTask(t.id); // main tick completes: counter fills to 3/3

    assert.equal(t.done, true);
    assert.equal(t.repeats.current, 3);
    assert.equal(t.cycle.dueAt, at(2026, 9, 6)); // next midnight, default anchor

    // The app closes; the boundary (Oct 6, 00:00) passes unnoticed
    setNow(at(2026, 9, 6, 0, 5));

    assert.equal(cycles.resetDueCycles(), true);
    assert.equal(t.done, false, "main flag restarts unticked");
    assert.equal(t.repeats.current, 0, "counter restarts at 0");
    assert.ok(
      t.subtasks.every((s) => !s.done),
      "every subtask tick is cleared"
    );
    assert.equal(t.cycle.dueAt, null, "nothing pending after the reset");
  });

  it("resets fully at the boundary when completed via the subtasks", () => {
    const t = addCompound(3);

    // Every subtask tick grows the counter; the third completes it
    render.toggleSubtask(t.id, "sub0");
    render.toggleSubtask(t.id, "sub1");
    render.toggleSubtask(t.id, "sub2");

    assert.equal(t.done, true);
    assert.equal(t.repeats.current, 3);
    assert.ok(t.subtasks.every((s) => s.done));
    assert.equal(t.cycle.dueAt, at(2026, 9, 6));

    setNow(at(2026, 9, 6, 0, 5));

    assert.equal(cycles.resetDueCycles(), true);
    assert.equal(t.done, false);
    assert.equal(t.repeats.current, 0);
    assert.ok(
      t.subtasks.every((s) => !s.done),
      "every subtask tick is cleared"
    );
    assert.equal(t.cycle.dueAt, null);
  });
});

describe("subtask-only daily task (subtasks + cycle, no repeats)", () => {
  it("clears every subtask at the boundary", () => {
    render.addTask("english", [], {
      subtasks: [
        { id: "s0", text: "out loud", done: false },
        { id: "s1", text: "duo", done: false },
      ],
      cycle: { every: 1, unit: "day", dueAt: null },
    });
    const t = store.tasks.at(-1);

    render.toggleSubtask(t.id, "s0");
    render.toggleSubtask(t.id, "s1");

    assert.equal(t.done, true, "all subtasks ticked completes it");
    assert.equal(t.cycle.dueAt, at(2026, 9, 6));

    setNow(at(2026, 9, 6, 0, 5));

    assert.equal(cycles.resetDueCycles(), true);
    assert.equal(t.done, false);
    assert.ok(
      t.subtasks.every((s) => !s.done),
      "every subtask tick is cleared"
    );
    assert.equal(t.cycle.dueAt, null);
  });
});

describe("partial progress", () => {
  it("clears ticked subtasks and counter at the boundary even if never completed", () => {
    const t = addCompound(4, 5);

    render.toggleSubtask(t.id, "sub1");
    render.toggleSubtask(t.id, "sub2");

    assert.equal(t.done, false, "below target: still pending");
    assert.equal(t.repeats.current, 2);
    // Partial progress is scheduled too - stale ticks must clear
    // when the cycle turns over
    assert.equal(t.cycle.dueAt, at(2026, 9, 6));

    setNow(at(2026, 9, 6, 0, 5));

    assert.equal(cycles.resetDueCycles(), true);
    assert.equal(t.done, false);
    assert.equal(t.repeats.current, 0);
    assert.ok(
      t.subtasks.every((s) => !s.done),
      "stale subtask ticks are cleared"
    );
    assert.equal(t.cycle.dueAt, null);
  });
});

describe("real-data fixture (observed in the wild)", () => {
  it("resets the math task shape: 4 subtasks, target 5, subs [o x x o] done via main", () => {
    // The exact persisted state from the bug report's browser data:
    // "math", repeats 5/5, subtasks [go class, theory, practice,
    // review] with [theory, practice] ticked, daily cycle
    render.addTask("math", [], {
      repeats: { current: 0, target: 5 },
      subtasks: [
        { id: "go", text: "go class", done: false },
        { id: "th", text: "theory", done: false },
        { id: "pr", text: "practice exercises", done: false },
        { id: "re", text: "review", done: false },
      ],
      cycle: { every: 1, unit: "day", dueAt: null },
    });
    const t = store.tasks.at(-1);

    render.toggleSubtask(t.id, "th");
    render.toggleSubtask(t.id, "pr");
    render.toggleTask(t.id); // main tick fills the counter to the target

    // Mirrors the persisted record byte for byte
    assert.deepEqual(
      {
        done: t.done,
        counter: `${t.repeats.current}/${t.repeats.target}`,
        subs: t.subtasks.map((s) => (s.done ? "x" : "o")).join(""),
      },
      { done: true, counter: "5/5", subs: "oxxo" }
    );
    assert.equal(t.cycle.dueAt, at(2026, 9, 6));

    setNow(at(2026, 9, 6, 0, 5));

    assert.equal(cycles.resetDueCycles(), true);
    assert.deepEqual(
      {
        done: t.done,
        counter: `${t.repeats.current}/${t.repeats.target}`,
        subs: t.subtasks.map((s) => (s.done ? "x" : "o")).join(""),
        dueAt: t.cycle.dueAt,
      },
      { done: false, counter: "0/5", subs: "oooo", dueAt: null }
    );
  });
});

describe("app closed across the boundary", () => {
  it("starts clean on reload: hydrate + backfill + reset, the app.js boot order", () => {
    const t = addCompound(3);
    render.toggleSubtask(t.id, "sub0");
    render.toggleTask(t.id);
    assert.equal(t.done, true);

    // The app closes with everything persisted; the boundary passes
    // unnoticed
    setNow(at(2026, 9, 6, 0, 5));

    // Exactly what app.js runs on boot
    storage.hydrate();
    cycles.backfillPartialCycles();
    cycles.resetDueCycles();

    const loaded = store.tasks.find((x) => x.text === "compound");
    assert.notEqual(loaded, t, "state came fresh from storage, not memory");
    assert.equal(loaded.done, false);
    assert.equal(loaded.repeats.current, 0);
    assert.ok(loaded.subtasks.every((s) => !s.done));
    assert.equal(loaded.cycle.dueAt, null);
  });
});

describe("app left open across boundaries", () => {
  it("resets on the first tick after the boundary, then re-resets every cycle", () => {
    const t = addCompound(3);

    // Day 1: complete
    render.toggleSubtask(t.id, "sub0");
    render.toggleSubtask(t.id, "sub1");
    render.toggleSubtask(t.id, "sub2");
    assert.equal(t.done, true);

    // The boundary passes while the tab stays open: the 60s tick
    // runs resetDueCycles() - first call resets, the next one is a
    // no-op (no re-render churn)
    setNow(at(2026, 9, 6, 0, 1));
    assert.equal(cycles.resetDueCycles(), true);
    assert.equal(cycles.resetDueCycles(), false, "already clean: nothing to reset");

    // Day 2: the user works the task again and completes it
    render.toggleSubtask(t.id, "sub0");
    render.toggleSubtask(t.id, "sub1");
    render.toggleSubtask(t.id, "sub2");
    assert.equal(t.done, true);
    assert.equal(t.repeats.current, 3);
    assert.equal(t.cycle.dueAt, at(2026, 9, 7));

    // Day 3 boundary: same full reset again
    setNow(at(2026, 9, 7, 0, 1));
    assert.equal(cycles.resetDueCycles(), true);
    assert.equal(t.done, false);
    assert.equal(t.repeats.current, 0);
    assert.ok(t.subtasks.every((s) => !s.done));
  });
});

describe("legacy states from earlier versions", () => {
  // KNOWN-RED repro (fixed in a later commit): backfillPartialCycles
  // currently schedules orphan progress at the NEXT boundary instead
  // of clearing it now, so main looks restarted while the subtasks
  // stay ticked for the rest of the day.
  it("resets orphan progress (ticked subtasks, no dueAt) immediately on load", () => {
    // Pre-cycle-engine versions saved partial tasks WITHOUT a
    // deadline: done=false, counter>0, subtasks ticked, dueAt null.
    // No boundary was ever attached to that progress, so it must be
    // cleaned on sight at load - not scheduled a cycle ahead.
    globalThis.localStorage.setItem(
      "organizeyou.tasks",
      JSON.stringify([
        {
          id: "legacy1",
          text: "legacy",
          done: false,
          tags: [],
          repeats: { current: 2, target: 4 },
          subtasks: [
            { id: "a", text: "a", done: true },
            { id: "b", text: "b", done: true },
            { id: "c", text: "c", done: false },
            { id: "d", text: "d", done: false },
          ],
          cycle: { every: 1, unit: "day", dueAt: null },
          deadline: null,
          appointment: null,
          since: null,
          streak: 0,
        },
      ])
    );

    // The app.js boot sequence
    storage.hydrate();
    cycles.backfillPartialCycles();
    cycles.resetDueCycles();

    const t = store.tasks[0];
    assert.equal(t.done, false);
    assert.equal(t.repeats.current, 0, "orphan counter cleared at load");
    assert.ok(
      t.subtasks.every((s) => !s.done),
      "orphan subtask ticks cleared at load"
    );
    assert.equal(t.cycle.dueAt, null);
  });
});
