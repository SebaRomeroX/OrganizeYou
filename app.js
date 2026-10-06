// OrganizeYou - to-do list with categories & tags (vanilla JS, localStorage)

const TASKS_KEY = "organizeyou.tasks";
const CATEGORIES_KEY = "organizeyou.categories";

const newTaskBtn = document.getElementById("new-task-btn");
const newCategoryBtn = document.getElementById("new-category-btn");
const categoryList = document.getElementById("category-list");
const noCategoriesHint = document.getElementById("no-categories");
const taskList = document.getElementById("task-list");
const emptyState = document.getElementById("empty-state");

let tasks = loadTasks();
let categories = loadCategories();

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

/* ---------- Modal actions ---------- */

function openNewTaskModal() {
  Modal.open({
    title: "New task",
    fields: [{ name: "text", label: "Task", placeholder: "What needs to be done?" }],
    submitLabel: "Add",
    onSubmit: ({ text }) => addTask(text),
  });
}

function openNewCategoryModal() {
  Modal.open({
    title: "New category",
    fields: [{ name: "name", label: "Category name", placeholder: "e.g. Work" }],
    submitLabel: "Add",
    onSubmit: ({ name }) => addCategory(name),
  });
}

function openEditTaskModal(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;

  // Selected tags as a Set for easy toggling while the modal is open
  const selected = new Set(task.tags.filter((tagId) => categoryById(tagId)));

  Modal.open({
    title: "Edit task",
    fields: [{ name: "text", label: "Task", value: task.text }],
    submitLabel: "Save",
    extra: (container) => {
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
    },
    onSubmit: ({ text }) => {
      task.text = text;
      task.tags = categories.map((c) => c.id).filter((id) => selected.has(id));
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
    group.tasks.forEach((task) => ul.appendChild(renderTaskItem(task)));

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
newCategoryBtn.addEventListener("click", openNewCategoryModal);

render();
