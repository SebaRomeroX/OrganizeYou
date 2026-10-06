// OrganizeYou - to-do list with categories & tags (vanilla JS, localStorage)

const TASKS_KEY = "organizeyou.tasks";
const CATEGORIES_KEY = "organizeyou.categories";
const CYCLE_UNITS = ["hour", "day", "week", "month"];

const newTaskBtn = document.getElementById("new-task-btn");
const categoriesBtn = document.getElementById("categories-btn");
const taskList = document.getElementById("task-list");
const emptyState = document.getElementById("empty-state");

let tasks = loadTasks();
let categories = loadCategories();

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

      return { ...t, tags: Array.isArray(t.tags) ? t.tags : [], repeats, subtasks, cycle, done };
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

/* ---------- Cycles (recurring schedules) ---------- */

// Next calendar boundary strictly after `from` (defaults to now).
// Calendar-aligned: hours from local midnight, days at local
// midnight, weeks on Monday, months on the 1st. For every N > 1
// the periods anchor to the epoch (see roadmap).
function nextCycleBoundary(cycle, from = new Date()) {
  const n = Math.max(1, Math.floor(Number(cycle.every)) || 1);
  const y = from.getFullYear();
  const mo = from.getMonth();
  const d = from.getDate();

  if (cycle.unit === "hour") {
    const hourFrac = from.getHours() + from.getMinutes() / 60;
    const k = Math.floor(hourFrac / n) + 1;
    // Hour field may exceed 23: the Date constructor rolls it over
    return new Date(y, mo, d, k * n).getTime();
  }

  // Calendar day number (DST-proof), local midnight conversion below
  const dayNum = Math.floor(Date.UTC(y, mo, d) / 86400000);
  let next;
  if (cycle.unit === "day") {
    next = (Math.floor(dayNum / n) + 1) * n;
  } else if (cycle.unit === "week") {
    const MONDAY = 4; // day number of 1970-01-05, a Monday
    next = (Math.floor((dayNum - MONDAY) / (7 * n)) + 1) * 7 * n + MONDAY;
  } else {
    // month: months since 1970-01 (epoch anchor, see roadmap)
    const mIdx = (y - 1970) * 12 + mo;
    next = (Math.floor(mIdx / n) + 1) * n;
    const yr = 1970 + Math.floor(next / 12);
    const mo2 = ((next % 12) + 12) % 12;
    return new Date(yr, mo2, 1).getTime();
  }
  const nd = new Date(next * 86400000);
  return new Date(nd.getUTCFullYear(), nd.getUTCMonth(), nd.getUTCDate()).getTime();
}

// Badge text: "Every day", "Every 2h", "Every 3 weeks"...
function cycleLabel(cycle) {
  const n = Math.max(1, Math.floor(Number(cycle.every)) || 1);
  if (cycle.unit === "hour") return n === 1 ? "Every hour" : `Every ${n}h`;
  const names = { day: "days", week: "weeks", month: "months" };
  const one = { day: "day", week: "week", month: "month" };
  return `Every ${n === 1 ? one[cycle.unit] : n + " " + names[cycle.unit]}`;
}

// Keep cycle.dueAt in sync with the task's done state: a done task
// is due at the next boundary, an active one has nothing pending.
function syncCycleDue(task) {
  if (!task.cycle) return;
  task.cycle.dueAt = task.done ? nextCycleBoundary(task.cycle) : null;
}

// Reset every cycle task whose time has come (progress cleared).
// Returns true if anything changed.
function resetDueCycles() {
  const now = Date.now();
  let changed = false;
  tasks.forEach((t) => {
    if (t.cycle && t.done && t.cycle.dueAt != null && now >= t.cycle.dueAt) {
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

/* ---------- Repeat / subtask modes (mutually exclusive) ---------- */

// Shared state for the repeat/subtask/cycle controls in the task modals
function createModesState(task = null) {
  return {
    repeatOn: !!(task && task.repeats),
    target: task && task.repeats ? task.repeats.target : 5,
    // Carry ids/done over when editing so progress is preserved
    subtasks: task && task.subtasks.length ? task.subtasks.map((s) => ({ ...s })) : [],
    // Cycle is orthogonal: it combines with repeat/subtasks
    cycleOn: !!(task && task.cycle),
    cycleEvery: task && task.cycle ? task.cycle.every : 1,
    cycleUnit: task && task.cycle ? task.cycle.unit : "day",
  };
}

// Convert modal state to task data (repeat vs subtasks mutually
// exclusive; cycle independent). Returns the cycle schedule with a
// null dueAt — syncCycleDue fills it in when the task is done.
function modesToData(state, original = null) {
  let cycle = null;
  if (state.cycleOn) {
    const every = Math.max(1, Math.floor(Number(state.cycleEvery)) || 1);
    const unit = CYCLE_UNITS.includes(state.cycleUnit) ? state.cycleUnit : "day";
    cycle = { every, unit, dueAt: null };
  }
  if (state.repeatOn) {
    const target = Math.max(1, Math.floor(Number(state.target)) || 1);
    const current =
      original && original.repeats ? Math.min(original.repeats.current, target) : 0;
    return { repeats: { current, target }, subtasks: [], cycle };
  }
  const subs = state.subtasks.filter((s) => s.text.trim() !== "");
  if (subs.length > 0) {
    return {
      repeats: null,
      cycle,
      subtasks: subs.map((s) => ({
        id: s.id || makeId(),
        text: s.text.trim(),
        done: !!s.done,
      })),
    };
  }
  return { repeats: null, subtasks: [], cycle };
}

// Repeat toggle + target input, and dynamic subtask rows.
// Mutates `state` in place; re-renders via Modal.refresh().
function buildModes(state) {
  return (container) => {
    const block = document.createElement("div");
    block.className = "modes";

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
      if (state.repeatOn) state.subtasks = []; // exclusivity: repeat clears subtasks
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
      help.textContent = "The task completes when the counter reaches the target.";
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
      if (state.repeatOn) state.repeatOn = false; // exclusivity
      state.subtasks.push({ id: null, text: "", done: false });
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
      const { repeats, subtasks, cycle } = modesToData(modes);
      addTask(text, orderedTags(selected), { repeats, subtasks, cycle });
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
      const { repeats, subtasks, cycle } = modesToData(modes, task);
      const prevCycle = task.cycle; // read before overwrite
      task.text = text;
      task.tags = orderedTags(selected);
      task.repeats = repeats;
      task.subtasks = subtasks;
      task.cycle = cycle;
      // Normalize completion for the (possibly new) mode
      if (repeats) task.done = repeats.current >= repeats.target;
      else if (subtasks.length > 0) task.done = subtasks.every((s) => s.done);
      // Keep dueAt when the schedule is unchanged, recompute otherwise
      if (task.cycle) {
        const sameSchedule =
          prevCycle &&
          prevCycle.every === task.cycle.every &&
          prevCycle.unit === task.cycle.unit;
        task.cycle.dueAt = !task.done
          ? null
          : sameSchedule && prevCycle.dueAt != null
            ? prevCycle.dueAt
            : nextCycleBoundary(task.cycle);
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
  });
  saveTasks();
  render();
}

function toggleTask(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;

  if (task.repeats) {
    if (task.done) {
      // Completed repetition: untick starts a new cycle at 0
      task.repeats.current = 0;
      task.done = false;
    } else {
      // Ticking adds one; reaching the target completes the task
      task.repeats.current = Math.min(task.repeats.current + 1, task.repeats.target);
      task.done = task.repeats.current >= task.repeats.target;
    }
  } else if (task.subtasks.length > 0) {
    return; // main checkbox is disabled for subtask tasks
  } else {
    task.done = !task.done;
  }

  syncCycleDue(task);
  saveTasks();
  render();
}

function toggleSubtask(taskId, subtaskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  const sub = task.subtasks.find((s) => s.id === subtaskId);
  if (!sub) return;

  sub.done = !sub.done;
  // Main task completes when every subtask is ticked
  task.done = task.subtasks.length > 0 && task.subtasks.every((s) => s.done);
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
}

function renderTasks() {
  taskList.innerHTML = "";

  // Groups: one per category in creation order, Uncategorized last
  const groups = [];
  categories.forEach((cat) => {
    groups.push({
      title: cat.name,
      // Multi-tagged tasks repeat in each matching section
      tasks: tasks.filter((t) => t.tags.includes(cat.id)),
      categoryId: cat.id,
    });
  });
  groups.push({
    title: "Uncategorized",
    tasks: tasks.filter((t) => t.tags.length === 0),
  });

  groups.forEach((group) => {
    if (group.tasks.length === 0) return;

    const section = document.createElement("section");
    section.className = "task-group";

    const title = document.createElement("h3");
    title.className = "group-title";
    title.textContent = group.title;

    const ul = document.createElement("ul");
    ul.className = "group-tasks";
    group.tasks.forEach((task) => ul.appendChild(renderTaskItem(task)));

    section.append(title, ul);
    taskList.appendChild(section);
  });

  emptyState.classList.toggle("visible", tasks.length === 0);
}

function renderTaskItem(task) {
  const li = document.createElement("li");
  li.className = "task-item" + (task.done ? " done" : "");

  const hasSubs = task.subtasks.length > 0;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = task.done;
  if (hasSubs) {
    checkbox.disabled = true;
    checkbox.setAttribute("aria-label", "Completes when every subtask is ticked");
  } else if (task.repeats) {
    checkbox.setAttribute(
      "aria-label",
      `Progress: ${task.repeats.current} of ${task.repeats.target}`
    );
  } else {
    checkbox.setAttribute("aria-label", "Mark task as done");
  }
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

  if (task.repeats) {
    const badge = document.createElement("span");
    badge.className = "counter" + (task.done ? " complete" : "");
    badge.textContent = `${task.repeats.current}/${task.repeats.target}`;
    line.appendChild(badge);
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

// Reset cycle tasks that came due while the app was closed, then
// keep checking every minute while the tab stays open
resetDueCycles();
render();
setInterval(resetDueCycles, 60 * 1000);
