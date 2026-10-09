# OrganizeYou

A to-do list that actually models how real work behaves: things repeat on **hours or
calendar cycles**, some can only be done **at a moment in time**, some count **up** since
you last did them, and consistency is worth measuring. Built with **plain HTML, CSS and
JavaScript — no framework, no build step, no dependencies**. Everything lives in your
browser's `localStorage`.

**[Live demo](https://sebaromerox.github.io/OrganizeYou/)** ·
Runs fully offline · Data never leaves your device

![Desktop view: stats strip, category sections, badge types and the Done section](docs/screenshots/desktop.png)

## Features

- **Categories** – tag tasks with one or more categories; pending tasks are grouped by
  category and completed tasks collect in a **Done (N)** section at the end. A task with
  two tags appears in both sections (it moves as one unit).
- **Recurring cycles** – `Every N hours / days / weeks / months`.
  - Hours are *true elapsed time* (`+2h` is +2h of real time, DST-proof).
  - Day/week/month are *calendar-aligned* to a configurable anchor: start time
    (e.g. 06:00), week start day, month start day and month anchor (for `N > 1` the
    periods phase to the epoch, so a "every 3 months" task stays on Jan/Apr/Jul/Oct).
  - Completing a cycle resets progress and shows a **cycle badge**; a per-task
    **streak** counts completed cycles in a row (fire badge).
- **Counters and subtasks** – `2/5` counters and/or a checklist per task; ticking
  subtasks feeds the counter. A task completes when its counter is full or every
  subtask is ticked.
- **Deadlines** – `YYYY-MM-DD` counts to the end of that day ("today", "3 days"),
  timed deadlines count days → hours → 10-minute steps with urgent/overdue states.
- **Appointments** – a moment when the task *unlocks*: the checkbox stays disabled
  until then, the badge counts up ("in 3 days" → "in 1 hour" → "in 10 min" → "now").
  Once the moment passes it reads **now** and never nag "overdue".
- **Time since** – a count-up badge from the last time you did something
  ("20 min" → "3 hours" → "2 days" → "1 week" → "2 months").
- **Stats strip** – completions today / this week / this month / this year / total,
  plus your current **day streak** (consecutive days with at least one completion).
- **Settings modal** – change the cycle anchor and every cycled task re-syncs.
- Dark, responsive UI (tested down to 390 px), `aria-label`ed controls, keyboard-usable
  modal with Escape-to-close.

| Mobile | New task dialog |
| --- | --- |
| ![Mobile view at 390px](docs/screenshots/mobile.png) | ![New task modal](docs/screenshots/modal.png) |

## Why no framework?

This project deliberately uses the platform: classic `<script>` tags, DOM APIs and
`localStorage`. For an app of this size that buys a lot:

- **Zero dependencies and zero build step** – clone it, open it, read it. Nothing to
  audit, nothing that breaks when a toolchain moves on.
- **The interesting logic is pure functions, not framework machinery** – cycle math,
  badge ladders and counters are plain functions over dates and data (see below), so
  they are unit-tested without mounting anything.
- **The code is the portfolio** – a reviewer can open `app.js` and see the whole
  program, not the glue between libraries.

The trade-offs of this choice (module split, CI, stricter saves) are tracked honestly
in `improvementPlan.txt`.

## Quick start

```bash
git clone https://github.com/SebaRomeroX/OrganizeYou.git
cd OrganizeYou
```

- Open `index.html` directly in a browser, or
- Serve the folder (recommended): `npx serve .` or `python3 -m http.server`, then visit
  <http://localhost:8000>.

No install, no build. Your data stays in `localStorage` for that origin.

## Architecture

```
index.html   markup + script order (logic.js → modal.js → app.js)
styles.css   all styling (dark theme, responsive)
logic.js     pure logic: cycle math, badge ladders, counters, streaks
modal.js     the reusable dialog component (self-contained IIFE)
app.js       everything else: state, storage, rendering, events
tests/       node:test suites for logic.js (zero dependencies)
roadmap.txt  the build log: 14 goals, decisions and adjustments
```

`logic.js` is a classic script shared by the page and the tests: it holds the pure
part of the app (no DOM, no storage) — `nextCycleBoundary`, `countdownInfo`,
`appointmentInfo`, `sinceInfo`, `doneCounts`, `dayStreak`, `streakOnBoundary`,
anchor normalization — extracted verbatim so the exact code that runs in the browser
is the code under test.

## Tests

```bash
npm test        # node --test, no packages to install
```

62 tests in 5 files, covering the behaviors the roadmap committed to:

- **cycles** – hour math is true elapsed time across DST (spring-forward and
  fall-back), calendar boundaries land on the configured anchor, `N > 1` epoch
  phasing, strictly-after at an exact boundary, garbage-input clamping;
- **countdown / appointment / since** – every ladder step, exact boundaries
  (24 h, 10-minute floor, 7 days, 30 days), sticky "now", invalid input;
- **stats** – week bucket honors the anchor's `weekStartDay`, midnight rollover,
  day-streak rules (including "today isn't dead until the day ends").

## How it was built

`roadmap.txt` is the full build log: fourteen goals, each with its decisions,
edge cases, adjustments discovered on the way, and a dated changelog. `improvementPlan.txt`
records the portfolio review that shaped the current structure.

## What's next

- ES module split with `npm run dev` server, CI running `npm test` on every push
- Focus trap + full keyboard audit of the dialogs, `try/catch` around every save
- Optional: sync across devices, PWA offline install

## License

[MIT](LICENSE)
