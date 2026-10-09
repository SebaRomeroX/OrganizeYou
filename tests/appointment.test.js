// Appointment ladder: appointmentMoment, appointmentLocked,
// appointmentInfo. Mirrors the roadmap's goal 11 harness (00:00
// unlock boundary, sticky "now", mutual lock).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { appointmentMoment, appointmentLocked, appointmentInfo } from "./helpers.js";

// Fixed "now": 2026-10-08 10:00 local (pinned TZ in helpers)
const NOW = new Date(2026, 9, 8, 10, 0, 0, 0);

describe("appointmentMoment", () => {
  it("unlocks at 00:00 for date-only input", () => {
    assert.equal(
      appointmentMoment("2026-10-09").getTime(),
      new Date(2026, 9, 9, 0, 0, 0, 0).getTime()
    );
  });

  it("uses the exact time when given", () => {
    assert.equal(
      appointmentMoment("2026-10-09T15:45").getTime(),
      new Date(2026, 9, 9, 15, 45, 0, 0).getTime()
    );
  });

  it("returns null for invalid input", () => {
    assert.equal(appointmentMoment(null), null);
    assert.equal(appointmentMoment(""), null);
    assert.equal(appointmentMoment("tomorrow"), null);
  });
});

describe("appointmentLocked", () => {
  it("locks strictly before the moment, unlocks at it", () => {
    assert.equal(appointmentLocked("2026-10-09", NOW), true);
    assert.equal(appointmentLocked("2026-10-08T11:00", NOW), true);
    // At the exact moment (date-only unlock = midnight today) -> unlocked
    assert.equal(appointmentLocked("2026-10-08", NOW), false);
    assert.equal(appointmentLocked("2026-10-07", NOW), false);
  });

  it("never locks on invalid input", () => {
    assert.equal(appointmentLocked("nope", NOW), false);
    assert.equal(appointmentLocked(null, NOW), false);
  });
});

describe("appointmentInfo", () => {
  it("returns null for invalid input", () => {
    assert.equal(appointmentInfo("nope", NOW), null);
    assert.equal(appointmentInfo("", NOW), null);
  });

  it("counts up in days for date-only appointments", () => {
    assert.deepEqual(appointmentInfo("2026-10-11", NOW), { text: "in 3 days", state: "normal" });
    assert.deepEqual(appointmentInfo("2026-10-09", NOW), { text: "in 1 day", state: "normal" });
  });

  it("steps days -> hours -> 10 min for timed appointments", () => {
    assert.deepEqual(appointmentInfo("2026-10-13T14:00", NOW), {
      text: "in 5 days",
      state: "normal",
    });
    assert.deepEqual(appointmentInfo("2026-10-09T11:00", NOW), {
      text: "in 1 day",
      state: "normal",
    });
    assert.deepEqual(appointmentInfo("2026-10-08T15:00", NOW), {
      text: "in 5 hours",
      state: "urgent",
    });
    assert.deepEqual(appointmentInfo("2026-10-08T11:00", NOW), {
      text: "in 1 hour",
      state: "urgent",
    });
    assert.deepEqual(appointmentInfo("2026-10-08T10:25", NOW), {
      text: "in 20 min",
      state: "urgent",
    });
    assert.deepEqual(appointmentInfo("2026-10-08T10:05", NOW), {
      text: "in 10 min",
      state: "urgent",
    });
  });

  it("sticks at 'now' from the moment on - never overdue", () => {
    assert.deepEqual(appointmentInfo("2026-10-08T10:00", NOW), { text: "now", state: "urgent" });
    assert.deepEqual(appointmentInfo("2026-10-08T09:00", NOW), { text: "now", state: "urgent" });
    assert.deepEqual(appointmentInfo("2026-10-07", NOW), { text: "now", state: "urgent" });
  });
});
