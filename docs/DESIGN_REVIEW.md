# ProjectFlow design review

> **History.** This review is from September 2026 and covers the app before an earlier redesign. The current design, the snowpack, is described in [BRAND.md](BRAND.md) and in the changelog's latest entry.

*26 September 2026.* This review covers the app as it was before the redesign in this release, plus your screenshot of the registration page. For each flaw it gives what's wrong, why it matters, and what was done about it. **Fixed** means the fix ships in this release. **Next** means it's recommended but not done yet.

The redesign itself is specified in [REDESIGN.md](REDESIGN.md).

---

## 1. Why it looked like Microsoft Teams

The frame was the standard "workspace app" frame: a left rail with icons, a list of projects under it, a top bar with search and avatar, and content on the right. Teams, Slack, Outlook, Jira and ClickUp all use this frame. With it, the product had no silhouette of its own; you could only tell it apart by its logo.

| # | Flaw | Why it matters | Fix | Status |
|---|---|---|---|---|
| 1.1 | Left icon rail plus project list plus top bar | Reads as "yet another Teams clone" before any content loads, and takes about 250 px of width on every page | Replaced by a **masthead**: wordmark, five places in small capitals, then search, inbox count and your name. There's no sidebar. On phones the navigation becomes a full-screen numbered *index*. | Fixed |
| 1.2 | Icons on every navigation item, plus coloured count bubbles | Icon grids are the visual signature of chat suites, and red bubbles create false urgency | Words instead of icons in navigation. Counts are bronze numerals, not red bubbles. | Fixed |
| 1.3 | Projects shown as coloured square "channel avatars" | Makes projects look like chat channels | On *Today*, projects are shown as **towers in a 3D skyline** built from their tasks, with a text list beside it | Fixed |
| 1.4 | Eleven equal tabs inside a project (Overview, Board, List, Timeline, Map, Plan, Milestones, Team, Analytics, Activity, Settings) | No hierarchy; the eye can't find the main job | Six numbered **chapters** (I Overview · II Work · III Model · IV Schedule · V People · VI Settings), with modes underneath where a chapter has several views | Fixed |

## 2. Home page ("Mission Control")

| # | Flaw | Why it matters | Fix | Status |
|---|---|---|---|---|
| 2.1 | Eight sections (stat tiles, attention, up next, trend chart, proven done, next three weeks, projects, recent activity) | No focal point; the page asks you to read everything | **Today** now has three things: the portfolio skyline, *what needs a decision*, and a right column with *up next*, *proven done* and *next three weeks*. The trend chart lives in Reports and project analytics; activity lives in each project. | Fixed |
| 2.2 | Four stat tiles repeated numbers already in the attention list | Duplicate information costs attention | The numbers are one sentence under the greeting | Fixed |
| 2.3 | "Mission Control" name | Borrowed from other tools and doesn't describe the page | Renamed **Today**. *My tasks* became **My work**; *Analytics* became **Reports**. | Fixed |

## 3. Sign-in and registration (from your screenshot)

| # | Flaw | Why it matters | Fix | Status |
|---|---|---|---|---|
| 3.1 | "The server ran into a problem" when the backend wasn't running | Blames the server without saying what to do | The dev proxy now explains that the backend isn't reachable and how to start it. The page checks `/actuator/health` and shows the start command until the backend answers. | Fixed (previous release) |
| 3.2 | Autofilled fields (name, email) turned blue-grey while the password fields stayed dark | Looks broken; the colours were the browser's, not ours | Autofill is restyled to the app's surface and ink colours | Fixed |
| 3.3 | Large empty left half; a decorative "04 STAGES" numeral that meant nothing | Space without information | The left half is now an **interactive 3D sculpture** of the four stages (Plan, Make, Prove, Approve), with their meaning as real text beside it | Fixed |
| 3.4 | Generic promise ("Plan with clarity") | Says nothing a competitor couldn't say | "Work you can walk around. Done when it's proven." | Fixed |

## 4. Visual design

| # | Flaw | Why it matters | Fix | Status |
|---|---|---|---|---|
| 4.1 | Status colours (pink, blue, amber, green) reused as decoration | Colour stopped meaning anything | In 3D, statuses are **materials**: a stone plate for not started, graphite for in progress, amber for in review, bronze for approved. Colour in 2D stays for status only. | Fixed (3D) |
| 4.2 | Thin display weights used at small sizes | Poor legibility below about 20 px | Thin weights are kept for display sizes only; UI text stays at 400–600 | Fixed |
| 4.3 | Charts looked like default Recharts output | Nothing distinctive; heavy gridlines | Restyle them to the model's materials: hairline axes, fewer ticks, stone/graphite/amber/bronze series | Next |
| 4.4 | Kanban cards carry up to six small meta items (key, priority icon, blocker, milestone chip, due date, comment and file counts, avatar) | Busy at a glance | Keep the key, title, blocker line and due date; show the rest on hover or in the peek panel | Next |

## 5. Understanding the project

| # | Flaw | Why it matters | Fix | Status |
|---|---|---|---|---|
| 5.1 | **Time was invisible.** Every view showed *now*; you couldn't see how the project got here | Retrospectives and "why are we late?" need the path, not the snapshot | The **3D Model** replays the project day by day from its recorded status changes (`GET /projects/{id}/history`) | Fixed |
| 5.2 | Dependencies, timeline and the what-if plan were three separate flat views | You had to assemble time × people × blockers in your head | One model: time runs left to right, one lane per person, block height is priority, threads are dependencies, a glass plane is Today, obelisks are milestones | Fixed |
| 5.3 | Estimates and records looked alike | A plan is a guess; a record is a fact | Recorded work is solid. The scheduler's estimate is a ghost outline and is labelled *Estimate*. Replay past today is labelled *Estimate* too. | Fixed |
| 5.4 | Proof of completion was a list of links on a task page | The product's core idea was invisible at portfolio level | Approved work is literally **bronze** everywhere in 3D: in the skyline, in the model and in the sculpture | Fixed |

## 6. Accessibility

| # | Flaw | Why it matters | Fix | Status |
|---|---|---|---|---|
| 6.1 | New 3D views would be unusable without a mouse or sight | 3D can't be the only way to get information | Every 3D view has a text equivalent. The skyline has a synchronised list. The model is fully keyboard-driven (arrow keys move between tasks, Enter opens details, P plays the replay), and screen readers are told what's focused. The sculpture's stages are real text. | Fixed |
| 6.2 | Motion | Auto-rotation and camera flights can cause discomfort | `prefers-reduced-motion` turns off auto-rotation, breathing and camera tweens | Fixed |
| 6.3 | No WebGL (old hardware, locked-down browsers) | The page would be blank | Each 3D view detects this and shows the text version, with links to Timeline and Dependencies | Fixed |

## 7. Engineering

| # | Flaw | Why it matters | Fix | Status |
|---|---|---|---|---|
| 7.1 | Every page in one bundle | Slow first load, and three.js would have made it worse | Pages load on demand; three.js is only downloaded when a 3D view is opened | Fixed |
| 7.2 | 3D rendered continuously | Burns battery on an idle tab | The model renders only when something changes (camera, replay, hover) | Fixed |
| 7.3 | Replay events could tie on timestamp | Replays could flicker between orders | History is ordered by time, then id | Fixed |
| 7.4 | Nothing could be installed or built in the build sandbox | Unverified code | 3D scenes were bundled with esbuild and three.js r186 and rendered in headless Chromium; the model view was driven by keyboard in a real browser. The full `npm run build` and `./mvnw verify` still need to run on your machine. | Partly |

## 8. Is the model new?

A quick search found 3D *presentation* timelines (for example [Timeline 3D](https://sourceforge.net/software/product/Timeline-3D/)) and the usual 2D timelines in project tools ([Atlassian's overview](https://www.atlassian.com/agile/project-management/project-timeline-software)). Construction software has had "4D" schedule simulations on building models for years. I didn't find a general team project tool that builds a **replayable 3D model of the work itself from its recorded status history**, with evidence-approved work shown as a distinct material. That's the claim this redesign makes. It isn't a guarantee that nothing similar exists anywhere.

## 9. Recommended next steps

1. Restyle the charts in Reports and project analytics to match the model's materials (4.3).
2. Calm the Kanban card (4.4) and add a "show in model" action to it.
3. Put a small, non-interactive model thumbnail on each project's Overview.
4. Add a shareable link to a moment in the replay (`/model?day=2026-09-14`) for retrospectives.
5. Run a usability test of the model with five people. Watch whether they read height as priority unprompted; if not, add a height legend.
