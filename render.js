// OrganizeYou - rendering + the commands that re-render (ES module)
//
// The view builds the DOM from `store`; every command that changes
// data saves and re-renders, so they live next to the renderer.
// The one edge pointing out of this file - opening the edit modal
// - is late-bound by the entry (setEditTaskHandler) to keep the
// import graph acyclic (modals.js imports render.js).
import { categoryById, store } from "./state.js";
import {
  appointmentInfo,
  appointmentLocked,
  countdownInfo,
  cycleLabel,
  dayStreak,
  doneCounts,
  nowStamp,
  sinceInfo,
} from "./logic.js";
import { applyMainCheckboxState } from "./badges.js";
import { syncCycleDue } from "./cycles.js";
import { logDoneChange, makeId, saveCategories, saveTasks } from "./storage.js";

const taskList = document.getElementById("task-list");
const emptyState = document.getElementById("empty-state");

// Late-bound: the entry wires in openEditTaskModal so this file
// never imports modals.js (which imports this file)
let editTaskHandler = () => {};
export function setEditTaskHandler(fn) {
  editTaskHandler = fn;
}

/* ---------- Categories ---------- */

export function addCategory(name) {
  store.categories.push({ id: makeId(), name });
  saveCategories();
  render();
}

export function deleteCategory(id) {
  store.categories = store.categories.filter((c) => c.id !== id);
  // Remove the category from every task's tags
  store.tasks.forEach((t) => {
    t.tags = t.tags.filter((tagId) => tagId !== id);
  });
  saveCategories();
  saveTasks();
  render();
}

/* ---------- Tasks ---------- */

export function addTask(text, tags = [], mode = {}) {
  store.tasks.push({
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

export function toggleTask(id) {
  const task = store.tasks.find((t) => t.id === id);
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

export function toggleSubtask(taskId, subtaskId) {
  const task = store.tasks.find((t) => t.id === taskId);
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

export function deleteTask(id) {
  store.tasks = store.tasks.filter((t) => t.id !== id);
  saveTasks();
  render();
}

/* ---------- Rendering ---------- */

export function render() {
  renderTasks();
  renderStats();
}

// Patch the summary cells from the current counts (the day
// streak rides along - doneCounts stays completions-only)
export function renderStats() {
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
  const pending = store.tasks.filter((t) => !t.done);
  const done = store.tasks.filter((t) => t.done);

  // Groups: one per category in creation order, Uncategorized last
  const buildGroups = (list) => {
    const groups = [];
    store.categories.forEach((cat) => {
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

  emptyState.classList.toggle("visible", store.tasks.length === 0);
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
  editBtn.addEventListener("click", () => editTaskHandler(task.id));

  const del = document.createElement("button");
  del.type = "button";
  del.className = "icon-btn delete-btn";
  del.textContent = "×";
  del.setAttribute("aria-label", "Delete task");
  del.addEventListener("click", () => deleteTask(task.id));

  li.append(checkbox, main, editBtn, del);
  return li;
}
