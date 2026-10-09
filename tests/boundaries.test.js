// Table-driven boundary cases for nextCycleBoundary. Complements
// the scenario-style cycles.test.js with dense input->expected
// rows, in three groups:
//   1. DST transitions (Europe/Madrid 2026: spring Mar 29,
//      fall Oct 25) for day/week/month. These assert BOTH the
//      wall-clock instant and the true elapsed duration in hours -
//      a naive wall-clock implementation shows up as a +/-1h drift
//      (spring: 743h March month, fall: 169h week, 24.5h day).
//   2. N > 1 epoch phasing (month every=3 -> Jan/Apr/Jul/Oct,
//      week every=2 -> the epoch-phased Monday).
//   3. Anchor variants and exact-boundary strictly-after.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextCycleBoundary, setAnchor } from "./helpers.js";

const at = (y, m, d, h = 0, min = 0) => new Date(y, m, d, h, min, 0, 0);

// Run a row: pin the anchor (null -> defaults), compute, compare
// against the expected wall-clock instant and real elapsed hours.
function runCase({ anchor = null, cycle, from, want, hours }) {
  setAnchor(anchor); // null normalizes to the defaults
  const got = new Date(nextCycleBoundary(cycle, from));
  assert.equal(got.getTime(), want.getTime(),
    `from ${from}: got ${got}, want ${want}`);
  if (hours != null) {
    assert.equal((got.getTime() - from.getTime()) / 3600000, hours,
      `from ${from}: real elapsed drifted (${hours}h expected)`);
  }
}

describe("DST spring-forward (2026-03-29 02:00 -> 03:00)", () => {
  const DAY = { unit: "day", every: 1 };
  const WEEK = { unit: "week", every: 1 };
  const MONTH = { unit: "month", every: 1 };

  it("day: anchor time 03:00 lands on the wall clock, 1 real hour after 01:00", () => {
    // 02:00-03:00 does not exist that night; constructing 03:00
    // local must pick CEST (01:00 UTC), not midnight+3h of ms
    runCase({ anchor: { time: "03:00" }, cycle: DAY, from: at(2026, 2, 29, 1),
      want: at(2026, 2, 29, 3), hours: 1 });
  });

  it("week: boundaries stay on Monday across the transition", () => {
    // the Mar 23->Mar 30 week is 167h (lost hour), so a Saturday
    // from is 35 real hours from the boundary
    runCase({ cycle: WEEK, from: at(2026, 2, 28, 12), want: at(2026, 2, 30), hours: 35 });
    // exact boundary -> strictly after
    runCase({ cycle: WEEK, from: at(2026, 2, 23), want: at(2026, 2, 30) });
  });

  it("month: March is 743 real hours (31 days minus the lost hour)", () => {
    runCase({ cycle: MONTH, from: at(2026, 2, 1), want: at(2026, 3, 1), hours: 743 });
    runCase({ cycle: MONTH, from: at(2026, 2, 29, 12), want: at(2026, 3, 1), hours: 60 });
  });
});

describe("DST fall-back (2026-10-25 03:00 -> 02:00)", () => {
  const DAY = { unit: "day", every: 1 };
  const WEEK = { unit: "week", every: 1 };
  const MONTH = { unit: "month", every: 1 };

  it("day: the 25-hour day makes the next midnight 24.5h away from 00:30", () => {
    runCase({ cycle: DAY, from: at(2026, 9, 25, 0, 30), want: at(2026, 9, 26), hours: 24.5 });
    runCase({ cycle: DAY, from: at(2026, 9, 24, 12), want: at(2026, 9, 25), hours: 12 });
  });

  it("week: the fall-back week is 169 real hours", () => {
    runCase({ cycle: WEEK, from: at(2026, 9, 21), want: at(2026, 9, 26), hours: 121 });
    // exact boundary -> strictly after; that Mon->Mon span is the
    // full 169h week (one repeated hour)
    runCase({ cycle: WEEK, from: at(2026, 9, 19), want: at(2026, 9, 26), hours: 169 });
  });

  it("month: rolls to November on the 1st", () => {
    runCase({ cycle: MONTH, from: at(2026, 9, 25, 12), want: at(2026, 10, 1) });
  });
});

describe("N > 1 epoch phasing", () => {
  it("month every=3 phases to Jan/Apr/Jul/Oct regardless of start month", () => {
    const rows = [
      [at(2026, 0, 15), at(2026, 3, 1)],  // Jan -> Apr
      [at(2026, 3, 15), at(2026, 6, 1)],  // Apr -> Jul
      [at(2026, 6, 15), at(2026, 9, 1)],  // Jul -> Oct
      [at(2026, 9, 15), at(2027, 0, 1)],  // Oct -> next Jan
    ];
    for (const [from, want] of rows) {
      runCase({ cycle: { unit: "month", every: 3 }, from, want });
    }
  });

  it("month every=3 at an exact boundary is strictly after", () => {
    runCase({ cycle: { unit: "month", every: 3 }, from: at(2026, 3, 1), want: at(2026, 6, 1) });
  });

  it("week every=2 lands on the epoch-phased Monday (dayNum % 14 == 4)", () => {
    // Monday start: the phase constant is (1 + 3) % 7 = 4; with
    // every=2 only Mondays with dayNum % 14 == 4 start a period
    // (Sep 28 and Oct 12 around here - Oct 5 does not)
    runCase({ cycle: { unit: "week", every: 2 }, from: at(2026, 9, 8), want: at(2026, 9, 12) });
    // inside the period -> same next Monday
    runCase({ cycle: { unit: "week", every: 2 }, from: at(2026, 9, 6), want: at(2026, 9, 12) });
    // non-phase Monday Oct 5 -> still the phase start Oct 12
    runCase({ cycle: { unit: "week", every: 2 }, from: at(2026, 9, 5), want: at(2026, 9, 12) });
    // exact period start Oct 12 -> strictly after: Oct 26
    runCase({ cycle: { unit: "week", every: 2 }, from: at(2026, 9, 12), want: at(2026, 9, 26) });
  });
});

describe("anchor variants (table)", () => {
  it("start day / time combinations each shift the boundary", () => {
    // anchor, cycle, from, want
    const rows = [
      [{ time: "06:00" }, { unit: "week", every: 1 }, at(2026, 9, 7), at(2026, 9, 12, 6)],
      [{ time: "06:00" }, { unit: "month", every: 1 }, at(2026, 9, 8), at(2026, 10, 1, 6)],
      [{ weekStartDay: 2 }, { unit: "week", every: 1 }, at(2026, 9, 8), at(2026, 9, 13)],
      [{ weekStartDay: 6 }, { unit: "week", every: 1 }, at(2026, 9, 8), at(2026, 9, 10)],
      [{ monthStartDay: 15, time: "06:00" }, { unit: "month", every: 1 }, at(2026, 9, 8), at(2026, 9, 15, 6)],
    ];
    for (const [anchor, cycle, from, want] of rows) {
      runCase({ anchor, cycle, from, want });
    }
  });
});

describe("exact boundary is strictly after (table)", () => {
  it("every unit advances a full period when from IS the boundary", () => {
    const rows = [
      [{ unit: "day", every: 1 }, at(2026, 9, 9), at(2026, 9, 10)],
      [{ unit: "week", every: 1 }, at(2026, 9, 12), at(2026, 9, 19)],
      [{ unit: "month", every: 1 }, at(2026, 10, 1), at(2026, 11, 1)],
      [{ unit: "week", every: 2 }, at(2026, 9, 5), at(2026, 9, 12)],
    ];
    for (const [cycle, from, want] of rows) {
      runCase({ cycle, from, want });
    }
  });
});
