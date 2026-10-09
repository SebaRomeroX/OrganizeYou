// OrganizeYou - to-do list with categories & tags (vanilla JS, localStorage)

const TASKS_KEY = "organizeyou.tasks";
const CATEGORIES_KEY = "organizeyou.categories";
const CYCLE_ANCHOR_KEY = "organizeyou.cycleAnchor";
const DONE_LOG_KEY = "organizeyou.doneLog";
const CYCLE_UNITS = ["hour", "day", "week", "month"];

// Global anchor for calendar cycles - must be ready before
// loadTasks() (its migration calls nextCycleBoundary)
const cycleAnchor = loadCycleAnchor();

const newTaskBtn = document.getElementById("new-task-btn");
const categoriesBtn = document.getElementById("categories-btn");
const settingsBtn = document.getElementById("settings-btn");
const taskList = document.getElementById("task-list");
const emptyState = document.getElementById("empty-state");

let tasks = loadTasks();
let categories = loadCategories();
let doneLog = loadDoneLog();

function loadTasks() {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // Migrate tasks created before repeats/subtasks existed
    return parsed.map((t) => {
      const repeats =
        t.repeats && typeof t.repeats.target === "number" && t.repeats.target >= 1
          ? {
              current: Math.min(Math.max(0, Number(t.repeats.current) || 0), t.repeats.target),
              target: t.repeats.target,
            }
          : null;
      const subtasks = Array.isArray(t.subtasks)
        ? t.subtasks.map((s) => ({
            id: s.id || makeId(),
            text: String(s.text || ""),
            done: !!s.done,
          }))
        : [];
      // Normalize the done flag for repetition/subtask tasks
      let done = !!t.done;
      if (repeats) done = repeats.current >= repeats.target;
      else if (subtasks.length > 0) done = subtasks.every((s) => s.done);

      // Cycle: valid schedule object or null
      const cycle =
        t.cycle &&
        CYCLE_UNITS.includes(t.cycle.unit) &&
        Number(t.cycle.every) >= 1
          ? {
              every: Math.floor(Number(t.cycle.every)),
              unit: t.cycle.unit,
              dueAt: Number.isFinite(t.cycle.dueAt) ? t.cycle.dueAt : null,
            }
          : null;
      // A done cycle task with no dueAt is unknown data: treat as
      // completed now. Past dueAts are left alone (reset engine
      // handles them right after load).
      if (cycle && done && cycle.dueAt == null) {
        cycle.dueAt = nextCycleBoundary(cycle);
      }

      // Deadline / appointment: "YYYY-MM-DD" (deadline ends that day,
      // appointment starts it) or "YYYY-MM-DDTHH:mm". Mutually
      // exclusive; deadline wins on hand-edited data.
      const validDue = (v) =>
        typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(v);
      const deadline = validDue(t.deadline) ? t.deadline : null;
      const appointment = !deadline && validDue(t.appointment) ? t.appointment : null;
      // Time since: an independent record (same string forms),
      // valid value or null - no exclusivity with the two above
      const since = validDue(t.since) ? t.since : null;

      // Streak (goal 14): non-negative integer, 0 = none yet.
      // Hour cycles never count, but the field stays on the task
      const streak = Number.isFinite(t.streak) && t.streak >= 1 ? Math.floor(t.streak) : 0;

      return { ...t, tags: Array.isArray(t.tags) ? t.tags : [], repeats, subtasks, cycle, deadline, appointment, since, streak, done };
    });
  } catch {
    return [];
  }
}

function loadCategories() {
  try {
    const raw = localStorage.getItem(CATEGORIES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveTasks() {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

function saveCategories() {
  localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
}

// Completion history for the done counter: [{ id, t }]. Validated
// on load (broken entries dropped), default []
function loadDoneLog() {
  try {
    const raw = localStorage.getItem(DONE_LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && typeof e.id === "string" && Number.isFinite(e.t));
  } catch {
    return [];
  }
}

function saveDoneLog() {
  localStorage.setItem(DONE_LOG_KEY, JSON.stringify(doneLog));
}

// Keep the done counter log in step with USER-driven transitions:
// becoming done pushes an entry, undoing removes that task's most
// recent one. Automatic cycle resets never call this - the
// completion stands and the task simply restarts.
function logDoneChange(id, done) {
  if (done) {
    doneLog.push({ id, t: Date.now() });
  } else {
    for (let i = doneLog.length - 1; i >= 0; i--) {
      if (doneLog[i].id === id) {
        doneLog.splice(i, 1);
        break;
      }
    }
  }
  saveDoneLog();
}

// Completion counters (doneCounts, dayStreak) live in logic.js

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function categoryById(id) {
  return categories.find((c) => c.id === id);
}

/* ---------- Modal actions ---------- */

// Shared tag toggle chips for the new/edit task modals.
// Mutates `selected` (a Set of category ids) in place.
function buildTagChips(selected) {
  return (container) => {
    if (categories.length === 0) {
      const hint = document.createElement("span");
      hint.className = "picker-empty";
      hint.textContent = "No categories yet. Create one first.";
      container.appendChild(hint);
      return;
    }
    categories.forEach((cat) => {
      const chip = document.createElement("button");
      chip.type = "button";
      const isOn = selected.has(cat.id);
      chip.className = "picker-chip" + (isOn ? " selected" : "");
      chip.textContent = cat.name;
      chip.setAttribute("aria-pressed", isOn ? "true" : "false");
      chip.addEventListener("click", () => {
        if (selected.has(cat.id)) selected.delete(cat.id);
        else selected.add(cat.id);
        const nowOn = selected.has(cat.id);
        chip.classList.toggle("selected", nowOn);
        chip.setAttribute("aria-pressed", nowOn ? "true" : "false");
      });
      container.appendChild(chip);
    });
  };
}

// Selected tags in category creation order
function orderedTags(selected) {
  return categories.map((c) => c.id).filter((id) => selected.has(id));
}

/* ---------- Badge refresh (60s tick, DOM) ---------- */
// Cycle math, labels and the countdown ladder moved to logic.js

// Re-patch the visible countdown badges in place (no full render,
// so focus and scroll are untouched)
function refreshCountdowns() {
  document.querySelectorAll(".countdown-badge").forEach((badge) => {
    const info = countdownInfo(badge.dataset.deadline);
    if (!info) return;
    if (badge.textContent !== info.text) badge.textContent = info.text;
    const cls = "countdown-badge " + info.state;
    if (badge.className !== cls) badge.className = cls;
  });
}

// Appointment parsing/lock/badge logic moved to logic.js

// Disabled state + aria-label for the main checkbox, combining the
// base role (counter / subtask-only / plain) with the appointment
// lock. Reused by the renderer and by the in-place unlock.
function applyMainCheckboxState(box, task) {
  const locked = !task.done && appointmentLocked(task.appointment);
  if (locked) {
    box.disabled = true;
    box.setAttribute("aria-label", "Locked until the appointment moment");
  } else if (task.repeats) {
    box.disabled = false;
    box.setAttribute(
      "aria-label",
      `Progress: ${task.repeats.current} of ${task.repeats.target}`
    );
  } else if (task.subtasks.length > 0) {
    box.disabled = true; // subtask-only: completes via its subtasks
    box.setAttribute("aria-label", "Completes when every subtask is ticked");
  } else {
    box.disabled = false;
    box.setAttribute("aria-label", "Mark task as done");
  }
}

// Appointment badge ladder moved to logic.js

// Re-patch the visible appointment badges in place (same idea as
// refreshCountdowns)
function refreshAppointments() {
  document.querySelectorAll(".appointment-badge").forEach((badge) => {
    const info = appointmentInfo(badge.dataset.appointment);
    if (!info) return;
    if (badge.textContent !== info.text) badge.textContent = info.text;
    const cls = "appointment-badge " + info.state;
    if (badge.className !== cls) badge.className = cls;
  });
}

// Unlock in place when an appointment moment passes while the app
// is open: re-enable the main and subtask checkboxes instead of a
// full re-render (focus and scroll stay untouched)
function unlockExpiredAppointments() {
  document.querySelectorAll(".task-item").forEach((li) => {
    const task = tasks.find((t) => t.id === li.dataset.taskId);
    if (!task || !task.appointment || task.done) return;
    if (appointmentLocked(task.appointment)) return; // still locked
    li.querySelectorAll('input[type="checkbox"]').forEach((box) => {
      if (box.dataset.role === "main") applyMainCheckboxState(box, task);
      else if (box.disabled) box.disabled = false; // subtask boxes
    });
  });
}

/* ---------- Time since (counts up from the last completion) ---------- */
// nowStamp/sinceMoment/sinceInfo moved to logic.js

// Re-patch the visible since badges in place (same idea as
// refreshCountdowns)
function refreshSinces() {
  document.querySelectorAll(".since-badge").forEach((badge) => {
    const info = sinceInfo(badge.dataset.since);
    if (!info) return;
    if (badge.textContent !== info.text) badge.textContent = info.text;
    const cls = "since-badge " + info.state;
    if (badge.className !== cls) badge.className = cls;
  });
}

// Keep cycle.dueAt in sync with the task's progress: a done task
// is due at the next boundary, an active one WITH partial progress
// too (so stale ticks clear when the cycle turns over), one
// without progress has nothing pending.
function syncCycleDue(task) {
  if (!task.cycle) return;
  // A dueAt that already passed stays: resetDueCycles() clears the
  // stale state at the next tick instead of losing the deadline
  if (task.cycle.dueAt != null && task.cycle.dueAt <= Date.now()) return;
  if (task.done) {
    task.cycle.dueAt = nextCycleBoundary(task.cycle);
    return;
  }
  // Undone: only partial progress needs a pending reset
  const progress =
    (task.repeats != null && task.repeats.current > 0) ||
    task.subtasks.some((s) => s.done);
  if (!progress) {
    task.cycle.dueAt = null;
    return;
  }
  // Calendar units reset at the next anchor-aware boundary; an
  // hourly cycle counts N hours from the FIRST partial tick (later
  // ticks don't push the moment away)
  if (task.cycle.unit !== "hour" || task.cycle.dueAt == null) {
    task.cycle.dueAt = nextCycleBoundary(task.cycle);
  }
}

// streakOnBoundary moved to logic.js

// Reset every cycle task whose time has come (progress cleared),
// no matter whether it was completed or only partially started.
// Returns true if anything changed.
function resetDueCycles() {
  const now = Date.now();
  let changed = false;
  tasks.forEach((t) => {
    if (t.cycle && t.cycle.dueAt != null && now >= t.cycle.dueAt) {
      streakOnBoundary(t); // must see `done` before it is cleared
      t.done = false;
      if (t.repeats) t.repeats.current = 0;
      t.subtasks.forEach((s) => (s.done = false));
      t.cycle.dueAt = null;
      changed = true;
    }
  });
  if (changed) {
    saveTasks();
    render();
  }
  return changed;
}

// Schedule pending resets for started-but-unfinished cycle tasks at
// load: dueAt used to exist on completed tasks only, so a partial
// task stuck from an earlier version never reset. Returns true if
// anything changed.
function backfillPartialCycles() {
  let changed = false;
  tasks.forEach((t) => {
    if (!t.cycle || t.done) return;
    const before = t.cycle.dueAt;
    syncCycleDue(t);
    if (t.cycle.dueAt !== before) changed = true;
  });
  if (changed) saveTasks();
  return changed;
}

/* ---------- Settings: global cycle anchor ---------- */

const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Anchor defaults/normalization moved to logic.js (loadCycleAnchor
// below validates stored settings through normalizeCycleAnchor)

function loadCycleAnchor() {
  try {
    const raw = localStorage.getItem(CYCLE_ANCHOR_KEY);
    return normalizeCycleAnchor(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultCycleAnchor();
  }
}

function saveCycleAnchor() {
  localStorage.setItem(CYCLE_ANCHOR_KEY, JSON.stringify(cycleAnchor));
}

// Three selects/number controls for the settings modal; they
// mutate `draft`, which is committed on submit
function buildAnchorControls(draft) {
  return (container) => {
    const wrap = document.createElement("div");
    wrap.className = "anchor-controls";

    // A labeled control styled like a modal field
    const field = (labelText) => {
      const label = document.createElement("label");
      label.className = "anchor-field";
      const text = document.createElement("span");
      text.textContent = labelText;
      label.appendChild(text);
      wrap.appendChild(label);
      return label;
    };

    // Which day starts a week
    const weekHost = field("Which day starts a week?");
    const weekSel = document.createElement("select");
    weekSel.className = "modal-input";
    weekSel.setAttribute("aria-label", "Week start day");
    WEEKDAY_NAMES.forEach((name, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = name;
      weekSel.appendChild(opt);
    });
    weekSel.value = String(draft.weekStartDay);
    weekSel.addEventListener("change", () => {
      draft.weekStartDay = Number(weekSel.value);
    });
    weekHost.appendChild(weekSel);

    // Which day starts a month (1-28 so it exists in every month)
    const dayHost = field("Which day starts a month?");
    const dayInput = document.createElement("input");
    dayInput.type = "number";
    dayInput.min = "1";
    dayInput.max = "28";
    dayInput.step = "1";
    dayInput.className = "modal-input";
    dayInput.value = draft.monthStartDay;
    dayInput.setAttribute("aria-label", "Month start day");
    dayInput.addEventListener("input", () => {
      const v = Math.floor(Number(dayInput.value));
      if (v >= 1 && v <= 28) draft.monthStartDay = v;
    });
    dayHost.appendChild(dayInput);

    // Which month starts the period (matters for every N months)
    const anchorHost = field("Which month starts the period?");
    const monthSel = document.createElement("select");
    monthSel.className = "modal-input";
    monthSel.setAttribute("aria-label", "Period start month");
    MONTH_NAMES.forEach((name, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = name;
      monthSel.appendChild(opt);
    });
    monthSel.value = String(draft.monthAnchor);
    monthSel.addEventListener("change", () => {
      draft.monthAnchor = Number(monthSel.value);
    });
    anchorHost.appendChild(monthSel);

    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent =
      "Applies to every day, week and month cycle. Hour cycles always restart N hours after you complete them.";
    wrap.appendChild(hint);

    container.appendChild(wrap);
  };
}

function openSettingsModal() {
  const draft = { ...cycleAnchor };
  Modal.open({
    title: "Cycle reset",
    // The message asking what time the cycle starts is this field's label
    fields: [
      { name: "time", label: "What time does the cycle start?", type: "time", value: draft.time },
    ],
    submitLabel: "Save",
    extra: buildAnchorControls(draft),
    onSubmit: ({ time }) => {
      draft.time = time;
      Object.assign(cycleAnchor, normalizeCycleAnchor(draft));
      saveCycleAnchor();
      applyCycleAnchor();
    },
  });
}

// Re-anchor pending cycle resets after the global setting changed;
// runs the reset check right away so an anchor that already passed
// fires immediately
function applyCycleAnchor() {
  let changed = false;
  tasks.forEach((t) => {
    // Re-anchor done tasks and started-but-unfinished ones (their
    // pending partial reset follows the anchor too); clean undone
    // tasks have no dueAt and stay untouched
    if (t.cycle && t.cycle.unit !== "hour" && (t.done || t.cycle.dueAt != null)) {
      const due = nextCycleBoundary(t.cycle);
      if (t.cycle.dueAt !== due) {
        t.cycle.dueAt = due;
        changed = true;
      }
    }
  });
  if (changed) saveTasks();
  resetDueCycles();
}

/* ---------- Repeat / subtask / cycle modes (combinable) ---------- */

// Shared state for the repeat/subtask/cycle controls in the task modals
function createModesState(task = null) {
  // Split the stored deadline/appointment/since ("YYYY-MM-DD" or
  // "...THH:mm") into the two inputs; empty date = none
  const deadline = task && typeof task.deadline === "string" ? task.deadline : "";
  const appointment =
    task && typeof task.appointment === "string" ? task.appointment : "";
  const since = task && typeof task.since === "string" ? task.since : "";
  return {
    repeatOn: !!(task && task.repeats),
    target: task && task.repeats ? task.repeats.target : 5,
    // Carry ids/done over when editing so progress is preserved
    subtasks: task && task.subtasks.length ? task.subtasks.map((s) => ({ ...s })) : [],
    // Cycle is orthogonal: it combines with repeat/subtasks
    cycleOn: !!(task && task.cycle),
    cycleEvery: task && task.cycle ? task.cycle.every : 1,
    cycleUnit: task && task.cycle ? task.cycle.unit : "day",
    // Deadline: separate date/time inputs, recomposed on save
    deadlineDate: deadline.slice(0, 10),
    deadlineTime: deadline.length > 10 ? deadline.slice(11) : "",
    // Appointment: same split, mutually exclusive with the deadline
    appointmentDate: appointment.slice(0, 10),
    appointmentTime: appointment.length > 10 ? appointment.slice(11) : "",
    // Time since: independent record, same split
    sinceDate: since.slice(0, 10),
    sinceTime: since.length > 10 ? since.slice(11) : "",
  };
}

// Convert modal state to task data (repeat and subtasks can
// combine; cycle and deadline independent). The cycle comes back
// with a null dueAt - syncCycleDue fills it in when the task is
// done.
function modesToData(state, original = null) {
  let cycle = null;
  if (state.cycleOn) {
    const every = Math.max(1, Math.floor(Number(state.cycleEvery)) || 1);
    const unit = CYCLE_UNITS.includes(state.cycleUnit) ? state.cycleUnit : "day";
    cycle = { every, unit, dueAt: null };
  }
  let repeats = null;
  if (state.repeatOn) {
    const target = Math.max(1, Math.floor(Number(state.target)) || 1);
    const current =
      original && original.repeats ? Math.min(original.repeats.current, target) : 0;
    repeats = { current, target };
  }
  const subs = state.subtasks.filter((s) => s.text.trim() !== "");
  const subtasks = subs.map((s) => ({
    id: s.id || makeId(),
    text: s.text.trim(),
    done: !!s.done,
  }));
  // Deadline: date required, time optional (date-only = end of day).
  // Appointment: same shape, but the two are mutually exclusive -
  // deadline wins on conflicting state (the UI auto-clears anyway)
  const deadline = state.deadlineDate
    ? state.deadlineTime
      ? `${state.deadlineDate}T${state.deadlineTime}`
      : state.deadlineDate
    : null;
  const appointment = !deadline && state.appointmentDate
    ? state.appointmentTime
      ? `${state.appointmentDate}T${state.appointmentTime}`
      : state.appointmentDate
    : null;
  // Time since: independent of the two above - a task can have all
  // three; empty date = the mode is off
  const since = state.sinceDate
    ? state.sinceTime
      ? `${state.sinceDate}T${state.sinceTime}`
      : state.sinceDate
    : null;
  return { repeats, subtasks, cycle, deadline, appointment, since };
}

// Repeat toggle + target input, and dynamic subtask rows.
// Mutates `state` in place; re-renders via Modal.refresh().
function buildModes(state) {
  return (container) => {
    const block = document.createElement("div");
    block.className = "modes";

    // Date/time fields sync on both events: some pickers only
    // fire "change" when a value is committed or cleared
    const onEdit = (el, fn) => {
      el.addEventListener("input", fn);
      el.addEventListener("change", fn);
    };

    // --- Repeat ---
    const repeat = document.createElement("div");
    repeat.className = "mode-block";

    const head = document.createElement("div");
    head.className = "mode-head";

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "mode-toggle repeat-toggle";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = state.repeatOn;
    toggle.addEventListener("change", () => {
      state.repeatOn = toggle.checked;
      // Suggest target = subtask count when both modes are on
      // (a manually typed target sticks until subtasks change)
      if (state.repeatOn && state.subtasks.length > 0) {
        state.target = state.subtasks.length;
      }
      Modal.refresh();
      const again = document.querySelector(".repeat-toggle input");
      if (again) again.focus();
    });
    const toggleText = document.createElement("span");
    toggleText.textContent = "Repeat";
    toggleLabel.append(toggle, toggleText);
    head.appendChild(toggleLabel);

    if (state.repeatOn) {
      const targetWrap = document.createElement("label");
      targetWrap.className = "target-wrap";
      const targetInput = document.createElement("input");
      targetInput.type = "number";
      targetInput.min = "1";
      targetInput.step = "1";
      targetInput.className = "modal-input target-input";
      targetInput.value = state.target;
      targetInput.setAttribute("aria-label", "Repeat target");
      targetInput.addEventListener("input", () => {
        state.target = targetInput.value;
      });
      const suffix = document.createElement("span");
      suffix.className = "target-suffix";
      suffix.textContent = "times";
      targetWrap.append(targetInput, suffix);
      head.appendChild(targetWrap);
    }

    repeat.appendChild(head);
    if (state.repeatOn) {
      const help = document.createElement("p");
      help.className = "hint";
      help.textContent =
        state.subtasks.length > 0
          ? "Each subtask tick adds 1 to the counter; the task completes at the target."
          : "The task completes when the counter reaches the target.";
      repeat.appendChild(help);
    }
    block.appendChild(repeat);

    // --- Cycle (orthogonal: combines with repeat/subtasks) ---
    const cyc = document.createElement("div");
    cyc.className = "mode-block";

    const cycHead = document.createElement("div");
    cycHead.className = "mode-head";

    const cycLabel = document.createElement("label");
    cycLabel.className = "mode-toggle cycle-toggle";
    const cycToggle = document.createElement("input");
    cycToggle.type = "checkbox";
    cycToggle.checked = state.cycleOn;
    cycToggle.addEventListener("change", () => {
      state.cycleOn = cycToggle.checked;
      Modal.refresh();
      const again = document.querySelector(".cycle-toggle input");
      if (again) again.focus();
    });
    const cycText = document.createElement("span");
    cycText.textContent = "Cycle";
    cycLabel.append(cycToggle, cycText);
    cycHead.appendChild(cycLabel);

    if (state.cycleOn) {
      const sched = document.createElement("div");
      sched.className = "target-wrap";

      const everyInput = document.createElement("input");
      everyInput.type = "number";
      everyInput.min = "1";
      everyInput.step = "1";
      everyInput.className = "modal-input target-input";
      everyInput.value = state.cycleEvery;
      everyInput.setAttribute("aria-label", "Cycle length");
      everyInput.addEventListener("input", () => {
        state.cycleEvery = everyInput.value;
      });

      const unitSel = document.createElement("select");
      unitSel.className = "modal-input unit-select";
      unitSel.setAttribute("aria-label", "Cycle unit");
      const unitNames = { hour: "hours", day: "days", week: "weeks", month: "months" };
      CYCLE_UNITS.forEach((u) => {
        const opt = document.createElement("option");
        opt.value = u;
        opt.textContent = unitNames[u];
        unitSel.appendChild(opt);
      });
      unitSel.value = state.cycleUnit;
      unitSel.addEventListener("change", () => {
        state.cycleUnit = unitSel.value;
      });

      sched.append(everyInput, unitSel);
      cycHead.appendChild(sched);
    }

    cyc.appendChild(cycHead);
    if (state.cycleOn) {
      const help = document.createElement("p");
      help.className = "hint";
      help.textContent = "When the period ends the task starts over automatically.";
      cyc.appendChild(help);
    }
    block.appendChild(cyc);

    // --- Deadline / Appointment / Time since (on/off like the cycle) ---
    // A toggle shows the block's inputs; unchecking clears the
    // stored value (removed on save) and hides them again. Enabling
    // prefills a default: today (the current minute for "since").
    // Deadline and appointment exclude each other at the toggle
    // level; "since" stays independent.
    const dl = document.createElement("div");
    dl.className = "mode-block";

    const dlHead = document.createElement("div");
    dlHead.className = "mode-head";

    const dlLabel = document.createElement("label");
    dlLabel.className = "mode-toggle deadline-toggle";
    const dlToggle = document.createElement("input");
    dlToggle.type = "checkbox";
    dlToggle.checked = state.deadlineDate !== "";
    dlToggle.addEventListener("change", () => {
      if (dlToggle.checked) {
        state.deadlineDate = nowStamp().slice(0, 10);
        state.deadlineTime = "";
        // Mutually exclusive with the appointment
        state.appointmentDate = "";
        state.appointmentTime = "";
      } else {
        state.deadlineDate = "";
        state.deadlineTime = "";
      }
      Modal.refresh();
      const again = document.querySelector(".deadline-toggle input");
      if (again) again.focus();
    });
    const dlText = document.createElement("span");
    dlText.textContent = "Deadline";
    dlLabel.append(dlToggle, dlText);
    dlHead.appendChild(dlLabel);
    dl.appendChild(dlHead);

    if (state.deadlineDate) {
      const dlInputs = document.createElement("div");
      dlInputs.className = "target-wrap deadline-wrap";

      const dlDate = document.createElement("input");
      dlDate.type = "date";
      dlDate.className = "modal-input deadline-input";
      dlDate.value = state.deadlineDate;
      dlDate.setAttribute("aria-label", "Deadline date");

      const dlTime = document.createElement("input");
      dlTime.type = "time";
      dlTime.className = "modal-input deadline-input";
      dlTime.value = state.deadlineTime;
      dlTime.setAttribute("aria-label", "Deadline time (optional)");

      onEdit(dlDate, () => {
        state.deadlineDate = dlDate.value;
      });
      onEdit(dlTime, () => {
        state.deadlineTime = dlTime.value;
      });

      dlInputs.append(dlDate, dlTime);
      dlHead.appendChild(dlInputs);

      const dlHelp = document.createElement("p");
      dlHelp.className = "hint";
      dlHelp.textContent =
        "No time set = counts to the end of that day. With a time it counts days, then hours, then 10 minutes. Can\u2019t be combined with an appointment. Uncheck to remove.";
      dl.appendChild(dlHelp);
    }
    block.appendChild(dl);

    const ap = document.createElement("div");
    ap.className = "mode-block";

    const apHead = document.createElement("div");
    apHead.className = "mode-head";

    const apLabel = document.createElement("label");
    apLabel.className = "mode-toggle appointment-toggle";
    const apToggle = document.createElement("input");
    apToggle.type = "checkbox";
    apToggle.checked = state.appointmentDate !== "";
    apToggle.addEventListener("change", () => {
      if (apToggle.checked) {
        state.appointmentDate = nowStamp().slice(0, 10);
        state.appointmentTime = "";
        // Mutually exclusive with the deadline
        state.deadlineDate = "";
        state.deadlineTime = "";
      } else {
        state.appointmentDate = "";
        state.appointmentTime = "";
      }
      Modal.refresh();
      const again = document.querySelector(".appointment-toggle input");
      if (again) again.focus();
    });
    const apText = document.createElement("span");
    apText.textContent = "Appointment";
    apLabel.append(apToggle, apText);
    apHead.appendChild(apLabel);
    ap.appendChild(apHead);

    if (state.appointmentDate) {
      const apInputs = document.createElement("div");
      apInputs.className = "target-wrap deadline-wrap";

      const apDate = document.createElement("input");
      apDate.type = "date";
      apDate.className = "modal-input deadline-input";
      apDate.value = state.appointmentDate;
      apDate.setAttribute("aria-label", "Appointment date");

      const apTime = document.createElement("input");
      apTime.type = "time";
      apTime.className = "modal-input deadline-input";
      apTime.value = state.appointmentTime;
      apTime.setAttribute("aria-label", "Appointment time (optional)");

      onEdit(apDate, () => {
        state.appointmentDate = apDate.value;
      });
      onEdit(apTime, () => {
        state.appointmentTime = apTime.value;
      });

      apInputs.append(apDate, apTime);
      apHead.appendChild(apInputs);

      const apHelp = document.createElement("p");
      apHelp.className = "hint";
      apHelp.textContent =
        "The task stays locked until this moment (00:00 of the day without a time), then reads \u201cnow\u201d. Can\u2019t be combined with a deadline. Uncheck to remove.";
      ap.appendChild(apHelp);
    }
    block.appendChild(ap);

    // Time since (independent of deadline/appointment)
    const sc = document.createElement("div");
    sc.className = "mode-block";

    const scHead = document.createElement("div");
    scHead.className = "mode-head";

    const scLabel = document.createElement("label");
    scLabel.className = "mode-toggle since-toggle";
    const scToggle = document.createElement("input");
    scToggle.type = "checkbox";
    scToggle.checked = state.sinceDate !== "";
    scToggle.addEventListener("change", () => {
      if (scToggle.checked) {
        const stamp = nowStamp();
        state.sinceDate = stamp.slice(0, 10);
        state.sinceTime = stamp.slice(11);
      } else {
        state.sinceDate = "";
        state.sinceTime = "";
      }
      Modal.refresh();
      const again = document.querySelector(".since-toggle input");
      if (again) again.focus();
    });
    const scText = document.createElement("span");
    scText.textContent = "Time since";
    scLabel.append(scToggle, scText);
    scHead.appendChild(scLabel);
    sc.appendChild(scHead);

    if (state.sinceDate) {
      const scInputs = document.createElement("div");
      scInputs.className = "target-wrap deadline-wrap";

      const scDate = document.createElement("input");
      scDate.type = "date";
      scDate.className = "modal-input deadline-input";
      scDate.value = state.sinceDate;
      scDate.setAttribute("aria-label", "Last time date");

      const scTime = document.createElement("input");
      scTime.type = "time";
      scTime.className = "modal-input deadline-input";
      scTime.value = state.sinceTime;
      scTime.setAttribute("aria-label", "Last time time (optional)");

      const nowBtn = document.createElement("button");
      nowBtn.type = "button";
      nowBtn.className = "now-btn";
      nowBtn.textContent = "Now";
      nowBtn.setAttribute("aria-label", "Set the last time to now");
      nowBtn.addEventListener("click", () => {
        const stamp = nowStamp();
        state.sinceDate = stamp.slice(0, 10);
        state.sinceTime = stamp.slice(11);
        scDate.value = state.sinceDate;
        scTime.value = state.sinceTime;
      });

      onEdit(scDate, () => {
        state.sinceDate = scDate.value;
      });
      onEdit(scTime, () => {
        state.sinceTime = scTime.value;
      });

      scInputs.append(scDate, scTime, nowBtn);
      scHead.appendChild(scInputs);

      const scHelp = document.createElement("p");
      scHelp.className = "hint";
      scHelp.textContent =
        "Counts up from the last time you did this; completing the task resets it to now. No time set = starts at 00:00 of that day. Uncheck to remove.";
      sc.appendChild(scHelp);
    }
    block.appendChild(sc);

    // --- Subtasks ---
    const subs = document.createElement("div");
    subs.className = "mode-block";

    const subsHead = document.createElement("div");
    subsHead.className = "mode-head";
    const subsTitle = document.createElement("span");
    subsTitle.className = "mode-title";
    subsTitle.textContent = "Subtasks";
    subsHead.appendChild(subsTitle);

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "add-row-btn";
    addBtn.textContent = "+ Add subtask";
    addBtn.addEventListener("click", () => {
      state.subtasks.push({ id: null, text: "", done: false });
      // Suggest target = subtask count when repeat is on
      if (state.repeatOn) state.target = state.subtasks.length;
      Modal.refresh();
      const rows = document.querySelectorAll(".subtask-row input");
      if (rows.length) rows[rows.length - 1].focus();
    });
    subsHead.appendChild(addBtn);
    subs.appendChild(subsHead);

    if (state.subtasks.length > 0) {
      const rowsWrap = document.createElement("div");
      rowsWrap.className = "subtask-rows";
      state.subtasks.forEach((sub, i) => {
        const row = document.createElement("div");
        row.className = "subtask-row";

        const input = document.createElement("input");
        input.type = "text";
        input.className = "modal-input";
        input.placeholder = "Subtask " + (i + 1);
        input.value = sub.text;
        input.addEventListener("input", () => {
          sub.text = input.value;
        });

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "icon-btn delete-btn row-remove";
        remove.textContent = "×";
        remove.setAttribute("aria-label", "Remove subtask");
        remove.addEventListener("click", () => {
          state.subtasks.splice(i, 1);
          // Keep the suggested target in step with the subtask count
          if (state.repeatOn && state.subtasks.length > 0) {
            state.target = state.subtasks.length;
          }
          Modal.refresh();
        });

        row.append(input, remove);
        rowsWrap.appendChild(row);
      });
      subs.appendChild(rowsWrap);
    }
    block.appendChild(subs);

    container.appendChild(block);
  };
}

function openNewTaskModal() {
  const selected = new Set(); // no tags pre-selected
  const modes = createModesState();
  Modal.open({
    title: "New task",
    fields: [{ name: "text", label: "Task", placeholder: "What needs to be done?" }],
    submitLabel: "Add",
    extra: (container) => {
      buildModes(modes)(container);
      buildTagChips(selected)(container);
    },
    onSubmit: ({ text }) => {
      const { repeats, subtasks, cycle, deadline, appointment, since } = modesToData(modes);
      addTask(text, orderedTags(selected), { repeats, subtasks, cycle, deadline, appointment, since });
    },
  });
}

function openCategoriesModal() {
  Modal.open({
    title: "Categories",
    fields: [{ name: "name", label: "Category name", placeholder: "e.g. Work" }],
    submitLabel: "Add",
    keepOpen: true, // stay open so chips update in place
    extra: renderCategoryChips,
    onSubmit: ({ name }) => {
      addCategory(name);
      Modal.refresh();
      // Clear and refocus the field for the next entry
      const input = document.getElementById("modal-field-name");
      if (input) {
        input.value = "";
        input.focus();
      }
    },
  });
}

// Chips + empty hint rendered inside the categories modal
function renderCategoryChips(container) {
  if (categories.length === 0) {
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "No categories yet. Add one above.";
    container.appendChild(hint);
    return;
  }

  const list = document.createElement("div");
  list.className = "category-list";
  categories.forEach((cat) => {
    const chip = document.createElement("span");
    chip.className = "category-chip";

    const name = document.createElement("span");
    name.className = "chip-name";
    name.textContent = cat.name;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "chip-delete";
    del.textContent = "×";
    del.setAttribute("aria-label", `Delete category ${cat.name}`);
    del.addEventListener("click", () => {
      deleteCategory(cat.id);
      Modal.refresh();
    });

    chip.append(name, del);
    list.appendChild(chip);
  });
  container.appendChild(list);
}

function openEditTaskModal(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;

  // Selected tags as a Set for easy toggling while the modal is open
  const selected = new Set(task.tags.filter((tagId) => categoryById(tagId)));
  const modes = createModesState(task);

  Modal.open({
    title: "Edit task",
    fields: [{ name: "text", label: "Task", value: task.text }],
    submitLabel: "Save",
    extra: (container) => {
      buildModes(modes)(container);
      buildTagChips(selected)(container);
    },
    onSubmit: ({ text }) => {
      const { repeats, subtasks, cycle, deadline, appointment, since } = modesToData(modes, task);
      const prevCycle = task.cycle; // read before overwrite
      task.text = text;
      task.tags = orderedTags(selected);
      task.repeats = repeats;
      task.subtasks = subtasks;
      task.cycle = cycle;
      task.deadline = deadline;
      task.appointment = appointment;
      task.since = since;
      // Normalize completion for the (possibly new) mode
      if (repeats) task.done = repeats.current >= repeats.target;
      else if (subtasks.length > 0) task.done = subtasks.every((s) => s.done);
      // Keep dueAt when the schedule is unchanged, recompute otherwise.
      // Undone: keep a pending partial reset (syncCycleDue); a changed
      // schedule recomputes it from scratch. Done: keep the boundary
      // when the schedule is the same (it counts from completion)
      if (task.cycle) {
        const sameSchedule =
          prevCycle &&
          prevCycle.every === task.cycle.every &&
          prevCycle.unit === task.cycle.unit;
        if (task.done) {
          task.cycle.dueAt =
            sameSchedule && prevCycle.dueAt != null
              ? prevCycle.dueAt
              : nextCycleBoundary(task.cycle);
        } else {
          if (!sameSchedule) task.cycle.dueAt = null;
          syncCycleDue(task);
        }
      }
      saveTasks();
      render();
    },
  });
}

/* ---------- Categories ---------- */

function addCategory(name) {
  categories.push({ id: makeId(), name });
  saveCategories();
  render();
}

function deleteCategory(id) {
  categories = categories.filter((c) => c.id !== id);
  // Remove the category from every task's tags
  tasks.forEach((t) => {
    t.tags = t.tags.filter((tagId) => tagId !== id);
  });
  saveCategories();
  saveTasks();
  render();
}

/* ---------- Tasks ---------- */

function addTask(text, tags = [], mode = {}) {
  tasks.push({
    id: makeId(),
    text,
    done: false,
    tags,
    repeats: mode.repeats || null,
    subtasks: mode.subtasks || [],
    cycle: mode.cycle || null,
    deadline: mode.deadline || null,
    appointment: mode.appointment || null,
    since: mode.since || null,
    streak: 0,
  });
  saveTasks();
  render();
}

function toggleTask(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  if (!task.done && appointmentLocked(task.appointment)) return; // locked
  const wasDone = task.done;

  if (task.repeats) {
    if (task.done) {
      // Completed repetition: untick starts a new cycle at 0
      // and clears any subtasks (full reset)
      task.repeats.current = 0;
      task.subtasks.forEach((s) => (s.done = false));
      task.done = false;
    } else if (task.subtasks.length > 0) {
      // Combined task: the main checkbox completes it immediately
      // and fills the counter (subtasks stay as they are)
      task.repeats.current = task.repeats.target;
      task.done = true;
    } else {
      // Counter-only: ticking adds one; reaching the target
      // completes the task
      task.repeats.current = Math.min(task.repeats.current + 1, task.repeats.target);
      task.done = task.repeats.current >= task.repeats.target;
    }
  } else if (task.subtasks.length > 0) {
    return; // main checkbox is disabled for subtask-only tasks
  } else {
    task.done = !task.done;
  }

  // A completion stamps the "time since" record; resets keep it
  if (task.since != null && task.done && !wasDone) task.since = nowStamp();
  // The done counter log follows user-driven transitions only
  if (task.done !== wasDone) logDoneChange(task.id, task.done);
  syncCycleDue(task);
  saveTasks();
  render();
}

function toggleSubtask(taskId, subtaskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  if (!task.done && appointmentLocked(task.appointment)) return; // locked
  const wasDone = task.done;
  const sub = task.subtasks.find((s) => s.id === subtaskId);
  if (!sub) return;

  if (task.repeats) {
    // Combined task: a click always means "done again" - the
    // subtask stays checked and the counter grows (capped at
    // target). It can't be unchecked here; only the main reset
    // (untick when done) clears it
    sub.done = true;
    task.repeats.current = Math.min(task.repeats.current + 1, task.repeats.target);
    // Completion is counter-driven, leftover subtasks don't block it
    task.done = task.repeats.current >= task.repeats.target;
    // First completion or "done again" stamps the since record
    if (task.since != null && task.done) task.since = nowStamp();
  } else {
    // Subtask-only: normal toggle, completes when every subtask is ticked
    sub.done = !sub.done;
    task.done = task.subtasks.length > 0 && task.subtasks.every((s) => s.done);
    if (task.since != null && task.done && !wasDone) task.since = nowStamp();
  }
  // The done counter log follows user-driven transitions only
  // (a "done again" click on an already-done task doesn't count)
  if (task.done !== wasDone) logDoneChange(task.id, task.done);
  syncCycleDue(task);
  saveTasks();
  render();
}

function deleteTask(id) {
  tasks = tasks.filter((t) => t.id !== id);
  saveTasks();
  render();
}

/* ---------- Rendering ---------- */

function render() {
  renderTasks();
  renderStats();
}

// Patch the summary cells from the current counts (the day
// streak rides along - doneCounts stays completions-only)
function renderStats() {
  const counts = { ...doneCounts(), streak: dayStreak() };
  document.querySelectorAll("[data-stat]").forEach((el) => {
    const value = counts[el.dataset.stat];
    el.textContent = el.dataset.stat === "total" ? value.toLocaleString() : String(value);
  });
}

function renderTasks() {
  taskList.innerHTML = "";

  // Display-only split by state (replaces goal 6's pending-first
  // sort): the category sections hold pending tasks, a Done
  // section at the end repeats the grouping with the completed
  // ones. Within a section tasks keep their creation order.
  const pending = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  // Groups: one per category in creation order, Uncategorized last
  const buildGroups = (list) => {
    const groups = [];
    categories.forEach((cat) => {
      // Multi-tagged tasks repeat in each matching section
      groups.push({
        title: cat.name,
        tasks: list.filter((t) => t.tags.includes(cat.id)),
      });
    });
    groups.push({
      title: "Uncategorized",
      tasks: list.filter((t) => t.tags.length === 0),
    });
    return groups;
  };

  const makeUl = (list) => {
    const ul = document.createElement("ul");
    ul.className = "group-tasks";
    list.forEach((task) => ul.appendChild(renderTaskItem(task)));
    return ul;
  };

  // Pending categories first (groups without pending tasks are skipped)
  buildGroups(pending).forEach((group) => {
    if (group.tasks.length === 0) return;

    const section = document.createElement("section");
    section.className = "task-group";

    const title = document.createElement("h3");
    title.className = "group-title";
    title.textContent = group.title;

    section.append(title, makeUl(group.tasks));
    taskList.appendChild(section);
  });

  // Done section: the same grouping again, completed tasks only.
  // Subtasks are never separate entries - the task moves here as
  // one unit, with its checklist exactly as it is
  if (done.length > 0) {
    const wrap = document.createElement("section");
    wrap.className = "task-group done-section";

    const wrapTitle = document.createElement("h3");
    wrapTitle.className = "group-title done-title";
    wrapTitle.textContent = "Done (" + done.length + ")";
    wrap.appendChild(wrapTitle);

    buildGroups(done).forEach((group) => {
      if (group.tasks.length === 0) return;

      const sub = document.createElement("div");
      sub.className = "done-group";

      const title = document.createElement("h4");
      title.className = "group-subtitle";
      title.textContent = group.title;

      sub.append(title, makeUl(group.tasks));
      wrap.appendChild(sub);
    });

    taskList.appendChild(wrap);
  }

  emptyState.classList.toggle("visible", tasks.length === 0);
}

function renderTaskItem(task) {
  const li = document.createElement("li");
  li.className = "task-item" + (task.done ? " done" : "");
  li.dataset.taskId = task.id; // hooks for in-place appointment unlock

  const hasSubs = task.subtasks.length > 0;
  const locked = !task.done && appointmentLocked(task.appointment);

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = task.done;
  checkbox.dataset.role = "main";
  // Base role combined with the appointment lock (aria-label too)
  applyMainCheckboxState(checkbox, task);
  checkbox.addEventListener("change", () => toggleTask(task.id));

  const main = document.createElement("div");
  main.className = "task-main";

  const line = document.createElement("div");
  line.className = "task-line";

  // Task name first, then the badges (cycle, counter)
  const text = document.createElement("span");
  text.className = "task-text";
  text.textContent = task.text;
  line.appendChild(text);

  if (task.cycle) {
    const badge = document.createElement("span");
    badge.className = "cycle-badge" + (task.done ? " complete" : "");
    badge.textContent = cycleLabel(task.cycle);
    line.appendChild(badge);
  }

  // Streak: cycled tasks only (hour cycles out of scope),
  // hidden while it is 0; fresh on every render
  if (task.cycle && task.cycle.unit !== "hour" && task.streak >= 1) {
    const badge = document.createElement("span");
    badge.className = "streak-badge";
    badge.textContent = "🔥 " + task.streak;
    line.appendChild(badge);
  }

  if (task.repeats) {
    const badge = document.createElement("span");
    badge.className = "counter" + (task.done ? " complete" : "");
    badge.textContent = `${task.repeats.current}/${task.repeats.target}`;
    line.appendChild(badge);
  }

  // Countdown: hidden when done or without a (valid) deadline
  if (!task.done && task.deadline) {
    const info = countdownInfo(task.deadline);
    if (info) {
      const badge = document.createElement("span");
      badge.className = "countdown-badge " + info.state;
      badge.textContent = info.text;
      badge.dataset.deadline = task.deadline; // for the 60s refresh
      line.appendChild(badge);
    }
  }

  // Appointment: same slot (mutually exclusive with the deadline),
  // hidden when done or without a (valid) appointment
  if (!task.done && task.appointment) {
    const info = appointmentInfo(task.appointment);
    if (info) {
      const badge = document.createElement("span");
      badge.className = "appointment-badge " + info.state;
      badge.textContent = info.text;
      badge.dataset.appointment = task.appointment; // for the 60s refresh
      line.appendChild(badge);
    }
  }

  // Time since: counts up from the last completion and stays
  // visible even when the task is done
  if (task.since) {
    const info = sinceInfo(task.since);
    if (info) {
      const badge = document.createElement("span");
      badge.className = "since-badge " + info.state;
      badge.textContent = info.text;
      badge.dataset.since = task.since; // for the 60s refresh
      line.appendChild(badge);
    }
  }

  main.appendChild(line);

  if (hasSubs) {
    const subUl = document.createElement("ul");
    subUl.className = "subtask-list";
    task.subtasks.forEach((sub) => {
      const subLi = document.createElement("li");
      subLi.className = "subtask-item" + (sub.done ? " done" : "");

      const subCheck = document.createElement("input");
      subCheck.type = "checkbox";
      subCheck.checked = sub.done;
      subCheck.disabled = locked; // future appointment locks subtasks
      subCheck.setAttribute("aria-label", `Subtask: ${sub.text}`);
      subCheck.addEventListener("change", () => toggleSubtask(task.id, sub.id));

      const subText = document.createElement("span");
      subText.textContent = sub.text;

      subLi.append(subCheck, subText);
      subUl.appendChild(subLi);
    });
    main.appendChild(subUl);
  }

  const tags = task.tags.map(categoryById).filter(Boolean);
  if (tags.length > 0) {
    const tagRow = document.createElement("div");
    tagRow.className = "task-tags";
    tags.forEach((cat) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = cat.name;
      tagRow.appendChild(chip);
    });
    main.appendChild(tagRow);
  }

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "icon-btn edit-btn";
  editBtn.textContent = "✎";
  editBtn.setAttribute("aria-label", "Edit task");
  editBtn.title = "Edit task";
  editBtn.addEventListener("click", () => openEditTaskModal(task.id));

  const del = document.createElement("button");
  del.type = "button";
  del.className = "icon-btn delete-btn";
  del.textContent = "×";
  del.setAttribute("aria-label", "Delete task");
  del.addEventListener("click", () => deleteTask(task.id));

  li.append(checkbox, main, editBtn, del);
  return li;
}

/* ---------- Events ---------- */

newTaskBtn.addEventListener("click", openNewTaskModal);
categoriesBtn.addEventListener("click", openCategoriesModal);
settingsBtn.addEventListener("click", openSettingsModal);

// Schedule partial cycle tasks stuck from earlier versions, reset
// cycle tasks that came due while the app was closed, then keep
// everything fresh every minute: cycle resets, badge texts,
// expired appointment locks (in place, no full render) and the
// done counter (so "Today" rolls over at midnight)
backfillPartialCycles();
resetDueCycles();
render();
setInterval(() => {
  resetDueCycles();
  refreshCountdowns();
  refreshAppointments();
  refreshSinces();
  unlockExpiredAppointments();
  renderStats();
}, 60 * 1000);
