# Reference repositories

ProjectFlow is an original implementation on our chosen stack: React + TypeScript + Vite + Tailwind + Redux Toolkit/RTK Query on the frontend, and Java + Spring Boot + Spring Security (JWT) + Spring Data JPA + MySQL on the backend.

We studied four public repositories for ideas. Each one was cloned and read directly; every claim below comes from the files listed. We didn't switch any part of our stack to match a reference.

| Repository | Inspected at | Licence | Stack | How we used it |
| --- | --- | --- | --- | --- |
| [makeplane/plane](https://github.com/makeplane/plane) | `888b086` (2026-09-25) | **AGPL-3.0-only** | Django + DRF API, React 19 + MobX + React Router 8 web app, `@atlaskit/pragmatic-drag-and-drop` | Ideas only, **no code** |
| [oldboyxx/jira_clone](https://github.com/oldboyxx/jira_clone) | `26a9e77` (2021-10-20, unmaintained) | MIT | Express + TypeORM API, React 16 + `react-beautiful-dnd` | Ideas only, no code |
| [clauderic/dnd-kit](https://github.com/clauderic/dnd-kit) | `main` @ `e522d9c` and tag `@dnd-kit/sortable@10.0.0` @ `2d86292` | MIT | The drag-and-drop library we use | One algorithm adapted, with attribution |
| [spring-petclinic/spring-petclinic-rest](https://github.com/spring-petclinic/spring-petclinic-rest) | `4cd8e1b` (2026-09-01) | Apache-2.0 | Spring Boot 4.1.1, Spring Data JPA, Spring Security, MapStruct, springdoc | Architecture conventions for our backend |

Code reuse and licence texts are recorded in [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

**Products we learned from (October 2026).** Notion, Microsoft Teams, Obsidian and Linear were studied from their public help pages and changelogs, not their code, for linked writing, mentions, backlinks, the inbox and keyboard sequences. What we took, what we left and why is in [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md); everything was implemented from scratch.

**Flurry's AI research list (October 2026).** Datasets (Apache Jira Issues, Project Management Risk Raw, Multilingual Customer Support Tickets, Salesforce xLAM Function Calling 60K, the Desharnais effort data), models and frameworks (OpenAI function calling, Qwen3, xLAM, CopilotKit, LiveKit Agents, ElevenLabs, Botpress, AutoGluon, scikit-learn, XGBoost, PEFT, TRL, pgvector, Sentence Transformers). What each was used for, what wasn't adopted and why, and their licences as recorded, are in [`FLURRY_AI.md`](FLURRY_AI.md). No code or data from any of them is included; the formats Flurry speaks (OpenAI's, Ollama's and Anthropic's function calling, ElevenLabs' text-to-speech) were implemented from their public descriptions.

---

## 1. Plane

**What we inspected:**
- `apps/api/plane/db/models/project.py` (roles)
- `apps/api/plane/db/models/state.py` (state groups)
- `apps/api/plane/db/models/issue.py` (`sequence_id`, `sort_order`, `IssueActivity`)
- `apps/api/plane/db/models/notification.py`
- `apps/api/plane/app/permissions/base.py` (`allow_permission`)
- `apps/web/core/components/issues/issue-layouts/utils.tsx` (sort-order calculation)
- `issue-layouts/group-drag-overlay.tsx` and `kanban/kanban-group.tsx`
- `issue-layouts/quick-add/` and `peek-overview/`

**Licence:** Plane is AGPL-3.0-only (see its `LICENSE.txt` and `COPYRIGHT.txt`). Copying its code would make ProjectFlow a derivative work under the AGPL, so **no Plane code, components or styles were copied**. Only the ideas below were re-implemented from scratch.

| Idea in Plane | Where we saw it | How ProjectFlow applies it |
| --- | --- | --- |
| Fractional ordering: `Issue.sort_order` is a float (default 65535, new items get max + 10000). The web app places a moved item at the midpoint of its neighbours. | `db/models/issue.py`, `issue-layouts/utils.tsx` | Tasks have a floating-point `position`. A board move sends the **neighbour ids** and the server computes the midpoint, so only the moved row is written. It rebalances only when neighbours get too close. See `src/lib/ordering.ts`, `PATCH /tasks/{id}/move`. |
| Structured activity: `IssueActivity` stores `verb`, `field`, `old_value` and `new_value` rather than just a sentence. | `db/models/issue.py` | `Activity` now carries `field`, `oldValue` and `newValue`. Each changed field (status, priority, assignee, due date, milestone, title, role) is its own entry. The UI shows "Priority: ~~Medium~~ → High". |
| Drop feedback while dragging: a column overlay tells the user a drop is disabled and why (`isDropDisabled` / `dropErrorMessage`). | `group-drag-overlay.tsx`, `kanban-group.tsx` | While a card is dragged over a column, ProjectFlow shows what releasing will do: "Release to submit your work for review", "Release to review and approve", or why it's blocked ("Only the assignee can submit this task"). Blocked columns are dimmed. |
| Inline quick-add at the bottom of a board column. | `issue-layouts/quick-add/` | `QuickAddTask`: type a title, press Enter, keep adding. Members' quick-added tasks are assigned to themselves, as the permission rules require. |
| Peek overview: open an issue in a side panel without leaving the board. | `issues/peek-overview/` | `TaskPeekPanel` opens the full task view in a side panel over the board (together with jira_clone's routed modal, below). |
| Role ranks compared numerically (`ADMIN = 20`, `MEMBER = 15`, `GUEST = 5`) and checked declaratively per endpoint (`allow_permission` decorator). | `db/models/project.py`, `app/permissions/base.py` | Already our approach: `ROLE_RANK` + `atLeast()` in `src/lib/permissions.ts`. The backend will use `@PreAuthorize` with a project-access bean (see Petclinic below). We keep our four roles (Owner, Manager, Member, Viewer); Plane has three. |
| Per-project sequence numbers for readable ids (`sequence_id`). | `db/models/issue.py` | Already our approach: `KEY-number` task keys from `project.taskSeq`. |

**Deliberately not adopted:**
- Plane's configurable states and state groups (backlog, unstarted, started, completed, cancelled, triage). ProjectFlow's workflow is fixed as **To Do → In Progress → In Review → Done**, and Done can only be reached through reviewer approval.
- Notification snoozing and archiving, workspaces, cycles and modules. They're out of scope for the capstone.

## 2. jira_clone

**What we inspected:**
- `client/src/Project/Board/index.jsx`
- `Board/Lists/index.jsx` and `Board/Lists/List/index.jsx`
- `Board/Filters/index.jsx`
- `client/src/shared/utils/api.js`
- `api/src/errors/customErrors.ts`
- `api/src/controllers/issues.ts`

**Licence:** the root `package.json` declares MIT. The repository's `LICENSE` file contains MIT text with a "Yuxi (Evan) You" copyright line, which looks copied from another project's template. We reused no code, so this doesn't affect us.

**Compatibility:** its last commit is from October 2021 and it uses React 16 and `react-beautiful-dnd`, which is deprecated. **We use none of its dependencies.**

| Idea in jira_clone | Where we saw it | How ProjectFlow applies it |
| --- | --- | --- |
| Issue details open in a modal rendered by a nested route over the board (`/board/issues/:issueId`). Closing returns to the board URL. | `Board/index.jsx` | Nested route `/projects/:id/board/tasks/:taskId` renders `TaskPeekPanel` over the board. It keeps the board's filter query string, so the link can be shared and reloaded, and closing goes back to the same filtered board. |
| Midpoint `listPosition` between the previous and next issue after a drop. | `Board/Lists/index.jsx` | Same principle, but **computed on the server** from neighbour ids. This way a filtered board view, where the client can't see every task, still orders correctly. |
| Board filters: clickable member avatars, "Only My Issues", "Recently Updated" (last 3 days), "Clear all". | `Board/Filters/index.jsx`, `Lists/List/index.jsx` | The board now has avatar filter chips (multi-select), "Only my tasks", "Recently updated" (3 days) and Clear. Filters live in the URL. |
| Optimistic update with rollback on error. | `shared/utils/api.js` (`optimisticUpdate`) | Already our approach: RTK Query `onQueryStarted` + `updateQueryData` + `patch.undo()`. It now uses the same ordering function as the server. |
| Typed error classes with machine-readable codes (`ENTITY_NOT_FOUND`, `BAD_USER_INPUT`, `INVALID_TOKEN`). | `api/src/errors/customErrors.ts` | Every error response now has a `code`: `VALIDATION_FAILED`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `WORKFLOW_VIOLATION` or `INTERNAL_ERROR`. `getErrorCode()` lets the UI branch on it. |

## 3. dnd-kit

**What we inspected:**
- `main` branch `packages/*/package.json`: the new `@dnd-kit/react` 0.5.0 architecture.
- Tag `@dnd-kit/sortable@10.0.0`:
  - `packages/core`, `packages/sortable` and `packages/utilities` `package.json`
  - `stories/2 - Presets/Sortable/MultipleContainers.tsx`

**Licence:** MIT © 2021 Claudéric Demers.

**Compatibility check:**
- The `main` branch now hosts a rewrite, `@dnd-kit/react` **0.5.0**. It supports React 18/19 but is still pre-1.0.
- ProjectFlow keeps the stable **`@dnd-kit/core` 6.3 / `@dnd-kit/sortable` 10.0 / `@dnd-kit/utilities` 3.2**. Their peer dependency is `react >= 16.8.0`, which is compatible with our React 19. We won't migrate while the new API is pre-1.0.

| Idea / code in dnd-kit | How ProjectFlow applies it |
| --- | --- |
| **Adapted code:** the multiple-containers collision strategy (`pointerWithin`, then `rectIntersection`, then `closestCenter` inside a column, plus `lastOverId` / `recentlyMovedToNewContainer` caching). | `KanbanBoard.tsx`, `collisionDetection`, with an attribution comment and the MIT notice in `THIRD_PARTY_NOTICES.md`. It stops cards flickering between columns while they re-measure. |
| `MeasuringStrategy.Always` for droppables in multi-container boards. | Enabled on the board's `DndContext`. |
| `defaultDropAnimationSideEffects` for the drag overlay drop animation. | Used for the overlay drop animation. |
| Custom sensors and keyboard coordinates, with screen-reader announcements and instructions. | Mouse, touch (press-and-hold) and keyboard sensors (Space to pick up and drop, arrow keys to move, Esc to cancel). The announcements say which column the card is over and what dropping there will do. |

## 4. Spring Petclinic REST

**What we inspected:**
- `pom.xml`, `readme.md`, `docker-compose.yml`
- `application*.properties` and `db/mysql/*.sql`
- `rest/advice/ExceptionControllerAdvice.java`
- `security/BasicAuthenticationConfig.java` and `security/Roles.java`
- The `@PreAuthorize` usage in `rest/controller/v1/*`
- `mapper/OwnerMapper.java`
- The layout of `src/test`

**Licence:** Apache-2.0.

**Compatibility, confirmed from its `pom.xml`:** Spring Boot **4.1.1**, springdoc-openapi **3.1.0**, MapStruct **1.6.3** and openapi-generator 7.25. Its compose file uses **MySQL 8.4** (LTS). In Spring Boot 4 the web starter is `spring-boot-starter-webmvc`. We'll use the same Boot 4.1 line and libraries for the ProjectFlow backend.

| Idea in Petclinic | How ProjectFlow applies it (backend phase) |
| --- | --- |
| Layered packages: `rest/controller` → `service` → `repository` (Spring Data JPA), plus `mapper`, `security`, `config` and `rest/advice`. | Same layering under `dev.projectflow` (`web`, `service`, `repository`, `domain`, `mapper`, `security`, `config`). |
| MapStruct interfaces for entity ↔ DTO mapping. | MapStruct 1.6 mappers for every DTO in `frontend/src/api/types.ts`. |
| One `@RestControllerAdvice` that turns exceptions into consistent error bodies, logs 5xx and returns field errors for `MethodArgumentNotValidException`. | `GlobalExceptionHandler` produces our `ApiErrorBody` (status, `code`, message, `fieldErrors`, path, timestamp). We keep our own envelope instead of Petclinic's `ProblemDetail`, because the frontend contract already uses it. |
| `@EnableMethodSecurity` + `@PreAuthorize` with a SpEL bean (`hasRole(@roles.OWNER_ADMIN)`), and BCrypt `PasswordEncoder`. | `@PreAuthorize("@projectAccess.atLeast(#projectId, 'MANAGER')")`, backed by the membership table, so roles are **per project**, not global. BCrypt passwords. Stateless JWT instead of HTTP Basic. |
| Database-specific Spring profiles (`application-mysql.properties`) and a Docker Compose MySQL 8.4 service. | `application-mysql.yml` profile and a `docker-compose.yml` with MySQL 8.4. We use **Flyway** migrations instead of `schema.sql`, as the capstone requires versioned migrations and demo data. |
| springdoc Swagger UI; tests split into service tests and MockMvc controller tests. | Swagger UI at `/swagger-ui.html`, plus service and `@WebMvcTest` tests. The frontend's mock-API tests (`src/mock/server.test.ts`) describe the behaviour the controller tests must match. |

## What changed in this phase

The frontend is the current phase, so these changes were made now:

1. **Fractional board ordering.** New `src/lib/ordering.ts`, used by the mock API and by the optimistic board update. `MoveTaskRequest` is now `{ status, previousTaskId, nextTaskId }`. Tests: `ordering.test.ts`, plus new API tests proving that other rows keep their positions.
2. **Structured activity.** `Activity.field/oldValue/newValue`, one entry per changed field, and a before → after display in every activity list.
3. **Error codes.** `ApiErrorBody.code` and `getErrorCode()`. Workflow violations return `409 WORKFLOW_VIOLATION`.
4. **Board interactions:**
   - dnd-kit collision strategy
   - live drop feedback that explains the workflow rules
   - inline quick-add
   - avatar, "Only my tasks" and "Recently updated" filters
   - task side panel on a shareable nested route
5. The mock database schema version went from 1 to 2, so demo data saved in a browser is re-seeded automatically.
