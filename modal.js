// OrganizeYou - reusable modal component (vanilla JS)

const Modal = (() => {
  const backdrop = document.getElementById("modal-backdrop");
  const dialog = document.getElementById("modal");
  const titleEl = document.getElementById("modal-title");
  const closeBtn = document.getElementById("modal-close");
  const form = document.getElementById("modal-form");
  const fieldsEl = document.getElementById("modal-fields");
  const extraEl = document.getElementById("modal-extra");
  const submitBtn = document.getElementById("modal-submit");

  let onSubmit = null;
  let onExtra = null;
  let keepOpen = false;
  let lastFocused = null;

  function renderExtra() {
    extraEl.innerHTML = "";
    if (typeof onExtra === "function") onExtra(extraEl);
    extraEl.hidden = extraEl.children.length === 0;
  }

  function open({ title, fields = [], extra, submitLabel = "Save", onSubmit: submit, keepOpen: keep = false }) {
    lastFocused = document.activeElement;
    onSubmit = submit;
    onExtra = extra;
    keepOpen = keep;

    titleEl.textContent = title;
    submitBtn.textContent = submitLabel;

    // Build fields
    fieldsEl.innerHTML = "";
    fields.forEach((f) => {
      const wrap = document.createElement("div");
      wrap.className = "modal-field";

      const label = document.createElement("label");
      label.textContent = f.label;
      label.htmlFor = "modal-field-" + f.name;

      const input = document.createElement("input");
      input.type = f.type || "text";
      input.id = "modal-field-" + f.name;
      input.name = f.name;
      input.className = "modal-input";
      input.placeholder = f.placeholder || "";
      input.autocomplete = "off";
      input.required = f.required !== false;
      if (f.value !== undefined) input.value = f.value;

      wrap.append(label, input);
      fieldsEl.appendChild(wrap);
    });

    renderExtra();

    backdrop.classList.add("open");
    backdrop.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");

    // Focus first input (or the dialog itself)
    const first = fieldsEl.querySelector("input") || dialog;
    first.focus();
    if (first.select) first.select();
  }

  // Re-run the extra content builder (e.g. refresh chips after add/delete)
  function refresh() {
    if (backdrop.classList.contains("open")) renderExtra();
  }

  function close() {
    if (!backdrop.classList.contains("open")) return;
    backdrop.classList.remove("open");
    backdrop.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    onSubmit = null;
    onExtra = null;
    keepOpen = false;
    extraEl.innerHTML = "";
    if (lastFocused && lastFocused.focus) lastFocused.focus();
    lastFocused = null;
  }

  function values() {
    const data = {};
    fieldsEl.querySelectorAll("input").forEach((i) => {
      data[i.name] = i.value.trim();
    });
    return data;
  }

  // Close via X
  closeBtn.addEventListener("click", close);

  // Close via backdrop click (only when clicking the backdrop itself)
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  // Close via Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  // Submit
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = values();
    const hasEmpty = Object.values(data).some((v) => v === "");
    if (hasEmpty) return; // required validation also catches this
    const cb = onSubmit;
    if (!keepOpen) close();
    if (cb) cb(data);
  });

  return { open, close, refresh };
})();
