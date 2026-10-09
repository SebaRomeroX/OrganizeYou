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
import { store, cycles, render, setNow, resetApp, RealDate } from "./app-harness.js";

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
