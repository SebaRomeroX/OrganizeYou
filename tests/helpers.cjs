// tests/helpers.cjs - shared setup for the whole test suite.
//
// 1) Pin the timezone FIRST: Europe/Madrid observes both DST
//    transitions, so the date-math tests exercise the same edge
//    cases on every machine (CI runs UTC, laptops run anything).
//    TZ pinning works on Linux/macOS, which covers dev + CI.
//    Every test builds dates with local-time constructors, so
//    pinning makes the assertions machine-independent.
//
// 2) logic.js reads two app.js globals at CALL time (never at
//    load time): `cycleAnchor` for the calendar math and
//    `doneLog` as the default argument of the counters. The
//    browser provides them from app.js; here we install
//    stand-ins that the tests can override per suite.
process.env.TZ = "Europe/Madrid";

const logic = require("../logic.js");

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

module.exports = { ...logic, setAnchor, resetAnchor };
