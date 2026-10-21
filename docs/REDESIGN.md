# The redesign: a project you can walk around

> **History.** This is the spec of an earlier redesign (September 2026, when the app was still called ProjectFlow). The current design, the snowpack, is described in [BRAND.md](BRAND.md) and in the changelog's latest entry; this file is kept for the reasoning behind decisions that still stand (evidence-based Done, the model's honest axes).

ProjectFlow's idea is that **work is done when the evidence says so**. The redesign makes that idea visible, and stops the product from looking like a chat suite. [DESIGN_REVIEW.md](DESIGN_REVIEW.md) lists the flaws it answers.

## 1. The frame: masthead, not sidebar

```
PROJECTFLOW   TODAY   MY WORK   PROJECTS   CALENDAR   REPORTS            SEARCH ⌘K   INBOX 3   ● LIVE   AARAV
```

- **Five places, in words.** Everything else is reached from them or from ⌘K. There are no icon rails and no red bubbles.
- **Inbox shows a count, not an alarm.** Live status is a single dot.
- **Phones:** everything folds into a full-screen, numbered *Index* (projects included), like a catalogue.
- **Inside a project:** a large title, the approved-vs-expected progress numeral, and six numbered **chapters**:

| Chapter | Modes |
| --- | --- |
| I Overview | Summary · Analytics · Activity |
| II Work | Board · List (task and review pages live here) |
| III Model | the 3D model and replay |
| IV Prediction model | each person's progress, recorded and predicted, in 3D and as tables, by kind of member (added later) |
| V Schedule | Timeline · Dependencies · What if · Milestones |
| VI People | |
| VII Settings | |

## 2. The 3D grammar (the same in every view)

| Thing | Means |
| --- | --- |
| Stone plate, low | Not started |
| Graphite block | In progress |
| Amber block | In review (evidence submitted) |
| **Bronze** block, slight sheen | Approved: every criterion met |
| Ghost outline | The scheduler's **estimate** (never solid) |
| Red | Overdue: a strip on the table (model) or a sleeve (skyline) |
| Glass plane with a bronze edge | Today |
| Obelisk | Milestone (bronze once completed) |
| Thread between blocks | "Must finish before". Red when the blocker is overdue, bronze when it's released. |

Colours come from CSS variables (`--model-*`), so light and dark themes both work, and the legend beside each view uses the same values.

## 3. The three models

### Project Model (chapter III)
- **Axes:** time runs left to right (0.28 units per day). There's one lane per person, alphabetical, with *Unassigned* last; overlapping work inside a lane is packed into sub-rows. Height is priority.
- **Replay:** a scrubber runs from the first recorded day, through today, to the end of the projection. Before today, every block is rebuilt from the recorded status changes. After today, open work follows the scheduler, and the readout says **Estimate**.
- **Controls:**
  - Camera presets: Overview, Plan (top-down), Elevation, Today.
  - Toggles: Estimates, Dependencies, Hide done.
  - Hover shows the task. Clicking selects it and dims everything that isn't upstream or downstream of it.
  - A side panel shows dates, evidence count, what the task waits on and what it unblocks, with links to the task and its evidence.
- **Keyboard:**
  - ← → moves within a lane; ↑ ↓ moves between lanes.
  - Home and End jump to the first and last task.
  - Enter opens details, Esc clears.
  - P plays or pauses the replay.
  - Each focus change is announced to screen readers.
- **Rendering:** it draws on demand. An idle model costs nothing.

### Portfolio Skyline (Today)
- **Towers:** one tower per active project; each task adds one layer, stacked bronze → amber → graphite → stone. Height is size, not quality.
- **Overdue:** a translucent red sleeve, as tall as the overdue work.
- **Interaction:** it turns slowly by itself (off with reduced motion) and can be turned by dragging. Hovering a tower highlights its row in the list beside it, and the reverse. Clicking either opens the project.

### Flow Sculpture (sign-in)
- **The slabs:** four slabs, one per stage (Plan, Make, Prove, Approve); the last is cast in bronze.
- **Interaction:** it follows the pointer slightly and can be turned. The stage names beside it are real text, and pointing at either highlights both.

## 4. Engineering notes

- **Code layout:** three.js lives only in `src/three/` and is imported by lazily loaded components, so it never reaches the main bundle. The scene classes don't use React: the React views own one instance each and call `setModel`, `setTime`, `setOptions`, `setSelected`, `focus`, `view` and `dispose`.
- **`src/three/projectModel.ts`** is a pure function from records to geometry, with its own unit tests. It holds the axes, row packing, status-at-time and projection handling.
- **History:** `GET /api/projects/{id}/history` returns every recorded status change, oldest first, for members only. The demo API serves the same data.
- **Fallbacks and cleanup:** without WebGL, each view shows its text equivalent. On unmount, scenes release their GPU resources.
- **Verification in the sandbox:** esbuild bundled the scenes with three.js r186. They were rendered in headless Chromium, and the model view was driven by keyboard and a scrubber. Screenshots checked light, dark, replay and selection states.
