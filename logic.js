// OrganizeYou - pure logic: cycle math, badge ladders, counters
//
// Extracted verbatim from app.js so the Node test runner can run
// this code without a DOM. Now a native ES module: the browser
// imports it from app.js modules and the Node tests import the
// exact same file - one implementation, two consumers, no build
// step. Two globals are read at CALL time (never at load time):
//   - cycleAnchor: the cycle reset setting (time / week start /
//     month start / month anchor), read by nextCycleBoundary,
//     anchorMinutes and doneCounts
//   - doneLog:     default argument of doneCounts / dayStreak
// In the browser storage.hydrate() installs both on globalThis
// before the first call; in Node tests tests/helpers.js provides
// them.
//
// No DOM, no localStorage: every input arrives as an argument
// and every result is a return value - that is what makes this
// file testable. ES modules are strict by default, so the old
// "use strict" directive is gone.

/* ---------- Completion counters ---------- */

// Pure counting of completions: today from local midnight, week
// from the anchor's weekStartDay (0 = Sunday, default Monday),
// month from the 1st, year from Jan 1, total = every entry
function doneCounts(log = doneLog, now = new Date()) {
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - ((now.getDay() - cycleAnchor.weekStartDay + 7) % 7)
  );
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const from = (start) => log.filter((e) => e.t >= start.getTime()).length;
  return {
    today: from(startOfDay),
    week: from(weekStart),
    month: from(monthStart),
    year: from(yearStart),
    total: log.length,
  };
}

// Pure day streak: consecutive local days with at least one
// completion, walked back from today - or from yesterday when
// today has no entry yet (a streak is not dead until the day
// ends). Plain calendar days, independent of the cycle anchor
function dayStreak(log = doneLog, now = new Date()) {
  const days = new Set(
    log.map((e) => {
      const d = new Date(e.t);
      return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
    })
  );
  const key = (d) => d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
  let day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.has(key(day))) {
    day.setDate(day.getDate() - 1);
    if (!days.has(key(day))) return 0;
  }
  let streak = 0;
  while (days.has(key(day))) {
    streak++;
    day.setDate(day.getDate() - 1);
  }
  return streak;
}

/* ---------- Cycles (recurring schedules) ---------- */

// Anchor time as minutes since midnight (invalid values -> 0)
function anchorMinutes() {
  const m = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(cycleAnchor.time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

// Local wall-clock instant of calendar day number `num` at
// `minutes` past midnight
function dayNumInstant(num, minutes) {
  const d = new Date(num * 86400000);
  return new Date(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
    Math.floor(minutes / 60), minutes % 60
  ).getTime();
}

// Local wall-clock instant of month index `mIdx` (months since
// 1970-01) on day `day` at `minutes` past midnight
function monthInstant(mIdx, day, minutes) {
  const yr = 1970 + Math.floor(mIdx / 12);
  const mo = ((mIdx % 12) + 12) % 12;
  return new Date(yr, mo, day, Math.floor(minutes / 60), minutes % 60).getTime();
}

// Next due moment strictly after `from` (defaults to now).
// Hours are elapsed: `from` + N hours exactly (true duration in
// ms, so it holds even across DST). Day/week/month boundaries
// start at the global cycle anchor (start time, week start day,
// month start day, month anchor); with the defaults they fall on
// midnight/Monday/1st exactly as before. For every N > 1 the
// periods phase to the epoch (see roadmap).
function nextCycleBoundary(cycle, from = new Date()) {
  const n = Math.max(1, Math.floor(Number(cycle.every)) || 1);
  const y = from.getFullYear();
  const mo = from.getMonth();
  const d = from.getDate();

  if (cycle.unit === "hour") {
    // Elapsed: exactly N hours after the completion moment
    return from.getTime() + n * 3600000;
  }

  const minutes = anchorMinutes();
  const fromTs = from.getTime();

  // Calendar day number (DST-proof) of the local date
  const dayNum = Math.floor(Date.UTC(y, mo, d) / 86400000);

  if (cycle.unit === "day") {
    // Boundaries: epoch dayNum = 0 (mod n), at the anchor time.
    // Ceil gives the first boundary on or after today's date.
    const b = Math.ceil(dayNum / n) * n;
    const start = dayNumInstant(b, minutes);
    return start > fromTs ? start : dayNumInstant(b + n, minutes);
  }

  if (cycle.unit === "week") {
    // N-week periods starting on the configured weekday
    const firstW = (cycleAnchor.weekStartDay + 3) % 7; // first such weekday after epoch
    const span = 7 * n;
    const p = firstW + Math.floor((dayNum - firstW) / span) * span;
    const start = dayNumInstant(p, minutes);
    return start > fromTs ? start : dayNumInstant(p + span, minutes);
  }

  // month: N-month periods starting at the configured anchor month,
  // on the configured start day (1-28) at the anchor time
  const mIdx = (y - 1970) * 12 + mo;
  const a0 = cycleAnchor.monthAnchor;
  const p = a0 + Math.floor((mIdx - a0) / n) * n;
  const start = monthInstant(p, cycleAnchor.monthStartDay, minutes);
  return start > fromTs ? start : monthInstant(p + n, cycleAnchor.monthStartDay, minutes);
}

// Badge text: "Every day", "Every 2h", "Every 3 weeks"...
function cycleLabel(cycle) {
  const n = Math.max(1, Math.floor(Number(cycle.every)) || 1);
  if (cycle.unit === "hour") return n === 1 ? "Every hour" : `Every ${n}h`;
  const names = { day: "days", week: "weeks", month: "months" };
  const one = { day: "day", week: "week", month: "month" };
  return `Every ${n === 1 ? one[cycle.unit] : n + " " + names[cycle.unit]}`;
}

/* ---------- Deadline countdown ---------- */

// Countdown badge text + state for a deadline.
// deadline: "YYYY-MM-DD" (counts to the END of that day) or
// "YYYY-MM-DDTHH:mm" (days -> hours -> 10-minute steps).
// Returns { text, state } with state "normal" | "urgent" | "overdue",
// or null for a missing/invalid deadline.
function countdownInfo(deadline, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(deadline || "");
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const timed = m[4] != null;

  // Deadline instant: exact time, or end of day for date-only
  const due = timed
    ? new Date(y, mo, d, Number(m[4]), Number(m[5]))
    : new Date(y, mo, d, 23, 59, 59, 999);
  const left = due.getTime() - now.getTime();
  if (left <= 0) return { text: "overdue", state: "overdue" };

  // Calendar days between today's date and the deadline's date
  const dayNum = (dt) =>
    Math.floor(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()) / 86400000);
  const diff = dayNum(new Date(y, mo, d)) - dayNum(now);

  if (!timed) {
    // Date-only: the whole deadline day reads "today"
    return diff === 0
      ? { text: "today", state: "urgent" }
      : { text: `${diff} day${diff > 1 ? "s" : ""}`, state: "normal" };
  }

  // Timed: days first, then hours, then 10-minute steps
  if (diff >= 2) return { text: `${diff} days`, state: "normal" };
  if (left >= 24 * 3600000) return { text: "1 day", state: "normal" };
  if (left >= 60 * 60000) {
    const h = Math.floor(left / 3600000);
    return { text: h === 1 ? "1 hour" : `${h} hours`, state: "urgent" };
  }
  // Under an hour: 10-minute floor, stays at "10 min" down to zero
  const mins = Math.max(10, Math.floor(left / 600000) * 10);
  return { text: `${mins} min`, state: "urgent" };
}

/* ---------- Appointments ---------- */

// The instant an appointment unlocks: exact time when given, else
// 00:00 of that day (the whole day is the appointment day).
// null for missing/invalid input.
function appointmentMoment(appointment) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(appointment || "");
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return m[4] != null
    ? new Date(y, mo, d, Number(m[4]), Number(m[5]))
    : new Date(y, mo, d, 0, 0, 0, 0);
}

// A task with a future appointment is locked: main checkbox,
// subtasks and counter clicks all stay disabled until the moment
function appointmentLocked(appointment, now = new Date()) {
  const moment = appointmentMoment(appointment);
  return moment != null && now.getTime() < moment.getTime();
}

// Appointment badge text + state. Before the moment it counts UP to
// it ("in 3 days" -> "in 1 hour" -> "in 10 min"); from the moment
// on it reads "now" and STAYS "now" while the task is undone -
// never "overdue". Returns null for missing/invalid input.
function appointmentInfo(appointment, now = new Date()) {
  const moment = appointmentMoment(appointment);
  if (!moment) return null;
  const left = moment.getTime() - now.getTime();
  if (left <= 0) return { text: "now", state: "urgent" };

  // Calendar days between today's date and the appointment's date
  const dayNum = (dt) =>
    Math.floor(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()) / 86400000);
  const diff = dayNum(moment) - dayNum(now);
  const timed = appointment.length > 10;

  if (!timed) {
    // Date-only: unlock is 00:00 of that day, so a positive wait
    // always spans at least one whole calendar day
    return { text: `in ${diff} day${diff > 1 ? "s" : ""}`, state: "normal" };
  }

  // Timed: days first, then hours, then 10-minute steps
  if (diff >= 2) return { text: `in ${diff} days`, state: "normal" };
  if (left >= 24 * 3600000) return { text: "in 1 day", state: "normal" };
  if (left >= 60 * 60000) {
    const h = Math.floor(left / 3600000);
    return { text: `in ${h} hour${h === 1 ? "" : "s"}`, state: "urgent" };
  }
  // Under an hour: 10-minute floor, stays at "in 10 min" down to zero
  const mins = Math.max(10, Math.floor(left / 600000) * 10);
  return { text: `in ${mins} min`, state: "urgent" };
}

/* ---------- Time since (counts up from the last completion) ---------- */

// Current local time as "YYYY-MM-DDTHH:mm" (the since record
// format). Used by the completion hooks and the modal "Now" button.
function nowStamp(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `T${p(now.getHours())}:${p(now.getMinutes())}`
  );
}

// The instant a "time since" record points at: exact time when
// given, else 00:00 of that day (the whole day is the last time).
// null for missing/invalid input.
function sinceMoment(since) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(since || "");
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return m[4] != null
    ? new Date(y, mo, d, Number(m[4]), Number(m[5]))
    : new Date(y, mo, d, 0, 0, 0, 0);
}

// Time-since badge text + state, counting UP from the record.
// Longest unit first: < 10 min "just now" -> 10-minute steps ->
// hours -> calendar days -> weeks (floor(days/7)) -> months
// (floor(days/30)). Always "normal" - never urgent/overdue. A
// future moment clamps to "just now". null for invalid input.
function sinceInfo(since, now = new Date()) {
  const moment = sinceMoment(since);
  if (!moment) return null;
  const elapsed = now.getTime() - moment.getTime();

  // Calendar days between the record's date and today
  const dayNum = (dt) =>
    Math.floor(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()) / 86400000);
  const diff = dayNum(now) - dayNum(moment);

  if (diff >= 30) {
    const months = Math.floor(diff / 30);
    return { text: `${months} month${months > 1 ? "s" : ""}`, state: "normal" };
  }
  if (diff >= 7) {
    const weeks = Math.floor(diff / 7);
    return { text: `${weeks} week${weeks > 1 ? "s" : ""}`, state: "normal" };
  }
  if (diff >= 1) return { text: `${diff} day${diff > 1 ? "s" : ""}`, state: "normal" };

  // Same calendar day: hours, then 10-minute steps
  if (elapsed >= 3600000) {
    const h = Math.floor(elapsed / 3600000);
    return { text: h === 1 ? "1 hour" : `${h} hours`, state: "normal" };
  }
  if (elapsed >= 600000) {
    return { text: `${Math.floor(elapsed / 600000) * 10} min`, state: "normal" };
  }
  return { text: "just now", state: "normal" };
}

/* ---------- Streaks ---------- */

// Streak rule at a cycle boundary: completing every cycle keeps
// the streak alive (+1), missing one breaks it (0). Automatic
// only - user unticks and anchor changes never touch it. Hour
// cycles are out of streak scope for now (their streak stays 0)
function streakOnBoundary(task) {
  if (!task.cycle || task.cycle.unit === "hour") return;
  task.streak = task.done ? (task.streak || 0) + 1 : 0;
}

/* ---------- Cycle anchor setting ---------- */

// Defaults reproduce the original boundaries exactly:
// midnight, Monday, the 1st, January (epoch phase for N > 1)
function defaultCycleAnchor() {
  return { time: "00:00", weekStartDay: 1, monthStartDay: 1, monthAnchor: 0 };
}

// Fill in anything missing or invalid so first run and corrupt
// data behave exactly like the default calendar boundaries
function normalizeCycleAnchor(a) {
  const base = defaultCycleAnchor();
  if (!a || typeof a !== "object") return base;
  return {
    time:
      typeof a.time === "string" && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(a.time)
        ? a.time
        : base.time,
    weekStartDay:
      Number.isInteger(a.weekStartDay) && a.weekStartDay >= 0 && a.weekStartDay <= 6
        ? a.weekStartDay
        : base.weekStartDay,
    monthStartDay:
      Number.isInteger(a.monthStartDay) && a.monthStartDay >= 1 && a.monthStartDay <= 28
        ? a.monthStartDay
        : base.monthStartDay,
    monthAnchor:
      Number.isInteger(a.monthAnchor) && a.monthAnchor >= 0 && a.monthAnchor <= 11
        ? a.monthAnchor
        : base.monthAnchor,
  };
}

/* ---------- Exports ---------- */
// The 17 functions the app and the tests share; every consumer
// imports them by name (no globals, no CommonJS shim).
export {
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
};
