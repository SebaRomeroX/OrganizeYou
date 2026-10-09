// tests/helpers.js - shared setup for the whole test suite.
//
// 1) Pin the timezone FIRST: Europe/Madrid observes both DST
//    transitions, so the date-math tests exercise the same edge
//    cases on every machine (CI runs UTC, laptops run anything).
//    TZ pinning works on Linux/macOS, which covers dev + CI.
//    A dynamic import (with top-level await) guarantees the
//    assignment lands BEFORE logic.js evaluates - static imports
//    would be hoisted above it.
//
// 2) logic.js reads two app globals at CALL time (never at load
//    time): `cycleAnchor` for the calendar math and `doneLog` as
//    the default argument of the counters. In the browser
//    storage.hydrate() installs them; here we install stand-ins
//    that the tests can override per suite.
process.env.TZ = "Europe/Madrid";

const logic = await import("../logic.js");

globalThis.doneLog = [];

// Replace the global anchor with `overrides` merged onto the
// defaults (invalid fields fall back to the defaults too).
function setAnchor(overrides) {
  globalThis.cycleAnchor = logic.normalizeCycleAnchor(overrides ?? null);
  return globalThis.cycleAnchor;
}

function resetAnchor() {
  return setAnchor(null);
}

resetAnchor();

// Same surface the .cjs version exposed: every pure function plus
// the two anchor helpers.
export const {
  doneCounts,
  dayStreak,
  anchorMinutes,
  dayNumInstant,
  monthInstant,
  nextCycleBoundary,
  cycleLabel,
  countdownInfo,
  appointmentMoment,
  appointmentLocked,
  appointmentInfo,
  nowStamp,
  sinceMoment,
  sinceInfo,
  streakOnBoundary,
  defaultCycleAnchor,
  normalizeCycleAnchor,
} = logic;

export { setAnchor, resetAnchor };
