// Table-driven cases for the completion counters and the day
// streak: every weekStartDay (0-6), the midnight rollover, the
// streak gap rules and the "a streak is not dead until the day
// ends" rule - each as input->expected rows. The scenario-style
// equivalents live in stats.test.js.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { doneCounts, dayStreak, setAnchor } from "./helpers.js";

const at = (y, m, d, h = 0, min = 0) => new Date(y, m, d, h, min, 0, 0);
const NOW = at(2026, 9, 8, 10); // Thursday; week Mon Oct 5

// a: today(Thu) b: Wed c: Mon d: Sun(Oct 4) e: Thu Oct 1
const LOG = [
  { id: "a", t: at(2026, 9, 8, 9).getTime() },
  { id: "b", t: at(2026, 9, 7, 12).getTime() },
  { id: "c", t: at(2026, 9, 5, 12).getTime() },
  { id: "d", t: at(2026, 9, 4, 12).getTime() },
  { id: "e", t: at(2026, 9, 1, 12).getTime() },
];

describe("doneCounts: week bucket per weekStartDay", () => {
  it("counts from each possible week start day", () => {
    // weekStartDay -> expected week bucket for LOG at NOW.
    // Sun(0): Oct 4 joins -> 4; Mon(1): Oct 5 -> 3; Tue(2): 2;
    // Wed(3): 2; Thu(4): today only -> 1; Fri(5): back to Oct 2
    // (e excluded, d included) -> 4; Sat(6): back to Oct 3 -> 4
    const rows = [
      [0, 4],
      [1, 3],
      [2, 2],
      [3, 2],
      [4, 1],
      [5, 4],
      [6, 4],
    ];
    for (const [weekStartDay, week] of rows) {
      setAnchor({ weekStartDay });
      assert.equal(doneCounts(LOG, NOW).week, week, `weekStartDay=${weekStartDay}`);
    }
    setAnchor(null); // restore defaults for the other suites
  });
});

describe("doneCounts: midnight rollover", () => {
  it("moves a 23:30 completion from 'today' to plain history", () => {
    const late = [{ id: "x", t: at(2026, 9, 8, 23, 30).getTime() }];
    // 23:45: still today
    assert.deepEqual(doneCounts(late, at(2026, 9, 8, 23, 45)), {
      today: 1,
      week: 1,
      month: 1,
      year: 1,
      total: 1,
    });
    // 00:15 next day: today rolls to 0, week/month/total stand
    assert.deepEqual(doneCounts(late, at(2026, 9, 9, 0, 15)), {
      today: 0,
      week: 1,
      month: 1,
      year: 1,
      total: 1,
    });
  });

  it("rolls the week bucket when the configured week turns over", () => {
    const late = [{ id: "x", t: at(2026, 9, 8, 23, 30).getTime() }];
    // Sunday-start (weekStartDay=0): Sunday Oct 11 00:15 begins a
    // new week, so the Oct 8 entry leaves the bucket
    setAnchor({ weekStartDay: 0 });
    assert.equal(doneCounts(late, at(2026, 9, 11, 0, 15)).week, 0);
    setAnchor(null);
  });
});

describe("dayStreak: gap rules (table)", () => {
  it("walks back only over contiguous days", () => {
    const d = (day) => ({ id: "x", t: at(2026, 9, day, 9).getTime() });
    // days present -> expected streak (now = Thu Oct 8)
    const rows = [
      [[], 0], // nothing
      [[8], 1], // today only
      [[7], 1], // yesterday only (not dead yet)
      [[8, 7], 2],
      [[8, 6], 1], // gap on Oct 7
      [[8, 7, 6, 5], 4],
      [[8, 5, 4], 1], // gap on Oct 7 -> today only
      [[6, 5], 0], // neither today nor yesterday
      [[8, 8, 7], 2], // dupes on one day count once
    ];
    for (const [days, want] of rows) {
      assert.equal(dayStreak(days.map(d), NOW), want, `days=[${days}]`);
    }
  });
});

describe("dayStreak: not dead until the day ends (table)", () => {
  it("survives all of today when only yesterday has an entry", () => {
    const y = [{ id: "x", t: at(2026, 9, 7, 9).getTime() }];
    // from just after midnight to the last minute of today: 1
    for (const now of [at(2026, 9, 8, 0, 1), at(2026, 9, 8, 12), at(2026, 9, 8, 23, 59)]) {
      assert.equal(dayStreak(y, now), 1, `at ${now}`);
    }
    // the moment today begins without an entry: 0
    assert.equal(dayStreak(y, at(2026, 9, 9, 0, 0)), 0);
  });

  it("holds across the 25-hour fall-back day", () => {
    // completion mid Sun Oct 25 (the repeated-hour day); still a
    // live streak half an hour into Oct 26
    const f = [{ id: "x", t: at(2026, 9, 25, 12).getTime() }];
    assert.equal(dayStreak(f, at(2026, 9, 26, 0, 30)), 1);
    assert.equal(dayStreak(f, at(2026, 9, 27, 0, 30)), 0); // one day later
  });
});
