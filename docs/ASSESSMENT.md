# ProjectFlow: gap assessment and upgrade plan

_Assessed 25 Sep 2026 against the repository as it stands at commit `df22308`. No screenshots or other files were attached; the source in this repository is the only input._

## 1. What exists today

| Area | State | Evidence |
| --- | --- | --- |
| React frontend (React 19, TS, Vite, Tailwind 4, RTK Query, dnd-kit, Recharts) | **Written, never compiled or run.** Package installs were blocked in the authoring environment, so nothing has been type-checked, built or opened in a browser. | `frontend/`, 119 files |
| Backend (Spring Boot + MySQL) | **Missing.** There is no `backend/` folder. | — |
| Data | **Mocked.** Everything lives in the browser's `localStorage` via the in-browser mock API (`src/mock/*`). Demo mode is labelled in the top bar. | `src/mock/server.ts`, `store.ts` |
| Auth | **Mocked.** Fake token (`mock.<base64>.signature`) and salted SHA-256 in the browser. There is no real JWT or BCrypt. | `src/mock/server.ts`, `password.ts` |
| Permissions (Owner/Manager/Member/Viewer) | Implemented as shared rules (`src/lib/permissions.ts`), but **enforced only by the mock**, which runs in the same browser as the UI and so isn't a real security boundary. | `permissions.ts`, mock handlers |
| Workflow To Do → In Progress → In Review → Done | Implemented in the UI and mock: submit (notes, links, files) → approve or request changes → history kept. | `SubmitWorkDialog`, `ReviewDialog`, `SubmissionHistory` |
| Acceptance criteria / completion checklist | **Missing.** | — |
| Typed evidence (repository, deployment, screenshot) | **Missing.** Evidence is generic links plus files. | `types.ts` `Submission` |
| Review workspace | **Incomplete.** Reviewing happens in a small dialog; evidence and criteria are never shown side by side. | `ReviewDialog.tsx` |
| File attachments | **Mocked.** Files under 512 KB are stored as data URLs in `localStorage`; larger ones keep only a name. | `mock/server.ts` |
| Comments, notifications, inbox, activity with field changes | Implemented against the mock. | — |
| Milestones, calendar | Implemented. The calendar has no agenda view and no "hide completed" filter. | `CalendarPage.tsx` |
| Dashboard | Implemented, but organised around stat tiles rather than actions. There is no "Needs your attention" section and no explained risks. | `DashboardPage.tsx` |
| Analytics | Count-based progress, status/priority distribution, workload by count, weekly created/completed, cycle time (creation→approval), approval rate. **Missing:** effort weighting, time waiting for review, time blocked, scope growth. There is no status-change event history to calculate these from. | `mock/views.ts` |
| Dependencies / dependency map / timeline | **Missing.** | — |
| Planning scenarios ("What if?") | **Missing.** Tasks have no estimates and people have no capacity. | — |
| AI assistance | **Missing.** | — |
| Live updates | **Missing.** The only refresh is RTK Query invalidation plus 30-second polling of the unread count. | — |
| Concurrent edits | **Missing.** There are no version checks, so the last write wins silently. | — |
| Workspace search (⌘K) | **Missing.** | — |
| Tests | Unit tests for permissions, health and ordering, plus mock-API workflow tests. **They have never been run.** | `*.test.ts` |

**Conclusion:** the first incomplete foundational phase is **Phase 1**: a real backend with persistence, server-enforced permissions, and a complete evidence-based submission and review workflow. Everything that follows (dashboard, dependencies, planning, AI, analytics, live updates) needs real records and an event history, so none of it should be built on the browser mock.

## 2. Design direction: "evidence first"

ProjectFlow's point of view is that **work is done when the evidence says so**. The interface started from a "gallery" catalogue system adopted from the owner's design reference in Phase 1, and was later calmed for people who like things orderly: cool neutral greys, white cards with soft corners on hairline rules, light display type, small tracked capitals for navigation, a single blue accent for actions, and even grids where every card previews the same number of rows and opens the rest in a pop-up. On top of that it adds three things:

1. **Evidence as a first-class object.**
   - Each task declares acceptance criteria and a completion checklist up front.
   - A submission is a numbered, immutable version: notes plus typed evidence (repository, deployment, screenshots, files, links).
   - The review workspace puts evidence on the left and criteria on the right, and the reviewer marks each criterion as met or not met. Approval is impossible while any criterion is unmet, and the server enforces this.
2. **Attention over inventory.**
   - Pages lead with what needs a decision (overdue work, reviews waiting, blockers), each with the record that caused it and a link to it.
   - Warnings always say why: "because CCP-10 is 2 days overdue and CCP-12 depends on it". There are no opaque scores.
3. **One visual spine: the timeline.** Phase 3 makes the project timeline, with milestones, dependencies and a "Today" rule, the centrepiece. It replaces decorative charts.

Semantic colour is kept strictly separate from chrome:
- **Status** uses its validated palette.
- **Risk** uses danger, warning and success.
- **Priority** uses directional icons.

Everything else stays monochrome.

## 3. Phase plan and what "done" means

| Phase | Scope | Status |
| --- | --- | --- |
| **1** | Spring Boot 3.5 + MySQL 8.4 backend: Flyway schema, JWT + BCrypt, per-project roles enforced with `@PreAuthorize`, every existing endpoint, acceptance criteria, checklist, typed evidence, authorised file download, criteria-based review, status-event history, optimistic locking. Frontend review workspace, criteria and checklist editors, evidence-typed submissions, backend mode on port 5174 via the Vite proxy. | **Delivered 2026-09-26** (unverified: see README) |
| 2 | Mission Control dashboard, explained risk summaries, ⌘K search, calendar agenda and "Hide completed", visual refinements | Delivered 2026-09-26 (unverified: see README) |
| 3 | Task dependencies (cycle and cross-project checks), interactive dependency map plus list view, project timeline | Delivered 2026-09-26 (unverified: see README) |
| 4 | Estimates, capacity and availability; deterministic working-day scheduler; scenario preview and apply with stale-scenario detection | Delivered 2026-09-26 (unverified: see README) |
| 5 | Server-side AI actions with confirmation and permission-scoped context; honest "unavailable" state; the event-based analytics that Phase 1's history table makes possible | Delivered 2026-09-26 (unverified: see README) |
| 6 | Server-Sent Events with reconnect and authorisation, accessibility and responsive pass, end-to-end verification, documentation | Delivered 2026-09-26 (unverified: see README) |
