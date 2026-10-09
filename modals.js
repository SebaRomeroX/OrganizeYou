// OrganizeYou - modal orchestration (ES module, DOM)
//
// Everything that opens a dialog: the repeat/subtask/cycle/
// deadline modes builder, the tag chips, the category manager and
// the settings (cycle anchor) dialog. The reusable dialog shell
// itself lives in modal.js; rendering/commands live in render.js
// and are imported here (one direction only).
import { CYCLE_UNITS, categoryById, store } from "./state.js";
import { Modal } from "./modal.js";
import { render, addTask, addCategory, deleteCategory } from "./render.js";
import { makeId, saveCycleAnchor, saveTasks } from "./storage.js";
import { applyCycleAnchor, syncCycleDue } from "./cycles.js";
import { nextCycleBoundary, normalizeCycleAnchor, nowStamp } from "./logic.js";

const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/* ---------- Tag chips ---------- */

// Shared tag toggle chips for the new/edit task modals.
// Mutates `selected` (a Set of category ids) in place.
function buildTagChips(selected) {
  return (container) => {
    if (store.categories.length === 0) {
      const hint = document.createElement("span");
      hint.className = "picker-empty";
      hint.textContent = "No categories yet. Create one first.";
      container.appendChild(hint);
      return;
    }
    store.categories.forEach((cat) => {
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
  return store.categories.map((c) => c.id).filter((id) => selected.has(id));
}

/* ---------- Settings: global cycle anchor ---------- */

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

export function openSettingsModal() {
  const draft = { ...store.cycleAnchor };
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
      Object.assign(store.cycleAnchor, normalizeCycleAnchor(draft));
      saveCycleAnchor();
      // Re-anchor + immediate reset check; re-render when a task
      // actually reset (matches the old engine's behavior)
      if (applyCycleAnchor()) render();
    },
  });
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

/* ---------- Openers ---------- */

export function openNewTaskModal() {
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

export function openCategoriesModal() {
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
  if (store.categories.length === 0) {
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "No categories yet. Add one above.";
    container.appendChild(hint);
    return;
  }

  const list = document.createElement("div");
  list.className = "category-list";
  store.categories.forEach((cat) => {
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

export function openEditTaskModal(id) {
  const task = store.tasks.find((t) => t.id === id);
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
