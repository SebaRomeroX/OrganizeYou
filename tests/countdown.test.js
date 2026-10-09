// Deadline countdown ladder: countdownInfo. Mirrors the roadmap's
// goal 10 harness (date-only vs timed deadlines, exact
// boundaries, invalid input).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { countdownInfo } from "./helpers.js";

// Fixed "now": 2026-10-08 10:00 local (pinned TZ in helpers)
const NOW = new Date(2026, 9, 8, 10, 0, 0, 0);

describe("countdownInfo - invalid input", () => {
  it("returns null for missing or malformed deadlines", () => {
    assert.equal(countdownInfo(null, NOW), null);
    assert.equal(countdownInfo("", NOW), null);
    assert.equal(countdownInfo("garbage", NOW), null);
    assert.equal(countdownInfo("08/10/2026", NOW), null);
    assert.equal(countdownInfo("tomorrow", NOW), null);
  });

  it("is lenient on out-of-range fields (JS Date rollover)", () => {
    // The app only feeds values from <input type="date">, and
    // loadTasks' validDue applies the same regex, so field-range
    // rollover is the accepted, consistent behavior here
    assert.deepEqual(countdownInfo("2026-13-40", NOW), { text: "124 days", state: "normal" });
  });
});

describe("countdownInfo - date-only deadlines (count to end of day)", () => {
  it("reads the deadline day as today", () => {
    assert.deepEqual(countdownInfo("2026-10-08", NOW), { text: "today", state: "urgent" });
  });

  it("counts calendar days", () => {
    assert.deepEqual(countdownInfo("2026-10-09", NOW), { text: "1 day", state: "normal" });
    assert.deepEqual(countdownInfo("2026-10-13", NOW), { text: "5 days", state: "normal" });
  });

  it("is overdue after the day ends", () => {
    assert.deepEqual(countdownInfo("2026-10-07", NOW), { text: "overdue", state: "overdue" });
    // Even one ms past the end of the deadline day
    const lateNight = new Date(2026, 9, 8, 23, 59, 59);
    assert.deepEqual(countdownInfo("2026-10-07", lateNight), { text: "overdue", state: "overdue" });
  });
});

describe("countdownInfo - timed deadlines (days -> hours -> 10 min)", () => {
  it("shows days when two or more calendar days remain", () => {
    assert.deepEqual(countdownInfo("2026-10-13T14:00", NOW), { text: "5 days", state: "normal" });
  });

  it("shows exactly 1 day at the 24h boundary", () => {
    assert.deepEqual(countdownInfo("2026-10-09T10:00", NOW), { text: "1 day", state: "normal" });
    // Just under 24h and same calendar day falls through to hours
    assert.deepEqual(countdownInfo("2026-10-09T09:59", NOW), { text: "23 hours", state: "urgent" });
  });

  it("steps down through hours in the urgent state", () => {
    assert.deepEqual(countdownInfo("2026-10-08T13:00", NOW), { text: "3 hours", state: "urgent" });
    assert.deepEqual(countdownInfo("2026-10-08T11:00", NOW), { text: "1 hour", state: "urgent" });
  });

  it("steps in 10-minute buckets and never shows less than 10 min", () => {
    assert.deepEqual(countdownInfo("2026-10-08T10:45", NOW), { text: "40 min", state: "urgent" });
    assert.deepEqual(countdownInfo("2026-10-08T10:10", NOW), { text: "10 min", state: "urgent" });
    assert.deepEqual(countdownInfo("2026-10-08T10:05", NOW), { text: "10 min", state: "urgent" });
  });

  it("is overdue at or past the exact moment", () => {
    assert.deepEqual(countdownInfo("2026-10-08T10:00", NOW), { text: "overdue", state: "overdue" });
    assert.deepEqual(countdownInfo("2026-10-08T09:59", NOW), { text: "overdue", state: "overdue" });
  });
});
