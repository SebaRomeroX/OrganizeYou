// Time-since ladder: nowStamp, sinceMoment, sinceInfo. Mirrors
// the roadmap's goal 12 harness (count-up ladder, future clamp,
// date-only 00:00, invalid input).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nowStamp, sinceMoment, sinceInfo } from "./helpers.js";

// Fixed "now": 2026-10-08 10:00 local (pinned TZ in helpers)
const NOW = new Date(2026, 9, 8, 10, 0, 0, 0);

describe("nowStamp", () => {
  it("formats local time as YYYY-MM-DDTHH:mm with zero padding", () => {
    assert.equal(nowStamp(new Date(2026, 0, 5, 9, 5)), "2026-01-05T09:05");
    assert.equal(nowStamp(new Date(2026, 11, 31, 23, 0)), "2026-12-31T23:00");
  });

  it("round-trips through sinceMoment", () => {
    const stamp = nowStamp(NOW);
    assert.equal(sinceMoment(stamp).getTime(), NOW.getTime());
  });
});

describe("sinceMoment", () => {
  it("falls back to 00:00 for date-only records", () => {
    assert.equal(sinceMoment("2026-10-07").getTime(), new Date(2026, 9, 7, 0, 0, 0, 0).getTime());
  });

  it("returns null for invalid input", () => {
    assert.equal(sinceMoment(null), null);
    assert.equal(sinceMoment(""), null);
    assert.equal(sinceMoment("yesterday"), null);
  });
});

describe("sinceInfo - count-up ladder", () => {
  it("says 'just now' below 10 minutes", () => {
    assert.deepEqual(sinceInfo("2026-10-08T09:55", NOW), { text: "just now", state: "normal" });
    assert.deepEqual(sinceInfo("2026-10-08T10:00", NOW), { text: "just now", state: "normal" });
  });

  it("steps in 10-minute buckets, then hours, same day", () => {
    assert.deepEqual(sinceInfo("2026-10-08T09:35", NOW), { text: "20 min", state: "normal" });
    assert.deepEqual(sinceInfo("2026-10-08T07:00", NOW), { text: "3 hours", state: "normal" });
  });

  it("counts calendar days across midnight", () => {
    assert.deepEqual(sinceInfo("2026-10-07T22:00", NOW), { text: "1 day", state: "normal" });
    assert.deepEqual(sinceInfo("2026-10-05T10:00", NOW), { text: "3 days", state: "normal" });
  });

  it("switches to weeks at 7 days and months at 30", () => {
    assert.deepEqual(sinceInfo("2026-10-01T10:00", NOW), { text: "1 week", state: "normal" });
    assert.deepEqual(sinceInfo("2026-09-28T10:00", NOW), { text: "1 week", state: "normal" });
    assert.deepEqual(sinceInfo("2026-09-21T10:00", NOW), { text: "2 weeks", state: "normal" });
    assert.deepEqual(sinceInfo("2026-08-29T10:00", NOW), { text: "1 month", state: "normal" });
    // Jul 10 -> Oct 8 is 90 days = 3 months by the floor(days/30) rule
    assert.deepEqual(sinceInfo("2026-07-10T10:00", NOW), { text: "3 months", state: "normal" });
    assert.deepEqual(sinceInfo("2026-07-25T10:00", NOW), { text: "2 months", state: "normal" });
  });

  it("clamps future records to 'just now'", () => {
    assert.deepEqual(sinceInfo("2026-10-09", NOW), { text: "just now", state: "normal" });
  });

  it("returns null for invalid input", () => {
    assert.equal(sinceInfo("zzz", NOW), null);
    assert.equal(sinceInfo("", NOW), null);
  });
});
