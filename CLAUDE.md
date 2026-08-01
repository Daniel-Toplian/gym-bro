# Gym Bro

Vanilla JS + Vite. No framework, no runtime dependencies.

- `src/main.js` — all rendering (template strings) and event wiring
- `src/workout.js` — pure workout state transitions + localStorage persistence
- `src/trackers.js` — daily calorie/water/protein log helpers
- `src/data.js` — static data loading + `validateData()`
- `public/data/*.json` — deployed, read-only workout data
- `test/` — `node --test`, no test framework

## Mobile first

Mobile is the primary target, not an afterthought.

- Design and verify every view at **375×812 before desktop**. Desktop is the progressive enhancement.
- Every control must be reachable and legible at 375px. `document.body.scrollWidth` must equal `document.documentElement.clientWidth` — no horizontal body scroll, ever.
- Wide content (rows, tables, diagrams) either reflows for narrow screens or scrolls inside its own container. Never let it clip against the viewport edge.
- Verify UI changes in the browser at mobile size. Passing tests is not sufficient evidence that a layout works.

## Conventions

- Every persisted field needs a reconcile branch in `loadDynamicState` (`src/workout.js`), or it silently vanishes on reload. Reconcile is deliberately strict: malformed state is discarded, not repaired.
- Wrap every interpolated data string in `escapeHtml()` (`src/main.js`).
- Extend the existing delegated `click` listener on `main` and the single 250ms `updateTimers()` ticker. Do not add new listeners or intervals.
- New JSON fields must be validated in `validateData()` — it also runs at build time via `npm run validate:data`.
- Cover new state transitions and reconcile branches with tests in `test/`.
- No code comments unless asked.

## Commands

```bash
npm run dev
npm test
npm run validate:data
npm run build
```
