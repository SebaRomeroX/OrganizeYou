// Done counters and streaks: doneCounts, dayStreak,
// streakOnBoundary. Mirrors the roadmap's goal 13 (counter
// harness) and goal 14 (streak harness) claims.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { doneCounts, dayStreak, streakOnBoundary, setAnchor, resetAnchor } = require("./helpers.cjs");

// Fixed "now": Thursday 2026-10-08 10:00 local, default anchor
// (week starts Monday Oct 5, month started Oct 1, year Jan 1)
const NOW = new Date(2026, 9, 8, 10, 0, 0, 0);

// Buckets: today / this week / this month / this year / total
const LOG = [
  { id: "a", t: new Date(2026, 9, 8, 9).getTime() },  // today
  { id: "b", t: new Date(2026, 9, 7, 12).getTime() }, // yesterday (this week)
  { id: "c", t: new Date(2026, 9, 5, 12).getTime() }, // Monday (this week)
  { id: "d", t: new Date(2026, 9, 4, 12).getTime() }, // Sunday (last week, Mon-start)
  { id: "e", t: new Date(2026, 9, 1, 12).getTime() }, // Oct 1 (this month)
  { id: "f", t: new Date(2026, 8, 30, 12).getTime() }, // Sep 30 (last month)
  { id: "g", t: new Date(2025, 11, 31, 12).getTime() }, // Dec 31 last year
];

describe("doneCounts", () => {
  it("buckets completions today / week / month / year / total", () => {
    assert.deepEqual(doneCounts(LOG, NOW), { today: 1, week: 3, month: 5, year: 6, total: 7 });
  });

  it("respects weekStartDay from the anchor (goal 9)", () => {
    setAnchor({ weekStartDay: 0 }); // Sunday start: Oct 4 joins this week
    assert.deepEqual(doneCounts(LOG, NOW), { today: 1, week: 4, month: 5, year: 6, total: 7 });
    resetAnchor();
  });

  it("rolls 'today' over at local midnight", () => {
    const midnight = new Date(2026, 9, 9, 0, 0, 1);
    assert.equal(doneCounts(LOG, midnight).today, 0);
    assert.equal(doneCounts(LOG, midnight).week, 3); // week/month unaffected
  });

  it("handles an empty log", () => {
    assert.deepEqual(doneCounts([], NOW), { today: 0, week: 0, month: 0, year: 0, total: 0 });
  });
});

describe("dayStreak", () => {
  const day = (y, m, d) => [{ id: "x", t: new Date(y, m, d, 9).getTime() }];

  it("is 0 with no completions", () => {
    assert.equal(dayStreak([], NOW), 0);
  });

  it("counts consecutive days ending today", () => {
    assert.equal(dayStreak([
      { id: "a", t: new Date(2026, 9, 8, 9).getTime() },
      { id: "b", t: new Date(2026, 9, 7, 18).getTime() },
      { id: "c", t: new Date(2026, 9, 6, 12).getTime() },
    ], NOW), 3);
  });

  it("counts from yesterday when today has none yet (not dead until the day ends)", () => {
    assert.equal(dayStreak(day(2026, 9, 7), NOW), 1);
    assert.equal(dayStreak([
      { id: "b", t: new Date(2026, 9, 7, 18).getTime() },
      { id: "c", t: new Date(2026, 9, 6, 12).getTime() },
    ], NOW), 2);
  });

  it("is 0 when neither today nor yesterday has a completion", () => {
    assert.equal(dayStreak(day(2026, 9, 6), NOW), 0);
  });

  it("breaks at a gap", () => {
    assert.equal(dayStreak([
      { id: "a", t: new Date(2026, 9, 8, 9).getTime() },
      { id: "c", t: new Date(2026, 9, 6, 12).getTime() }, // Oct 7 missing
    ], NOW), 1);
  });

  it("counts a day once regardless of entry count", () => {
    assert.equal(dayStreak([
      { id: "a", t: new Date(2026, 9, 8, 9).getTime() },
      { id: "b", t: new Date(2026, 9, 8, 18).getTime() },
      { id: "c", t: new Date(2026, 9, 7, 12).getTime() },
    ], NOW), 2);
  });
});

describe("streakOnBoundary (goal 14 counting rule)", () => {
  const task = (unit, done, streak) => ({ cycle: { unit, every: 1 }, done, streak });

  it("keeps a completed cycle alive: +1", () => {
    const t = task("day", true, 2);
    streakOnBoundary(t);
    assert.equal(t.streak, 3);
  });

  it("breaks on a missed cycle: 0", () => {
    const t = task("day", false, 2);
    streakOnBoundary(t);
    assert.equal(t.streak, 0);
  });

  it("starts a fresh streak from 0/undefined", () => {
    const t = { cycle: { unit: "week", every: 1 }, done: true };
    streakOnBoundary(t);
    assert.equal(t.streak, 1);
  });

  it("leaves hour cycles untouched (out of scope)", () => {
    const t = task("hour", true, 5);
    streakOnBoundary(t);
    assert.equal(t.streak, 5);
  });

  it("leaves tasks without a cycle untouched", () => {
    const t = { done: true, streak: 9 };
    streakOnBoundary(t);
    assert.equal(t.streak, 9);
  });
});
