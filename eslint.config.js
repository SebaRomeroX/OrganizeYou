// Flat ESLint config (eslint 9). Three environments:
//   - browser app modules (state, storage, logic, badges, cycles,
//     render, modals, modal, app): DOM + localStorage, plus the
//     two bridge globals logic.js reads at call time
//   - node test files (tests/**): node:test/assert, ES2022
//   - node config/scripts at the repo root
import js from "@eslint/js";
import globals from "globals";
import prettier from "eslint-config-prettier";

export default [
  {
    ignores: ["docs/", "node_modules/"],
  },
  // App modules: browser environment. logic.js additionally reads
  // two globals at call time (bridged by storage.hydrate() in the
  // browser, by tests/helpers.js in Node) - declared here so the
  // linter doesn't flag them.
  {
    files: ["*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        cycleAnchor: "readonly",
        doneLog: "readonly",
      },
    },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules: js.configs.recommended.rules,
  },
  // Tests: node globals, DOM absent
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: js.configs.recommended.rules,
  },
  // Prettier last: disables every formatting rule that would
  // fight the formatter
  prettier,
];
