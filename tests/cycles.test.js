// Cycle boundary math: nextCycleBoundary, cycleLabel, anchor
// normalization. Mirrors the roadmap's goal 8 (hour = true
// elapsed), goal 9 (anchor-aware day/week/month) and goal 5
// (N>1 epoch phasing) harness claims.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextCycleBoundary, cycleLabel, normalizeCycleAnchor, defaultCycleAnchor, setAnchor, resetAnchor } from "./helpers.js";

const at = (y, m, d, h = 0, min = 0) => new Date(y, m, d, h, min, 0, 0);
const boundary = (cycle, from) => new Date(nextCycleBoundary(cycle, from));

describe("anchor settings", () => {
  it("default anchor reproduces the original boundaries", () => {
    assert.deepEqual(defaultCycleAnchor(), {
      time: "00:00",
      weekStartDay: 1,
      monthStartDay: 1,
      monthAnchor: 0,
    });
  });

  it("normalizes corrupt settings back to the defaults", () => {
    assert.deepEqual(normalizeCycleAnchor(null), defaultCycleAnchor());
    assert.deepEqual(normalizeCycleAnchor("junk"), defaultCycleAnchor());
    assert.deepEqual(normalizeCycleAnchor({}), defaultCycleAnchor());
    assert.deepEqual(
      normalizeCycleAnchor({ time: "99:99", weekStartDay: 42, monthStartDay: 0, monthAnchor: 99 }),
      defaultCycleAnchor()
    );
  });

  it("keeps valid settings", () => {
    assert.deepEqual(
      normalizeCycleAnchor({ time: "06:00", weekStartDay: 0, monthStartDay: 15, monthAnchor: 5 }),
      { time: "06:00", weekStartDay: 0, monthStartDay: 15, monthAnchor: 5 }
    );
  });
});

describe("hour cycles are true elapsed time (goal 8)", () => {
  it("adds N hours exactly", () => {
    // Roadmap harness cases: 10:30 + 2h -> 12:30, 23:30 + 2h -> 01:30
    assert.equal(boundary({ unit: "hour", every: 2 }, at(2026, 9, 8, 10, 30)).getTime(),
      at(2026, 9, 8, 12, 30).getTime());
    assert.equal(boundary({ unit: "hour", every: 2 }, at(2026, 9, 8, 23, 30)).getTime(),
      at(2026, 9, 9, 1, 30).getTime());
    assert.equal(boundary({ unit: "hour", every: 1 }, at(2026, 9, 8, 10, 30)).getTime(),
      at(2026, 9, 8, 11, 30).getTime());
    assert.equal(boundary({ unit: "hour", every: 24 }, at(2026, 9, 8, 10, 30)).getTime(),
      at(2026, 9, 9, 10, 30).getTime());
  });

  it("holds across spring-forward DST (2026-03-29 02:00 -> 03:00, Madrid)", () => {
    const from = at(2026, 2, 29, 1, 30);
    // True elapsed: +2h of real time lands on 04:30 wall clock,
    // because 02:00-03:00 does not exist that night
    assert.equal(boundary({ unit: "hour", every: 2 }, from).getTime(), from.getTime() + 2 * 3600000);
    assert.equal(boundary({ unit: "hour", every: 2 }, from).getHours(), 4);
  });

  it("holds across fall-back DST (2026-10-25 03:00 -> 02:00, Madrid)", () => {
    const from = at(2026, 9, 25, 2, 30);
    assert.equal(boundary({ unit: "hour", every: 2 }, from).getTime(), from.getTime() + 2 * 3600000);
  });

  it("ignores the anchor and clamps garbage every values to 1", () => {
    setAnchor({ time: "06:00" });
    assert.equal(boundary({ unit: "hour", every: 1 }, at(2026, 9, 8, 10, 30)).getTime(),
      at(2026, 9, 8, 11, 30).getTime());
    resetAnchor();
    assert.equal(boundary({ unit: "hour", every: 0 }, at(2026, 9, 8, 10)).getTime(),
      at(2026, 9, 8, 11).getTime());
    assert.equal(boundary({ unit: "hour", every: 2.9 }, at(2026, 9, 8, 10)).getTime(),
      at(2026, 9, 8, 12).getTime());
  });
});

describe("day cycles with the default anchor", () => {
  it("falls on the next local midnight", () => {
    assert.equal(boundary({ unit: "day", every: 1 }, at(2026, 9, 8, 15, 42)).getTime(),
      at(2026, 9, 9).getTime());
  });

  it("is strictly after an exact boundary (goal 9)", () => {
    assert.equal(boundary({ unit: "day", every: 1 }, at(2026, 9, 9)).getTime(),
      at(2026, 9, 10).getTime());
  });

  it("N > 1 phases periods to the epoch: dayNum % n === 0 (goal 5)", () => {
    const dayNum = (d) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
    for (const from of [at(2026, 9, 8), at(2026, 9, 9), at(2026, 9, 10, 23, 59)]) {
      const next = boundary({ unit: "day", every: 3 }, from);
      assert.equal(dayNum(next) % 3, 0, `boundary ${next} not phased to epoch`);
      assert.ok(next.getTime() > from.getTime());
      // Never skips a period: the boundary is within n days
      assert.ok(next.getTime() - from.getTime() <= 4 * 86400000);
    }
  });
});

describe("day cycles with a custom anchor (goal 9)", () => {
  it("uses the anchor start time", () => {
    setAnchor({ time: "06:00" });
    assert.equal(boundary({ unit: "day", every: 1 }, at(2026, 9, 8, 7)).getTime(),
      at(2026, 9, 9, 6).getTime());
    // Before the anchor time the same day still counts as upcoming
    assert.equal(boundary({ unit: "day", every: 1 }, at(2026, 9, 8, 5)).getTime(),
      at(2026, 9, 8, 6).getTime());
    resetAnchor();
  });
});

describe("week cycles", () => {
  it("starts on Monday by default", () => {
    assert.equal(boundary({ unit: "week", every: 1 }, at(2026, 9, 8)).getDay(), 1);
    assert.equal(boundary({ unit: "week", every: 1 }, at(2026, 9, 8)).getTime(),
      at(2026, 9, 12).getTime());
    // From an exact Monday midnight: strictly after -> next week
    assert.equal(boundary({ unit: "week", every: 1 }, at(2026, 9, 12)).getTime(),
      at(2026, 9, 19).getTime());
  });

  it("respects weekStartDay = 0 (Sunday)", () => {
    setAnchor({ weekStartDay: 0 });
    assert.equal(boundary({ unit: "week", every: 1 }, at(2026, 9, 8)).getTime(),
      at(2026, 9, 11).getTime());
    resetAnchor();
  });
});

describe("month cycles", () => {
  it("falls on the 1st by default", () => {
    assert.equal(boundary({ unit: "month", every: 1 }, at(2026, 9, 8)).getTime(),
      at(2026, 10, 1).getTime());
    assert.equal(boundary({ unit: "month", every: 1 }, at(2026, 10, 1)).getTime(),
      at(2026, 11, 1).getTime());
  });

  it("N > 1 phases to the epoch month (Jan/Jul for every=6)", () => {
    const mIdx = (d) => (d.getFullYear() - 1970) * 12 + d.getMonth();
    for (const from of [at(2026, 9, 8), at(2027, 0, 8)]) {
      const next = boundary({ unit: "month", every: 6 }, from);
      assert.equal(mIdx(next) % 6, 0);
      assert.ok(next.getTime() > from.getTime());
    }
  });

  it("respects monthAnchor for N > 1 (goal 9)", () => {
    setAnchor({ monthAnchor: 2 }); // period starts in March
    assert.equal(boundary({ unit: "month", every: 12 }, at(2026, 9, 8)).getTime(),
      at(2027, 2, 1).getTime());
    resetAnchor();
  });

  it("respects monthStartDay (1-28)", () => {
    setAnchor({ monthStartDay: 15 });
    assert.equal(boundary({ unit: "month", every: 1 }, at(2026, 9, 8)).getTime(),
      at(2026, 9, 15).getTime());
    resetAnchor();
  });
});

describe("cycleLabel", () => {
  it("formats every unit", () => {
    assert.equal(cycleLabel({ unit: "hour", every: 1 }), "Every hour");
    assert.equal(cycleLabel({ unit: "hour", every: 2 }), "Every 2h");
    assert.equal(cycleLabel({ unit: "day", every: 1 }), "Every day");
    assert.equal(cycleLabel({ unit: "day", every: 0 }), "Every day"); // clamped
    assert.equal(cycleLabel({ unit: "week", every: 3 }), "Every 3 weeks");
    assert.equal(cycleLabel({ unit: "month", every: 1 }), "Every month");
  });
});
