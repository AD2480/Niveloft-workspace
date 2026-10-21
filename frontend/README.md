# Niveloft — Frontend

React + TypeScript single-page app for Niveloft (working name; first built as ProjectFlow), a project workspace for small software and student teams: the public site, whose front page shows the sample project as a block of snowpack (one layer per state, one slice per task, the late task holding work up as a red weak layer) read layer by layer as you scroll; the app, with Today's row of project snowpacks, the delivery forecast and each project's own snowpack on its Overview, the 2D/3D graph, the Delivery outlook (path and chart views of one forecast, the blocker per milestone, scenarios) and hand-drawn charts; and Flurry, the AI project assistant, a small snow creature that rests at the edge of the page (introduced on its own page, `/flurry`). The brand (colours, type, logo, the snowpack, Flurry) is described in [`../docs/BRAND.md`](../docs/BRAND.md).

It talks to the Spring Boot backend (`../backend`), so start that first. The automated tests use an in-browser stand-in for the API (`src/mock`) that follows the same REST contract; it is never part of a production build.

## Tech stack

| Concern | Library |
| --- | --- |
| Build / dev server | Vite 7 |
| UI | React 19, TypeScript (strict), Tailwind CSS 4 |
| Routing | React Router 7 |
| State and data fetching | Redux Toolkit 2 + RTK Query |
| Forms and validation | React Hook Form + Zod |
| Kanban drag and drop | dnd-kit |
| Charts | Hand-drawn SVG (`src/features/analytics/svgCharts.tsx`): no chart library |
| 3D (the snowpack blocks, the project model, the prediction chart) | three.js, loaded only on the pages that draw in 3D |
| Fonts (self-hosted) | Geist (variable) for everything, Archivo (variable, wide) for headlines and readings, both via Fontsource; code uses the system monospace |
| Accessible primitives | Radix UI (dialog, dropdown menu, tooltip) |
| Icons, toasts, dates | lucide-react, sonner, date-fns |
| Tests | Vitest |

## Run it (macOS + VS Code)

**Prerequisite:** Node.js **20.19 or newer** (22 LTS recommended). Check with `node -v`. If you need to install it: `brew install node@22`, or download it from nodejs.org.

1. Open the `projectflow` folder in VS Code.
2. Open a terminal with **Terminal → New Terminal** (<kbd>⌃</kbd> + <kbd>`</kbd>). This is your **frontend terminal**.
3. Run:

```bash
cd frontend
npm install
npm run dev
```

4. Start the backend in a second terminal if it isn't running (`cd backend && docker compose up -d && ./mvnw spring-boot:run`; see the main README). Until it answers, the sign-in page says so.
5. Open **http://localhost:5174** in your browser and choose **Create your workspace** to make your account.

Stop the server with <kbd>⌃</kbd> + <kbd>C</kbd>.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on http://localhost:5174; `/api` is proxied to the backend at http://localhost:8080 |
| `npm run dev:api` | The same as `npm run dev` (kept for older instructions) |
| `npm run build` | Type-check and build for production into `dist/` (needs `VITE_API_BASE_URL`, the API's https:// address) |
| `npm run preview` | Serve the production build on http://localhost:4174 |
| `npm run typecheck` | TypeScript only |
| `npm run lint` | ESLint |
| `npm test` | Unit and API-contract tests (Vitest) |

## Configuration

Copy `.env.example` to `.env.local` to override the defaults:

```dotenv
VITE_API_BASE_URL=/api   # through the dev proxy; a production build needs the API's https:// address
```

`PROJECTFLOW_API_TARGET=http://localhost:8081 npm run dev` points the dev proxy at a backend on another port. For the automated tests only, `VITE_TEST_API=browser` swaps the API for the in-browser stand-in in `src/mock`, which keeps data in the browser; a production build refuses it and leaves the stand-in out.

## What's included

- **Authentication:** register, sign in, sign out, protected routes, token validation on load, and automatic sign-out on 401 with a "session expired" message.
- **Projects:** create, edit, archive and delete projects (key, colour, dates, status); search, filter and paginate.
- **Team:** invite by email with a role, accept or decline invitations, change roles, remove members, revoke invitations, and a permission matrix.
- **Tasks:** a list view with server-side filtering, sorting and pagination, plus a Kanban board. Tasks have priorities, due dates, assignees and milestones. The board supports:
  - drag and drop with mouse, touch and keyboard
  - live drop feedback that explains the workflow rules while dragging
  - inline quick-add in each column
  - avatar, "Only my tasks" and "Recently updated" filters
  - a task side panel on a shareable URL (`/projects/:id/board/tasks/:taskId`)
  - fractional ordering, so a move rewrites only the moved task
- **Workflow:** To do → In progress → In review → Done.
  - A task reaches *In Review* only when its assignee submits work (notes, links and file attachments).
  - It reaches *Done* only when a manager or owner approves the submission. Reviewers can't approve their own work.
  - "Request changes" sends a task back to In Progress with feedback.
  - Every submission and review is kept as history.
- **Collaboration:** comments (edit and delete), per-task and per-project activity history, notifications, and an inbox with category filters and inline invitation responses.
- **Planning:** milestones with progress and a timeline, plus a month calendar of task due dates, milestones and project deadlines.
- **Analytics:** progress vs expected, a health indicator with documented rules, status and priority distribution, workload by member, weekly completion trend, flow over the last 28 days (drawn as a snowpack over time), overdue and upcoming work, cycle time and approval rate. The charts are drawn by hand in SVG: thin marks, a readout that follows the pointer (and the arrow keys), a legend, and a table view for every chart.
- **Quality:**
  - Responsive from 360 px phones to wide desktops, with light, dark and system themes.
  - Loading skeletons, empty states, error states with retry, and field-level validation that mirrors the server.
  - Accessibility: keyboard support, focus states, ARIA labels and a skip link, and it respects reduced motion.

### Permission rules

The rules live in `src/lib/permissions.ts`. The UI uses them to show or hide actions, and the backend enforces them (so does the tests' stand-in API).

| Action | Owner | Manager | Member | Viewer |
| --- | :-: | :-: | :-: | :-: |
| View project, tasks, activity | ✓ | ✓ | ✓ | ✓ |
| Create tasks, comment | ✓ | ✓ | ✓ | |
| Edit / move own tasks, submit assigned work | ✓ | ✓ | ✓ | |
| Edit and assign any task, delete tasks | ✓ | ✓ | own To Do tasks only (delete) | |
| Review submissions (never your own) | ✓ | ✓ | | |
| Manage milestones, invite Members/Viewers | ✓ | ✓ | | |
| Manage Managers, delete project | ✓ | | | |

### Project health rules

The rules live in `src/lib/health.ts` and are also shown in the app under **Analytics → Health rules**.

- **Progress** = tasks in Done ÷ all tasks.
- **Expected progress** = days elapsed since the start date ÷ days between the start date and the deadline.

The rules are checked from top to bottom. The first match wins:

1. **Completed:** the project status is Completed, or every task is Done.
2. **Not started:** the project has no tasks.
3. **Off track:** the deadline has passed with open tasks, *or* at least 25% of open tasks are overdue, *or* progress is more than 25 points behind expected.
4. **At risk:** any task is overdue, *or* progress is more than 10 points behind expected, *or* the deadline is within 7 days and progress is below 80%.
5. **On track:** none of the above.

## Folder structure

```
frontend/
├── index.html                 # HTML shell (applies saved theme before first paint)
├── vite.config.ts             # Vite + Tailwind plugin, @ alias, Vitest config
├── .env.example               # Environment variables (no secrets)
└── src/
    ├── main.tsx               # Providers: Redux, Router, Tooltip, Toaster, ErrorBoundary
    ├── App.tsx                # Route table
    ├── index.css              # Tailwind + design tokens (light/dark)
    ├── config.ts              # Env-driven configuration
    ├── api/
    │   ├── types.ts           # The REST contract (DTOs, envelopes, enums)
    │   ├── baseApi.ts         # RTK Query API, test-API/HTTP switch, 401 handling
    │   ├── endpoints.ts       # Every endpoint + cache tags + optimistic board moves
    │   └── errors.ts          # Friendly error messages, field errors
    ├── app/                   # Store, UI slice (theme, sidebar), theme controller
    ├── components/
    │   ├── ui/                # Design system: Button, Form, Dialog, Menu, Badge, …
    │   ├── layout/            # AppShell, AppSidebar (sidebar + top bar), PublicFrame, Logo
    │   ├── domain.tsx         # Status/priority/health/role badges, due dates
    │   ├── glyphs.tsx         # Niveloft's own status gauge and priority bars
    │   └── RichText.tsx       # Written text: light formatting, task keys as links with previews, @mentions
    ├── features/
    │   ├── auth/              # Auth slice, route guards
    │   ├── projects/          # Project form, cards, invitations, milestones, context
    │   ├── tasks/             # Kanban, table, filters, task form, submit/review, comments
    │   ├── analytics/         # Hand-drawn SVG charts (svgCharts), chart cards with table views, health card, analytics view
    │   ├── dashboard/         # Today: since you were last here, the project snowpacks, what needs you, first steps
    │   ├── overview/          # The Overview's snowpack (from the project's tasks and dependencies)
    │   ├── assistant/         # Flurry's panel (compact card, pinned dock, visible scope, "How I found this"), reports (summary, blockers, agenda), exact-task answers, plan review, voice (the browser's, or the server's natural voice)
    │   ├── flurry/            # Flurry's figure, the companion (roam, stay, hide, drag, menu, notes), its preferences, cues and sounds;
    │   │   └── meet/          #   Meet Flurry (/flurry): anatomy, sizes, live behaviours and the sandbox
    │   ├── delivery/          # The Delivery outlook: readings, path and chart views, blocker inspector, scenario preview
    │   ├── forecast/          # The delivery forecast card, supporting metrics, "your finish"
    │   ├── graph/             # The 2D work graph: lenses per role, list view, keyboard
    │   ├── public/            # Front page (home/: the page and the snowpack stage), role views, forecast playground, sample workspace, FAQ, search
    │   ├── refs/              # Linked writing: task references and previews, @/# suggestions, the writing field, "Mentioned in"
    │   ├── keyboard/          # The keyboard layer: G-then-letter, J/K, C, and the ? sheet
    │   └── activity/          # Activity timeline
    ├── pages/                 # Route components (project/* are the project tabs)
    ├── three/                 # three.js scenes: SnowpackScene (the front page's and each Overview's block), PortfolioSnowpack (Today),
    │                          # ProjectModelScene, ProgressChart3D; and the pure parts: snowpack (layers, story), snowpackFrame (the
    │                          # block's shape and camera, and the still drawing), snowPalette, capabilities (no three.js import)
    ├── lib/                   # permissions, health, dates, forms, hooks, formatting, rich text (parsing, mentions, keys), plan drafting,
    │                          # the forecast engine (progressForecast), its wording (forecastText), work stats
    └── mock/                  # The tests' in-browser stand-in for the API: schema, sample seed, server, views
```

## Talking to the real backend

Run `npm run dev` with the backend running. The frontend expects:

- Base URL `/api`, proxied by the Vite dev server to `http://localhost:8080` (CORS also allows `http://localhost:5174` for direct calls).
- `Authorization: Bearer <jwt>` on every request except `POST /auth/login` and `POST /auth/register`.
- Success responses shaped as `{ success: true, message, data, timestamp }`.
- Error responses shaped as `{ success: false, status, code, error, message, fieldErrors, path, timestamp }`.
- Page responses shaped as `{ content, page, size, totalElements, totalPages }` (zero-based `page`).
- Submissions posted as `multipart/form-data`: a JSON part named `data` (`{ notes, evidence: [{ kind, label, url }] }`) plus zero or more `files` parts. Evidence files are downloaded from `GET /api/files/{id}` with the bearer token (members only).
- Updates carry the `version` the client last saw; a stale version returns `409 EDIT_CONFLICT`.
- Board moves sent as `PATCH /tasks/{id}/move` with `{ status, previousTaskId, nextTaskId }`. The server stores a fractional `position` (see `src/lib/ordering.ts`).
- A machine-readable `code` in every error, e.g. `WORKFLOW_VIOLATION` for an illegal status change, `EDIT_CONFLICT` for a concurrent edit.

References and credits are listed in [`../docs/REFERENCES.md`](../docs/REFERENCES.md) and [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

The complete list of endpoints and payloads is in `src/api/endpoints.ts` and `src/api/types.ts`. The tests' stand-in in `src/mock/server.ts` is an executable reference for their behaviour.
