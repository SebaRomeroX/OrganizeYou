// OrganizeYou - shared application state (ES module)
//
// The single source of truth. Every other module reads and
// mutates `store` instead of declaring its own copy, so no module
// owns the data and the import graph stays acyclic:
//
//   state -> (nothing)
//   logic -> (nothing; reads two globals at call time)
//   storage -> state, logic        badges -> state, logic
//   cycles -> state, storage, logic
//   render -> state, logic, badges, cycles, storage
//   modals -> render (+ storage, cycles, logic, modal)
//   app   -> everything (entry point)
//
// Hydration from localStorage is storage.hydrate()'s job and runs
// once before the first render.

export const store = {
  tasks: [],
  categories: [],
  doneLog: [],
  cycleAnchor: null,
};

export const CYCLE_UNITS = ["hour", "day", "week", "month"];

export function categoryById(id) {
  return store.categories.find((c) => c.id === id);
}
