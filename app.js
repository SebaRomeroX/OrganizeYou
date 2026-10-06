// OrganizeYou - to-do list with categories & tags (vanilla JS, localStorage)

const TASKS_KEY = "organizeyou.tasks";
const CATEGORIES_KEY = "organizeyou.categories";

const categoryForm = document.getElementById("category-form");
const categoryInput = document.getElementById("category-input");
const categoryList = document.getElementById("category-list");
const noCategoriesHint = document.getElementById("no-categories");

const taskForm = document.getElementById("task-form");
const taskInput = document.getElementById("task-input");
const taskList = document.getElementById("task-list");
const emptyState = document.getElementById("empty-state");

let tasks = loadTasks();
let categories = loadCategories();
let openPickerId = null; // task id whose inline tag picker is open

function loadTasks() {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // Migrate tasks created before tags existed
    return parsed.map((t) => ({ ...t, tags: Array.isArray(t.tags) ? t.tags : [] }));
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

function addTask(text) {
  tasks.push({ id: makeId(), text, done: false, tags: [] });
  saveTasks();
  render();
}

function toggleTask(id) {
  const task = tasks.find((t) => t.id === id);
  if (task) {
    task.done = !task.done;
    saveTasks();
    render();
  }
}

function deleteTask(id) {
  tasks = tasks.filter((t) => t.id !== id);
  if (openPickerId === id) openPickerId = null;
  saveTasks();
  render();
}

function toggleTag(taskId, categoryId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  if (task.tags.includes(categoryId)) {
    task.tags = task.tags.filter((tagId) => tagId !== categoryId);
  } else {
    task.tags.push(categoryId);
  }
  saveTasks();
  render();
}

/* ---------- Rendering ---------- */

function render() {
  renderCategories();
  renderTasks();
}

function renderCategories() {
  categoryList.innerHTML = "";
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
    del.addEventListener("click", () => deleteCategory(cat.id));

    chip.append(name, del);
    categoryList.appendChild(chip);
  });
  noCategoriesHint.classList.toggle("hidden", categories.length > 0);
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

    group.tasks.forEach((task) => {
      ul.appendChild(renderTaskItem(task));
      if (openPickerId === task.id) {
        const li = document.createElement("li");
        li.appendChild(renderTagPicker(task));
        ul.appendChild(li);
      }
    });

    section.append(title, ul);
    taskList.appendChild(section);
  });

  emptyState.classList.toggle("visible", tasks.length === 0);
}

function renderTaskItem(task) {
  const li = document.createElement("li");
  li.className = "task-item" + (task.done ? " done" : "");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = task.done;
  checkbox.setAttribute("aria-label", "Mark task as done");
  checkbox.addEventListener("change", () => toggleTask(task.id));

  const main = document.createElement("div");
  main.className = "task-main";

  const text = document.createElement("span");
  text.className = "task-text";
  text.textContent = task.text;
  main.appendChild(text);

  // Show only tags that still exist (safety while rendering)
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

  const tagBtn = document.createElement("button");
  tagBtn.type = "button";
  tagBtn.className = "icon-btn tag-btn";
  tagBtn.textContent = "+";
  tagBtn.setAttribute("aria-label", "Edit tags");
  tagBtn.title = "Edit tags";
  tagBtn.addEventListener("click", () => {
    openPickerId = openPickerId === task.id ? null : task.id;
    render();
  });

  const del = document.createElement("button");
  del.type = "button";
  del.className = "icon-btn delete-btn";
  del.textContent = "×";
  del.setAttribute("aria-label", "Delete task");
  del.addEventListener("click", () => deleteTask(task.id));

  li.append(checkbox, main, tagBtn, del);
  return li;
}

function renderTagPicker(task) {
  const picker = document.createElement("div");
  picker.className = "tag-picker";
  picker.setAttribute("role", "group");
  picker.setAttribute("aria-label", "Select categories");

  if (categories.length === 0) {
    const hint = document.createElement("span");
    hint.className = "picker-empty";
    hint.textContent = "No categories yet. Create one first.";
    picker.appendChild(hint);
    return picker;
  }

  categories.forEach((cat) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "picker-chip" + (task.tags.includes(cat.id) ? " selected" : "");
    chip.textContent = cat.name;
    chip.setAttribute("aria-pressed", task.tags.includes(cat.id) ? "true" : "false");
    chip.addEventListener("click", () => toggleTag(task.id, cat.id));
    picker.appendChild(chip);
  });

  return picker;
}

/* ---------- Events ---------- */

categoryForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = categoryInput.value.trim();
  if (!name) return;
  addCategory(name);
  categoryInput.value = "";
  categoryInput.focus();
});

taskForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = taskInput.value.trim();
  if (!text) return;
  addTask(text);
  taskInput.value = "";
  taskInput.focus();
});

render();
