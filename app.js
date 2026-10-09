// OrganizeYou - entry point (ES module)
//
// Hydrates the store, wires the header buttons and runs the
// startup sequence, then keeps everything fresh every minute:
// cycle resets, badge texts, expired appointment locks (in place,
// no full render) and the done counter (so "Today" rolls over at
// midnight).
//
// Import order matters only for side effects here; every module
// builds its state lazily, so the graph stays acyclic (see
// state.js).
import { hydrate } from "./storage.js";
import { backfillPartialCycles, resetDueCycles } from "./cycles.js";
import { render, renderStats, setEditTaskHandler } from "./render.js";
import {
  openNewTaskModal,
  openCategoriesModal,
  openSettingsModal,
  openEditTaskModal,
} from "./modals.js";
import {
  refreshCountdowns,
  refreshAppointments,
  refreshSinces,
  unlockExpiredAppointments,
} from "./badges.js";

hydrate();

// Late-bind the one edge render.js needs back (see its header)
setEditTaskHandler(openEditTaskModal);

const newTaskBtn = document.getElementById("new-task-btn");
const categoriesBtn = document.getElementById("categories-btn");
const settingsBtn = document.getElementById("settings-btn");

newTaskBtn.addEventListener("click", openNewTaskModal);
categoriesBtn.addEventListener("click", openCategoriesModal);
settingsBtn.addEventListener("click", openSettingsModal);

// Schedule partial cycle tasks stuck from earlier versions, then
// reset the cycle tasks that came due while the app was closed.
// The explicit render() covers both (the old code rendered inside
// resetDueCycles too, which is now the callers' job)
backfillPartialCycles();
resetDueCycles();
render();

setInterval(() => {
  if (resetDueCycles()) render();
  refreshCountdowns();
  refreshAppointments();
  refreshSinces();
  unlockExpiredAppointments();
  renderStats();
}, 60 * 1000);
