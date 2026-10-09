// OrganizeYou - badge refresh on the 60s tick (ES module, DOM)
//
// Cycle math, labels and the ladders themselves live in logic.js;
// this file only re-patches the visible badges in place - no full
// render, so focus and scroll stay untouched.
import { store } from "./state.js";
import { appointmentInfo, appointmentLocked, countdownInfo, sinceInfo } from "./logic.js";

// Disabled state + aria-label for the main checkbox, combining the
// base role (counter / subtask-only / plain) with the appointment
// lock. Reused by the renderer and by the in-place unlock.
export function applyMainCheckboxState(box, task) {
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

// Re-patch the visible countdown badges in place
export function refreshCountdowns() {
  document.querySelectorAll(".countdown-badge").forEach((badge) => {
    const info = countdownInfo(badge.dataset.deadline);
    if (!info) return;
    if (badge.textContent !== info.text) badge.textContent = info.text;
    const cls = "countdown-badge " + info.state;
    if (badge.className !== cls) badge.className = cls;
  });
}

// Re-patch the visible appointment badges in place
export function refreshAppointments() {
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
export function unlockExpiredAppointments() {
  document.querySelectorAll(".task-item").forEach((li) => {
    const task = store.tasks.find((t) => t.id === li.dataset.taskId);
    if (!task || !task.appointment || task.done) return;
    if (appointmentLocked(task.appointment)) return; // still locked
    li.querySelectorAll('input[type="checkbox"]').forEach((box) => {
      if (box.dataset.role === "main") applyMainCheckboxState(box, task);
      else if (box.disabled) box.disabled = false; // subtask boxes
    });
  });
}

// Re-patch the visible since badges in place
export function refreshSinces() {
  document.querySelectorAll(".since-badge").forEach((badge) => {
    const info = sinceInfo(badge.dataset.since);
    if (!info) return;
    if (badge.textContent !== info.text) badge.textContent = info.text;
    const cls = "since-badge " + info.state;
    if (badge.className !== cls) badge.className = cls;
  });
}
