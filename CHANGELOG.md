# Changelog

All notable changes, by phase. Dates are when the phase was delivered.

## Evidence you can open, why the date moved, ways forward, documents, corrections, streamed answers and a forecast model trial (2026-10-21)

The next steps from the 20 October report, in its order of priority, and the ML work rerun on the downloads attached that day.

### Flurry's evidence links
- Every lookup under *How I found this* links to the records it read: the task, the exact comment (*Comment by Maya Chen, 2026-10-14 07:00*), the submission (*Version 2 submitted 2026-10-14*), the review decision (*Changes requested on version 1, by Aarav Shah*) and the document passage. At most 30 links a lookup. A cited task in an answer is a link too.
- The task page opens at that comment, submission or review (`#comment-…`, `#submission-…`, `#review-…`) and marks it. The links name only records the reader can already open, and the page checks again.

### Why the date moved
- On the Delivery page, under the outlook: the likely finish now against a week, two weeks or a month ago, as the records stood then, with the move split into **scope** (estimates and new or removed work), **blocked work**, **owners** and **progress**, each measured by replaying the forecast with that kind of recorded change brought forward, plus the review waits behind it. Task keys are links; the reason for a delay is never guessed, and an unmeasurable step says so.
- `GET /api/projects/{id}/changes?since=` (members): the recorded changes to estimates, due dates, priorities, owners and dependencies since then (90 days and 5,000 changes at most), and the tasks deleted since. Flurry answers "why did the date move?" from it.

### The blocker's ways forward, and options compared
- The Delivery inspector shows **the evidence** for the blocker (its state, what it holds up and waits on, the latest submission, decision and comment, each linked) and **what it costs** the likely finish (for a review, also what another week's wait would add).
- **Ways forward** compares the responses, each with the same forecast (same records, same random draws): for work in review, decide it today (only someone who may review it) or ask a reviewer by name; for other work, cut its scope to 75% or 50%, move it to one of the two people with the most room, take it yourself if nobody owns it, or ask its owner what would help. **Preview** shows the exact change (the estimate, the owner, or the comment, which you can edit) and, if you can't make it, why. Nothing happens until you confirm, through the normal endpoints with your permissions; estimates and owners get **Undo**. Flurry never assigns, re-estimates or reviews by itself.
- Flurry's note at a blocker says what it costs and offers *Ways forward*; its *Review blockers* links there (`?ways=1`).
- Owners and managers see how often it's used, as counts of steps (shown, evidence opened, ways forward, previewed, confirmed, dismissed) by kind of blocker and response: words from a fixed list, never a person, task or text (`journey_events`, migration V10, kept 180 days).
- *What if* keeps three options (A, B, C) in the browser and compares them side by side (finish, against now, the deadline, late tasks) before you apply one. An older saved scenario becomes option A.

### Approved project documents
- *VII Documents* in each project: specifications, meeting notes, decisions, as text (typed, pasted, or a Markdown or text file read in the browser; 200,000 characters at most). Any member adds a draft; drafts are seen by their author and by owners and managers. Owners and managers approve a document for Flurry, and withdraw approval; changing an approved document's text sends it back to draft (a new title alone doesn't). Authors edit and delete their own drafts; owners and managers, any document. Saving, approving and deleting appear in the project's activity.
- Documents are split into passages under their headings (about 900 characters each, `document_passages`, migration V11). Flurry's new tool `search_documents` finds at most 5 passages of **approved** documents in the project being asked about, by words (BM25 over candidates found with escaped LIKE patterns; no embeddings). Flurry is told to say which document and section it used, and that a document records what was decided when it was approved while the tasks show what has happened since. Passages reach the model inside `<record>` tags, as data.
- A passage has its own address (`/projects/{id}/docs/{docId}#p-{passageId}`), which Flurry's evidence links use.

### Corrections to Flurry
- *Was this right?* under every server answer: *Yes*, or *Something's wrong* with the kinds of mistake (said something the records contradict, missed a record, treated missing information as a no, the wrong task, overstepped, unclear, slow, other) and, optionally, the right answer. What's kept: the verdict, the kinds, the correction, the question, the answer, the model and what it looked up (`ai_feedback`, migration V12, 180 days).
- Owners and managers see the project's corrections in its settings: totals, the kinds that recur, right and wrong per model, how many wrong answers came without looking anything up, and the latest; **Download as eval cases** gives the wrong answers as JSON lines in the tool eval's shape, for a person to finish (what a right answer must and mustn't say) before adding them. Nobody is named. The download is recorded in the audit log.
- *Download my data* now includes the documents you wrote and your ratings of Flurry's answers; deleting an account unlinks its ratings, which stay with the project.

### Answers as they're written, Stop, and better context
- `POST /api/projects/{id}/ai/ask/stream` sends server-sent events: each lookup as it's made, the answer's words as the model writes them (picked out of its JSON as they arrive; words written before a lookup are cleared), then the checked answer, an error, or *stopped*. Refusals (no AI, limits, not a member) are ordinary error responses before the stream opens. All three providers stream (OpenAI-compatible, Anthropic, Ollama), with an idle and a total limit each.
- **Stop** aborts the request and calls `DELETE /api/projects/{id}/ai/ask/{requestId}` (only the asker's own question); the server cancels the provider's stream, which closes the connection so it stops generating. What the provider used until then counts against the limits; a question stopped before anything was sent costs nothing. A closed connection stops it too (a comment line every 15 seconds finds out).
- An older server without the stream, or a signed-out tab, gets the same question the ordinary way. The AI in Chrome stops through its own prompt call.
- The streamed reply isn't stored for replay (no Idempotency-Key, and the server's idempotency filter leaves the stream alone); the internal dispatch that finishes a stream is allowed through security (it was authorised when the request arrived).
- When a project has more than 250 tasks, a question's context lists the tasks it (or the conversation) names by key first, then those whose titles share its words, then open work, then the most recently changed, and says the list is partial. Before, it was the first 250 by number.

### A forecast model trial
- `ml/` now writes **`model.json`** beside `model.joblib` when a model beats Niveloft's forecast: the same model as numbers (feature list, missing-value filling, the formula or trees) for a server without Python. All four built-in kinds export (ridge, gbm, correction, forest); the file's predictions match scikit-learn's to 1e-9, and splits at infinity are written as the largest double.
- With `FORECAST_MODEL_FILE` set, the server checks the file at start-up (schema, trained on Niveloft task history, the same features in the same order, every tree well formed) and runs it **beside** Niveloft's forecast, never instead of it. A model trained on the kit's made-up data is refused unless `FORECAST_MODEL_ALLOW_SYNTHETIC=true`.
- The server builds the kit's features in Java (`WorkDayFeatures`: what was known when each task could start) and records both forecasts for each task in progress the first time anyone opens the trial, then what the work really took once it's submitted (`forecast_trial`, migration V13; numbers only, per model). Work that could only start after the model was trained but finished unseen is scored too, apart, as *checked after the fact*.
- The Delivery page shows the trial when there is one: the model, the verdict so far (*too early to tell* before about 30 tasks forecast in advance), each forecast's typical miss and which was closer how often, the work in progress with both forecasts, and the latest results. One model runs per server, on every project, and the page says when a project's work wasn't in its training. Project settings say whether a model is on trial. **Rollback:** switch off *the forecast model trial* in Site health (a new operator switch, `forecast-model`), or remove the setting; nothing else changes.

### The ML rerun (20 October downloads)
- xLAM Function Calling 60K: every record checked (58,369 of 60,000 can be scored; 260 have two tools with one name, 275 leave out a required argument, 1,125 give a value of another kind than declared). A fixed sample of 200 (95 simple, 63 multiple, 37 parallel, 5 parallel multiple) is kept as ids and the file's SHA-256 only, `ml/eval_cases/xlam-sample.json`, so the gated data isn't redistributed.
- Desharnais: read from the PROMISE ARFF file; -1 is missing; `Project`, `Length` (the actual schedule) and `YearEnd` are never inputs. Ridge's typical miss ×1.42 against ×1.59 for the function-point regression (24% less, ahead in every resample); on the complete projects alone, ×1.42 against ×1.60.
- Support tickets: the three releases measured one by one, never pooled (the newest shares 8,308 tickets with the 4-20k release). Newest: 28,586 tickets after one repeated text, balanced accuracy 60% (English 65%, German 53%); the 4-20k release 52%; the German five-level release 92%, with a caution that its synthetic texts often state the urgency in words. CC-BY-NC-4.0: no model trained on them is saved.
- The project risk dataset wasn't attached, so it wasn't run. `python -m niveloft_ml public all --dir … --out …` reruns everything; `ml/scripts/rerun.sh` runs the tests first. Results: `ml/results/public-2026-10-20/SUMMARY.md`.
- The tool eval has 26 cases (two new, about documents).

### Fixed
- On a phone, a table's label for screen readers (absolutely positioned, inside a scroll box that wasn't its containing block) widened the page sideways: Delivery with the ways forward open, and *People* for members and viewers (the label marking their own role's column). Those scroll boxes, and the others holding the same kind of label (the options compared on What if and on Delivery, the milestone table), now contain it.
- Task keys in a list inside a sentence (the blocker's evidence: *Holds up ONB-10, ONB-14 …*) are part of the sentence now, and the facts under *Why the date moved* have more room between rows, for fingers.

### Checked here, and not
- The type check of `frontend/src` against the real library types, and of the build scripts: 0 errors. The backend compiled with `javac` 21 against the real library sources, tests included: 0 errors.
- 360 unit tests passed (18 more than the last release).
- 404 plain-Java checks against the real code, every one recompiled against this tree: streamed answers (51); documents, the journey's counts and corrections on H2 in MySQL mode after the real migrations V1–V13 (34); the trial (23); Flurry's tools with their links and `search_documents` (51); and the earlier tool, reply, guard, budget, security, upload, export, retired-demo, shared rate limit, email budget and kept sign-in cookie checks (245). Plus 4,374 checks of the server's forecast against the `ml/` kit's numbers (3,325 features and 700 predictions; largest difference 8.9e-16), and 3 of the account copy's new queries on H2.
- 56 Python tests in `ml/`.
- The browser suites, all passing with no page errors: this release's suite (24 checks, light and dark), a new one that opens every signed-in page on a phone as an owner, a manager, a member and a viewer (4 × 22 pages), launch controls (18), task-history export (7), Flurry's panel and voice (33), the AI in Chrome (14), the release suites (35, 68, 62, 9, 10, 24, 101), hovering 376 controls on 23 pages (0 findings); the real-API build against a stand-in server (41: streamed lookups and words, Stop, the plain fallback, corrections and their download, the forecast trial with and without a model) and the cross-site kept sign-in (12).
- The launch audit in light and dark at 1440 and 390 px, now with the Documents page: 0 findings; 154 internal links, none broken. Its tap-target rule now counts a link inside a sentence as inline text, as WCAG 2.5.8 does, however the link is drawn (a task key with its status glyph is `inline-flex`); before, 19 task keys in *Why the date moved* were reported on a phone, and those rows were given more room as well. Lab vitals: back to back with the previous release on the same machine, twice each, within a few tenths of a second of it (phone home 5.5–6.0 s against 5.6–5.7 s, sign-in 4.9–5.1 s against 4.8 s); see `docs/launch/CAPACITY.md`.
- `scripts/secret-scan.mjs --history`: nothing found. `scripts/check-migrations.mjs`: V10–V13 additive, recorded. `scripts/launch-register.mjs --check`: all 341 checks present (30 pass at code level, 2 fail for want of a frontend lockfile, 281 unverified, 28 not applicable).
- The first full run also found four checks that didn't wait for the page (a journey step counted after the comment was posted, the ownership card going after a refetch, the corrections card loading, the phone layout after a resize from desktop width); they wait now. After the last changes (the data copy and its wording), this release's suite, launch controls and the audit of the changed pages ran again on the final build.
- Not run here: `./mvnw verify` (Maven Central unreachable), MySQL (the new tables ran on H2 in MySQL mode only), a real model streaming or searching documents (tested against stand-ins), a real team's model on trial, Safari and Firefox, CI, and `npm install`.

## Keep me signed in without a token in the page, and rate limits shared by every server (2026-10-19)

### Keep me signed in, done safely (SESSION-02)
- Sign-in tokens now live only in the tab (sessionStorage) and last a day at most. *Keep me signed in* no longer stores a 14-day token in localStorage, where any script on the page could read it: the API sets an HttpOnly cookie instead (`__Secure-niveloft-session` over HTTPS: Secure, `Path=/api/auth`, and `SameSite=None` with `Partitioned` so it works with the API on another site; `SESSION_COOKIE_SAMESITE` to change it). It holds the session's id and a 256-bit secret, of which the database keeps only the SHA-256 (`user_sessions.cookie_hash`, migration V9).
- The cookie can do one thing: get a new token for its own session (`POST /api/auth/refresh`), only when the app asks (its Origin), rate-limited. A tab opened later, or one whose token expired, carries on without the password; signing out, signing out everywhere, a password change or reset, suspension and deletion end it with the session.
- This also fixes kept sign-ins ending after a day: their tokens were capped at 24 hours with nothing to renew them. They now last their 14 days.
- *Sign out* signs the browser out: the tab's session and the browser's kept sign-in end on the server, the cookie is removed, and the account's other tabs sign out at once. A tab whose token no longer works can still sign out with the cookie alone.
- A token an earlier release left in localStorage is moved into the tab the first time the app opens; the next visit asks for the password once.
- Ticking *Keep me signed in* and signing in before the page had heard back from the server used to be ignored; it now counts.
- The privacy policy says what the cookie is, and that attempt counts are kept under a hash of the address for up to three hours.

### Rate limits shared by every server (TRAFFIC-05)
- Every rate limit (API calls, changes and uploads per person, calls per address, sign-in, sign-up, emailed links, resets, contact, and Flurry's and the voice's hourly limits) is counted in the database in production (`RATE_LIMIT_STORE=auto`), so limits hold however many backend instances run. In development they're counted in memory, exactly, as before.
- One atomic conditional update per hit on a sliding-window counter (`rate_limit_windows`, migration V9), on a pool of its own (`RATE_LIMIT_DB_POOL`, 3 connections) outside the request's transaction, so a failed sign-in stays counted and a burst can't starve the application's connections. Keys are stored as hashes, never addresses. If the database can't be reached, each instance counts in memory until it can, with one warning a minute.
- The production guard warns when production would count in memory. `docs/launch/RUNBOOKS.md` says how to clear one person's limit.

### Sign-in alerts can't use up the email budget
- Every sign-in sends an alert, and on Resend's free tier (100 emails a day) a busy day of sign-ins could use the whole budget, leaving nothing for new people's confirmation emails or password resets. Sign-in alerts and "you already have an account" notices now stop at four fifths of the day's budget and nine tenths of the month's; confirmations, resets and the security notices (password changed, account deleted) use the rest. The privacy policy and `docs/launch/CAPACITY.md` (a new *What limits traffic first* table) say so.

### Checked here, and not
- Ran: the frontend type check (0 errors) and 342 unit tests (10 new); the backend compiled with its tests against the real libraries, now with HikariCP and H2 too (0 errors); 286 plain-Java checks, 83 of them new: the shared counters on H2 in MySQL mode after the real migrations (two instances on one database, 400 concurrent attempts at a limit of 50 taking exactly 50, 352 random histories), the cookie's database side and its headers built by Spring's own cookie code, the email budget's reserve against a stand-in for Resend, and the guard; the new backend tests' own code (17 tests) under stand-ins for JUnit and AssertJ; the browser suites (launch controls 18, and the rest unchanged and passing), a new cross-site suite in Chromium with a real HttpOnly, partitioned cookie (12), the launch audit (0 findings, 153 internal links) and the lab vitals (the phone sign-in shift down from 0.27 to 0.02); the ml tests, the secret scan, the migration rules and the launch register (29 pass at code level, 2 fail, 280 unverified, 30 not applicable).
- Not run here: `./mvnw verify`, MySQL, Safari and Firefox, CI and `npm install`.

## No more demo mode, and Flurry's in-browser answers fixed (2026-10-15)

### Demo mode is gone
- The app always talks to the real API. `npm run dev` proxies `/api` to the backend on port 8080 (`npm run dev:api` still works and does the same); `.env.backend` is gone. If the backend isn't running, the sign-in page says so and how to start it; on a deployed site it names the server instead of giving local instructions.
- Removed everywhere: the *Demo* tags (beside the logo, in the sidebar and top bar, and beside your name), the yellow "Demo mode" box, the sample accounts and their password on the sign-in page, *Open the sample* in the header and menu, "Try it as …" sign-ins on the front page, *Reset demo data* in Settings, and the demo notes in the privacy policy, the footer, Site health, the contact form and the FAQ.
- The header's button is now *Create workspace*; the front page leads with *Create your free workspace*, with *See it working* beside it (the interactive sample on the page, which saves nothing). *How will you use Niveloft?* always leads to sign-up, with the role already chosen. The sign-in page's illustration is captioned *How Niveloft reads a project*, and its labels no longer overlap on smaller screens. Between 1024 and 1279 px the front page now stacks its words above the block instead of laying them over it, where the weak layer's label covered the headline.
- The backend no longer seeds demo data (`DemoDataSeeder` and `DEMO_DATA` removed): a new database starts empty. A database an earlier version seeded still holds the demo accounts (`…@projectflow.dev`, whose password was published), so a production server suspends them at start-up, signs them out and records each in the audit log; a development server says they're there.
- The first time the app opens in a browser that ran the demo, it removes the demo's sign-in (so it isn't sent to the real API, where it could only look like an expired session), its copy of the sample data, and preferences kept under the demo's ids, which real accounts and projects reuse.
- The in-browser stand-in for the API stays only for the automated tests (`VITE_TEST_API=browser`). A production build refuses it, needs `VITE_API_BASE_URL`, refuses the old `VITE_USE_MOCK_API=true`, warns about leftover demo settings, and leaves the stand-in and its sample password out of the bundle.
- `scripts/load-test.mjs` signs in as test accounts you name (`--email`, `LOAD_TEST_PASSWORD`) instead of the demo accounts.

### "The AI replied without an answer"
- Answers from the AI in Chrome (Gemini Nano) and from the server's AI are read more carefully: the answer under another name or in another case, nested one level, or as a list of sentences; JSON with raw line breaks or trailing commas; an answer cut off before the reply ended (shown, and said to be possibly incomplete, with nothing cited); and a reply that only lists what the records don't show (shown as exactly that). When a reply holds several objects, the one with the answer is used.
- The prompt for the AI in Chrome now ends with the request to answer, after the question (which stays marked as data, so it can't pose as instructions): a small model answers more reliably when the request comes last.
- When the AI in Chrome still gives no usable answer, Flurry asks once more, in a fresh session, without the schema and with a reminder to fill in the answer. If that fails too, it says so plainly; it never makes an answer up.

### Checked here, and not
- Ran: the frontend type check (0 errors) and 332 unit tests (22 new); the backend compiled with its tests against the real libraries (0 errors) and 203 plain-Java checks (20 new for the reply reader and the retired demo accounts); the browser suites on the build with the tests' in-browser API, updated where they expected the demo (13, 7, 33, 14, 35, 68, 62, 9, 10, 24 and 101 checks, and 359 controls hovered on 23 pages; two timing failures on the busy first run passed when rerun), the real-API build against a stand-in server (18), the launch audit (0 findings, 151 internal links), the ml tests, the secret scan, the migration rules and the launch register (25 pass at code level, 4 fail, 280 unverified, 32 not applicable).
- Not run here: `./mvnw verify`, MySQL (including the start-up suspension of retired demo accounts), Chrome's real Gemini Nano (the second try ran against a stand-in), CI and `npm install`.

## From demo to production: the launch checklist (2026-10-14)

Working through the production launch checklist (341 checks across 27 areas). Where each check stands, with evidence and next steps, is in [`docs/launch/LAUNCH_READINESS.md`](docs/launch/LAUNCH_READINESS.md); this release is a candidate, not an approval: 24 checks pass at code level, 4 fail, 282 are unverified (most need the deployed environment, an account setting or a person), and 31 don't apply.

### Refusing unsafe settings
- `APP_ENV=production` (or `auto` with a remote database): the API refuses to start with demo data, the development key, `*`/localhost/http origins, an http `APP_URL`, `REQUIRE_HTTPS=false`, public API docs, a database URL without TLS, `EMAIL_PROVIDER=log`, no operator, AI without spending caps, or uploads in a relative folder, and lists every problem at once (`ProductionGuard`). `backend/.env.production.example` is a complete production configuration without secrets.
- A production frontend build needs `VITE_USE_MOCK_API` set explicitly, refuses the sample accounts with the real API, scans the bundle for more kinds of keys (OpenAI, Groq, Google, ElevenLabs) and publishes `/.well-known/security.txt` from `VITE_SECURITY_CONTACT`.

### Sessions
- Every sign-in is a server-side session checked on each request (`user_sessions`, migration V8). Signing out ends it on the server; Settings → Security lists your sessions and ends any of them; "Sign out everywhere"; password change and reset, suspension and deletion end them all. Sessions end after 12 hours unused, at most 24 hours, or 14 days with "keep me signed in", which is now unticked by default (`SESSION_IDLE_HOURS`, `SESSION_MAX_HOURS`, `SESSION_REMEMBER_DAYS`).
- Tokens carry an issuer, audience and session id, all checked; old tokens without a session must sign in again. `JWT_PREVIOUS_SECRET` rotates the signing key without signing everyone out.
- Live-update streams belong to a session and close when it ends; at most 8 per person and `LIVE_MAX_STREAMS` per server.

### Accounts, ownership and invitations
- Settings → Data and privacy: download a JSON copy of your data; delete your account (password and DELETE). Personal details, sessions, notifications and solo projects go; what you wrote in shared projects stays, as "Deleted user".
- Owners can transfer ownership to a member (Project settings → Ownership); the previous owner stays as manager. A role change can't make someone owner.
- Invitations expire after 14 days, need a confirmed address when email is on, and only work while the sender may still grant the role; removing someone revokes their pending invitations.
- Common passwords, look-alikes and your email name are refused (backend list, mirrored in demo mode); optional Have I Been Pwned check with k-anonymity (`PASSWORD_BREACH_CHECK=hibp`). With confirmation required, signing up with a registered address answers like a new account and emails its owner.
- Sign-up asks people to confirm they're 18 or older; the privacy policy and terms say so, and describe self-service export and deletion, sessions and the audit log.

### Uploads
- An extension allowlist (`UPLOAD_ALLOWED_EXTENSIONS`); the stored type comes from the extension, not the browser; PNG, JPEG, GIF, WebP, PDF and Office/zip files must start like what they claim; files are checked under a temporary name before they're stored; optional ClamAV scanning (`UPLOAD_SCAN=clamav`); file responses get a sandbox CSP. Deleting a task now deletes its evidence files.

### Audit log, spending and emergency switches
- `audit_events`: sign-ins, password changes, sessions, invitations, roles, ownership, exports, deletion, operator actions and every Flurry request (feature, lookups, rounds, tokens, outcome; never text), with coarse network and request id. Project settings show owners and managers their project's log; operators see all (`GET /api/ops/audit`). Kept at least 180 days (`AUDIT_RETENTION_DAYS`).
- Flurry reserves its share of the server's daily requests, the project's daily requests (`AI_MAX_REQUESTS_PER_PROJECT_PER_DAY`) and the month's tokens before calling a provider, atomically in the database, settles the real use afterwards, refuses when spending can't be read, and answers at most `AI_MAX_CONCURRENT` questions at once.
- Emergency switches for AI, voice, uploads, exports, sign-ups and invitations (Site health, `PUT /api/ops/switches/{name}`); suspending accounts and signing everyone out (`/api/ops/accounts/suspend`, `/api/ops/sessions/end-all`).

### Release tooling
- `.github/workflows/ci.yml`: backend tests, frontend type check, lint, tests and production build, `npm audit`, the secret scan, the migration rules, the launch register and the ml tests; `.github/dependabot.yml`.
- `scripts/secret-scan.mjs` (tree, history, bundle), `scripts/check-migrations.mjs` (released migrations unchanged, new ones additive; `backend/migrations.sha256`), `scripts/launch-register.mjs`, and checklist profiles and gates in `scripts/load-test.mjs` (`--profile smoke|peak|reserve|spike|soak`, `--out`).
- Docs: `docs/launch/` (README, LAUNCH_READINESS, RUNBOOKS, CAPACITY, register and checklist).

### Checked here, and not
- Ran: the backend compiled with its tests against the real libraries (0 errors); 98 plain-Java checks of the new logic (production guard, passwords with a stand-in breach API, session rules, uploads with a stand-in clamd, Flurry's budget), also added to the backend's tests; the frontend type check and unit tests; the browser suites on the demo build (including a new one for sessions, data, deletion, ownership and the security log); the secret scan over the tree and all 38 commits; the migration rules; the load-test smoke profile against a stand-in; lab performance numbers (see CAPACITY.md).
- Not run here: `./mvnw verify` (the new `LaunchControlsTest` and the updated account tests), anything against MySQL, a deployed environment, CI, a real clamd or Have I Been Pwned. The frontend has no `package-lock.json` yet (the npm registry was unreachable): commit one.

## Flurry looks things up, speaks naturally, and a forecast you can train (2026-10-14)

Acting on the research list for Flurry: a pretrained model connected to Niveloft's own records, a natural voice, deadline predictions trained on your own history, and measurement before any fine-tuning. What each item on the list was used for, what wasn't adopted and why, and the licence cautions are in [`docs/FLURRY_AI.md`](docs/FLURRY_AI.md).

### Flurry looks things up
- With a model that takes tools (function calling), Flurry looks up what a question needs in the project being asked about: tasks by words or filters, one task in full (description, criteria, checklist, submissions and reviews, latest comments), comments, mentions and recent activity. Two more tools suggest creating or starting a task, as confirm cards; nothing can approve, assign, reschedule or delete (`backend/src/main/resources/ai/tools.json`, `ProjectTools`, `ToolLoop`).
- Works with OpenAI-compatible services (OpenAI, Groq, Gemini, OpenRouter, vLLM serving Qwen3 or xLAM models), Ollama's own API and Anthropic's. A model whose service refuses tools is remembered and answered from the project summary, as before; other refusals stay ordinary failures. At most 6 lookups and 5 model rounds per question (`AI_TOOLS`, `AI_MAX_LOOKUPS`).
- Every answer shows *How I found this*: each lookup in order, filled when it found records, an empty ring when the records show nothing, a broken ring when a lookup couldn't be done. An answer that had to stop looking, or couldn't read something, says so in its limits.
- Hardened along the way: stray arguments can't turn a suggested new task into another kind of suggestion, and missing or malformed arguments are read as empty.

### A natural voice
- *Read answers aloud* can use ElevenLabs text-to-speech through the server (`VOICE_PROVIDER=elevenlabs`, `POST /api/ai/speech`); the key never reaches the browser. The browser's own voice takes over whenever it's not set up, fails, or is over its budget (60 answers per person per hour, `VOICE_MAX_CHARACTERS_PER_DAY` for the server), and the panel says why. The privacy policy names ElevenLabs when it's on.

### Forecast training data and the `ml/` kit
- Owners and managers can download a project's task history (*Project settings → Forecast training data*, `GET /api/projects/{id}/export/task-history.csv`): dates, estimates, priorities, dependencies and counts, with people as p1, p2 … and no titles, descriptions, comments or names.
- `ml/` (Python): trains models on that history (scikit-learn, optionally XGBoost and AutoGluon) and tests them on later work against Niveloft's current forecast, recomputed exactly as the app does. It recommends a model only when it removes at least 5% of the forecast's typical miss and comes out ahead in 95% of resamples; otherwise it says to keep the forecast. Adapters for first experiments on the public datasets, within their licences: a model trained on non-commercial data is never saved.
- A tool-calling eval: 24 cases with Flurry's real instructions and tools, run against any OpenAI-compatible API, plus scored samples of the xLAM data, and a converter to training conversations for after a measured gap. A backend test keeps the eval's copy of the instructions identical to the server's.

## Writing, finding and coming back: what we took from Notion, Teams, Obsidian and Linear (2026-10-14)

Those tools are better at the everyday writing, finding and returning around the work; Niveloft's job is the work itself (reviews against criteria, forecasts as windows, an assistant that never acts on its own). This release takes the first without giving up the second. The reasoning, with sources, is in [`docs/PRODUCT_DIRECTION.md`](docs/PRODUCT_DIRECTION.md).

### Linked writing
- Descriptions, comments, review feedback and submission notes understand light formatting (bold, italic, code, lists, checklists, quotes, links), drawn from a parsed tree, never as HTML (`lib/richText.ts`, `components/RichText.tsx`).
- Task keys (*ONB-9*) become links with their status glyph; pointing at one previews the task (status, owner, due date, how late). Keys you can't open stay plain text.
- Writing a comment or a description (the two places where a mention notifies), `@` suggests the project's people and `#` its tasks; ⌘/Ctrl B, I and E wrap bold, italic and code; ⌘/Ctrl Enter sends a comment. Comments have a preview.

### Mentions and backlinks
- @mentioning a member in a comment or a description notifies them once (`MENTION` notifications, a *Mentions* tab in the inbox), with the words around it and a link to the exact comment. Nobody outside the project is told; an edit only tells the people it adds; mentions in code don't count. Comment notifications now open the comment too.
- *Mentioned in* on every task: the other tasks whose description or comments name it, only from projects you belong to (`GET /api/tasks/{id}/mentions`).
- Same rules on both sides: `TextRefs.java` and `richText.ts` are tested with the same cases (keys inside longer keys, words, links or code don't count; first names only when one member has them).

### The inbox
- Grouped by day, with compact rows: the unread dot in its own column, task keys set in ink, the quoted words of a comment or mention set apart. Tabs: All, Unread, Mentions, Assignments, Reviews, Submissions, Invitations. Actions appear over the row's end when you point at it; on touch screens they're in a menu.

### The task page
- A document instead of six stacked cards: where it stands and the next step, the description as the body, then what done means, what's in the way, the review record, *Mentioned in* and the discussion. Properties sit beside it on wide screens as quiet controls, and under its head on phones and in the board's side panel. Empty sections are a line of text.

### Since you were last here
- Today opens with what other people did in your projects since your last visit, counted from the activity records, with the latest few (`GET /api/catch-up`, `POST /api/catch-up/seen`; migration `V7__catch_up.sql` adds `users.caught_up_at`). Your own actions don't count; counting stops two weeks back. The demo data starts everyone three days back.

### The keyboard layer
- G then a letter goes to a page (T, M, I, P, C, R, S) or, in a project, to a chapter (O, B, L, D); C opens New task; J and K move through lists; ? lists everything. The command palette shows each page's sequence. Shortcuts stay quiet while you type or a dialog is open.

### Glyphs
- Status is a gauge that fills as work moves through its layers, with a red pip when late; priority is three bars, and a red tile for urgent (`components/glyphs.tsx`). They replace the generic circle and arrow icons.

## The snowpack: Niveloft rebuilt, from the design system to the 3D views (2026-10-06)

Every page and every 3D view is rebuilt around one idea: **a project reads like snow, in layers.** Approved work is the firm base, then work in review, work in progress, and fresh snow on top; each task is one slice of its layer, and the late task holding the most work up is the **weak layer**, in red. The same five colours carry meaning everywhere: the front page's block, Today, each Overview, the strata bars, the charts and the 3D model. The backend's rules, the data, the permissions and the review workflow are unchanged; the API gained two small fields (below).

### Design system
- **Tokens** (`frontend/src/index.css`): a cool snowfield canvas, white surfaces, night-blue ink, glacier blue only for actions, links, focus and the selected item, and the five strata colours (`--strata-todo`, `-progress`, `-review`, `-done`, `-weak`), checked with a colour-blind palette validator against each theme's surface (the dark steps were re-chosen so every neighbouring pair stays apart). `--plate-top`/`--plate-bottom` and `.bg-plate` for the plate a block stands on.
- **Type:** Geist for the interface and Archivo, set wide, for headlines and big readings (`.display-poster`, `.display-wide`, `.reading`). Inter and IBM Plex Mono are gone. No monospaced labels, nothing set in capitals by CSS, sentence case everywhere, and plain punctuation for metadata (commas, colons, parentheses) instead of strings joined with middle dots. Code and commands keep the system monospace.
- **Logo:** a peak drawn as three layers of snow (a glacier-blue cap over two settled layers); the wordmark in Archivo with a diamond for the i's dot. New favicon set, app icons and social image, rendered from the current mark and the real block.
- **Components** restyled: buttons, fields, cards, menus, dialogs, badges, segmented controls, page headers, and a new `StrataBar` (approved, late, in review, in progress, not started) with its legend.

### App shell
- A stable sidebar (the places, your active projects, Flurry, help, your account) and a top bar that names where you are. A project's header gives its health, your role, dates, people and a strata bar; its chapters (Overview, Work, Delivery, Graph, Prediction model, Schedule, People, Settings) stay under the top bar as the page scrolls, with the chapter's views just beneath.
- Gone: the `//` trails, the `//////` section marks, the clock stamp and the titles that decoded into place. The weather behind the pages is now a faint wash of cold light; the snowfall is off unless turned on in *Settings → Appearance*.

### The front page, from scratch (`features/public/home/`, `three/SnowpackScene.ts`)
- **The first screen:** the promise as the heading, set wide and heavy; one action (*Open the sample project*); and three readings from the sample (17 tasks and 6 people, the likely finish window, the chance of finishing on time). Beside it, the sample project as a block of snowpack on a plinth, lit like a product shot, with snow falling. Point at a slice for its task, layer, lateness and owner; click it for the sample workspace; drag to turn the block.
- **Read it in layers:** scrolling lifts the layers apart and reads them top down, one per screen (*Fresh snow on top*, *Settling*, *Waiting for a decision*, *Firm at the base*, *The weak layer*), each with what it means in Niveloft, then closes the block again. On phones the block stays at the top while each layer's words come up beneath it, and slide away under it.
- **The still:** until three.js has loaded, and in browsers without WebGL, the same block is drawn in SVG, projected with the scene's own camera (`three/snowpackFrame.ts`, checked against three.js in its tests), so it fades into the 3D scene in place, labels included. The scene now starts settled for the same reason.
- **The product, working,** as ordinary sections (no panels): the sample workspace, the forecast playground, the four role views, Flurry, the questions, and the ways in (create a workspace, log in, or step into the sample as one of its team). Deep links (`/#product`, `/#how`, `/#roles`, `/#flurry`, `/#questions`) scroll to them.
- Removed: the mountain world, its stations, panels, ascent rail, sound, snow bulletin and stills (`public/home/loft-*.webp`).

### Public pages
- The introduction, questions and answers, Meet Flurry, the privacy policy and terms, the sign-in pages and the 404 drop numbered and capitalised labels and square boxes; the permission table uses icons; the 404 has a curious Flurry and *Go to Today*.

### Today
- Your active projects (up to eight, the least healthy first), each a small block of snowpack made from its task counts, with late work laid down as a red weak layer above the approved base, all drawn in one 3D scene behind the tiles (flat drawings without WebGL; on phones the tiles swipe sideways). Each tile gives health, key, name, share approved, a strata bar and the deadline.
- *Needs you*, grouped by how soon (*Now*, *Soon*, *Worth a look*), each item with an icon for its kind and the rule that raised it; *Up next for you*; *Next three weeks*; *Approved recently*. *Projects* uses the same tiles with each project's description, owner and members.

### Each project's Overview
- Under the delivery forecast, **the project's own snowpack** (`features/overview/`): the front page's block made from the project's tasks, with every late task in red and the weak layer called out in a sentence. Beside it, the layers as a list with counts and shares; pointing at a layer lifts it out of the block, and each opens its tasks, grouped and sorted. Clicking a slice opens its task. The old number grid and the avalanche are gone.

### Charts
- **Recharts is removed.** Charts are drawn by hand in SVG (`features/analytics/svgCharts.tsx`): thin lines, rounded bar ends, 2 px gaps between stacked segments, clean ticks, a readout that follows the pointer and can be walked with the arrow keys, a legend for every multi-series chart, and a table view for every chart. Flow over time is drawn as a snowpack: approved at the bottom.

### The other working pages
- Delivery outlook, Dependencies (larger nodes that never clip their text), What if, Analytics, Prediction model, Graph, Timeline, Milestones, People, Activity and Settings restyled in the system, with sentence-case labels, readings in Archivo and more room.

### 3D
- A shared kit (`three/snowpackKit.ts`): the striated texture of a cut snow wall, a soft contact shadow, layer geometry that follows a surface; the palettes in `three/snowPalette.ts`, kept apart from three.js so the still drawings can use them. Every scene uses filmic tone mapping, a studio environment and the snowpack's lights, plinth and palette.
- In the workspace, scenes draw only when something changes; three.js loads after the first paint and never on pages without 3D (`three/capabilities.ts` has no three.js import). Reduced motion stops the snowfall and the sway.

### Flurry
- New artwork and expressions, and its panel says plainly what answers: *AI model on: llama3.2*, *AI model on, in this browser*, or *No AI model: built-in answers*; plans say *Draft plan by AI (model)* or *Draft plan from your brief’s own lines (no AI)*.

### Backend and demo API
- `TaskCounts` adds `overdueTodo`, `overdueInProgress` and `overdueInReview`, so a block can say which layers late work is in; `UpcomingItem` adds the task `key`; attention titles and search results use plain punctuation. The mock API matches.

### Removed
- The `recharts` dependency; Inter and IBM Plex Mono; the mountain world and its avalanche; the project avalanche, the portfolio skyline, the project cards and towers, the decoding titles, and the unused snow-field helpers.

### Found and fixed while checking
- The front page's words sat on top of the block, so it couldn't be pointed at, clicked or turned; only the words themselves take the pointer now.
- The layers not being read were faded to 35% opacity, below the contrast text needs; they now step back to muted text instead. The same on the dependency map, where tasks off the traced chain were faded: they now turn flat and grey with their words at full contrast. A faded month label on Today is solid again.
- Flurry could rest with a corner over a button (the review's *Approve*, say): any control reaching into its spot now counts as occupied, so it moves somewhere clearer.
- The front page rendered every working section before its first screen could paint: they now load after it, and the sample's forecast is worked out once instead of four times.
- On phones, each layer's card covered the block it describes; the block now stays above the cards. The weak layer's label is kept inside the frame on narrow screens.

### Checks
- Type check and syntax: 0 errors; backend compiled with tests: 0 errors; 267 unit tests (new: the still's projection checked against three.js, its labels and red slices, Today's blocks).
- Browser suites, all passing with no page errors: the front page and the workspace (100 checks, new), Flurry, the Delivery outlook and Meet Flurry (68), help, search, forms and printing (89), the calm redesign (7), the Prediction model (10), Flurry's panel and voice (33), the AI in Chrome with a stand-in (14), launch features (24); hover on 23 pages (372 controls).
- Launch audit on 41 routes in both themes at 1440 and 390 px: no contrast, phone-layout, naming or heading findings after the fixes above; 149 internal links, none broken.
- Speed on a simulated slow phone: first paint 4.9 s on `/` (5.7 s before the sections were deferred) and 3.9–4.3 s on `/login`, `/privacy` and `/introduction`.

## Flurry, the character: Meet Flurry, a companion in the workspace, and the Delivery outlook (2026-10-06)

Flurry is shown on its own first (its look, idle pose, floating, dragged reaction and click-to-talk), then placed in the workspace with the behaviours you described, and the answers it gives are tied to the exact project and task in front of you.

### Meet Flurry (`/flurry`)
- A public page (`features/flurry/meet/`, `pages/public/FlurryPage.tsx`, its own pre-rendered `flurry.html`): the character first, with its anatomy (rounded body, two eyes, tiny arms, icy-blue glow), the figure at 120, 72, 56, 40, 32, 24 and 16 px in light and dark, and the eight behaviours (idle, roaming, dragged, clicked, working, task completed, attention needed, dismissed) each running live.
- **A sandbox:** a small stage with a sidebar and three of the sample project's tasks. Drag Flurry and it trails the pointer and settles where you let go; click it for *Ask Flurry · My next task · Delivery outlook* and *Roam · Stay here · Hide*. Its answers come from the sample's records and it says so (*No AI model · built-in answers · sample project*).
- The rules it keeps and what it never does, including that it stays inside Niveloft (a desktop companion would be a separate app). Linked from the front page's *More*, the footer and site search.

### Flurry in the workspace
- **Modes:** *Roam · Stay here · Hide* (replacing *Let Flurry roam*, *Keep Flurry still*, *Minimise* and *Hide*; older settings are carried over). **Size:** small, medium, large. **Motion:** full, calm (reacts, doesn't float or fly) or off. All in its menu and Settings → Flurry.
- **Roaming** only after 30 seconds without keyboard or mouse, between a few fixed safe spots, including the sidebar. It pauses while you type, drag tasks or use a menu, and moves to a clearer spot when a page fills in or scrolls under it.
- **Dragged:** it follows the pointer with a slight trail, arms up, and settles exactly where you let go. A drag no longer opens its menu.
- **Clicked:** it turns towards you and opens a compact menu: what needs you (if anything), **Ask Flurry · My next task · Delivery outlook**, the modes, and *Size, motion and more*.
- **Attention needed:** a small indicator; the menu names the actual review or blocker, each opening the right page. It no longer counts what was already there when the page loaded as new.
- **My next task:** Flurry flies beside that task on the page, points at it and gives one or two sentences with *Open it* / *Not now*.
- **Task completed:** a brief happy reaction after a submit, an approval, a plan created or an estimate applied.
- **Dismissed:** *Hide* retreats into its *Ask Flurry* item in the sidebar, asleep, with **Call back**.
- **Notes are user-triggered by default**; *Let Flurry speak up* (Settings → Flurry) lets it raise new things once each.
- **Phones:** one fixed spot on the bottom edge, expanding into its menu when tapped.

### The Delivery outlook (each project's chapter III)
- **Four readings:** target, median finish, 85% finish by, on-time estimate (`progressForecast` now gives the 85th percentile and a whole-project series, and accepts estimate overrides for scenarios).
- **Path view** over quiet decorative terrain and **Chart view** with a table, both from one forecast snapshot; milestone labels, and the chart's target, median and 85% markers, are laid out in rows so they never overlap, even on a phone. Phones open on the chart.
- **The inspector** names the one task holding the selected milestone up (*Awaiting a decision*, *Running late*, *Holding up delivery*, *Last to finish*) with *Open the review* / *Open task* (`features/delivery/deliveryPath.ts`).
- **Flurry at the milestone:** selecting a milestone brings Flurry beside it (on the chart, just under its button, so its note covers none of the others), pointing at the blocker: *"This review is holding up ONB-10. Open it?"*. Flurry's *Delivery outlook* opens the chapter of the project you're in (or the one most at risk) and does the same.
- **Preview scenario:** smaller scope (estimates) or an assumed pace (time, never saved), with the baseline in grey; *Apply* lists the exact estimate changes, saves them through the normal endpoint with your permissions, and offers Undo.
- In the command palette as *Delivery outlook*.

### Answers tied to what you're looking at (the bugs in the blueprint)
- **Scope is visible and follows the page:** the project you're on, *Task ONB-9* on a task's page, or *All projects* on Today and the other cross-project pages. Flurry no longer opens on another project from the dashboard.
- **It never guesses a project:** a question that needs one gets "Which one is this about?" with a button per project; a question naming another project's task offers to look at it there.
- **Switching project starts a new conversation**, so an old answer never sits under a new project; moving between all projects and one adds a visible *Scope: now …* line.
- **A question about one task gets an answer about that task** (`features/assistant/taskAnswer.ts`): its state, what it waits on and what waits on it in the right direction, a corrected premise ("ONB-9 isn't blocked…"), what isn't recorded (why it's late is never inferred), and the move that fits.
- **Review-aware advice:** late work waiting for review is reported separately, and the advice is to open the review, not to move the date or cut scope. The AI instructions (server and in-browser) gained the same rules: answer the exact question, keep dependency direction straight, don't infer a reason for a delay, and point submitted work at its review.

### Checks
- New unit tests: exact-task answers (5), the task-question intents, the review split in *Review blockers*, the 85th percentile, the project series and estimate overrides (3), the delivery path's blocker, wording, time scale and label layout (11), and standing under a row of controls. 262 in all.
- A new browser suite for Flurry and the outlook (68 checks): the companion's behaviours and settings, the outlook and its scenario, the scoped and exact answers, Meet Flurry and its sandbox, and phones.

## The mountain: snowfall, an avalanche, and a Fuji-like cap where every task sits at its altitude (2026-10-05)

The front page is rebuilt around one idea: *work comes down all at once; Niveloft settles it.* A single Fuji-like mountain replaces the crystals and the platform, with a concept, type and copy of its own rather than a landing-page template.

### Front page
- **One mountain** (`three/MountainWorld.ts`, geometry in `three/summit.ts`): a procedural cone with Fuji's profile, a crater, radial gullies, foothills, distant ranges, pines, a sea of clouds, and a night sky with stars, a moon and the odd shooting star. `three/LoftWorld.ts` is removed.
- **Snowfall and an avalanche:** heavy snow and a storm over the first screen; an avalanche pours down the front flank as a powder cloud with billows, the sample project's seventeen tasks tumbling in it as survey stakes.
- **Scrolling disciplines it:** the storm calms, the snow lifts off the slope and settles on a clean cap in four layers with Fuji's radial streaks, and every task lands at its **altitude** (approved at the summit, then in review, in progress, not started lowest; the lowest layers land first). Each layer is named with its real count (*APPROVED · 6*, *IN REVIEW · 1*, *IN PROGRESS · 4*, *NOT STARTED · 6*).
- **What's in the way burns red:** the late task holding the most work up (worked out from the sample's records in `features/public/loft/survey.ts`: *ONB-9*, two days late, holding up three) is a red beacon with its own tag.
- **A snow bulletin** in the corner (tall screens) reads the sample's real figures: the snowpack (*UNSETTLED → SETTLING → LAYERED*), tasks in place, approved at the summit, the crew, what's in the way.
- **Five stations** replace the crystals: Base camp (the workspace), the Lookout (four views), the Weather station (the forecast, with a turning anemometer), Flurry's hollow and the Hut (questions), each a small building with lit windows and a tag. The camera dives down and flies round the mountain between them; drag to look around; each station's bracketed button opens its panel as before.
- **The summit** replaces the platform: the whole mountain at dawn, *Open the sample project* first, *Create your free workspace* second, and Flurry, *Log in* and the introduction, all visible.
- **Night and first light:** the dark theme is a clear night with moonlit snow and warm windows; the light theme is first light with volcanic rock; both end at dawn.
- **Copy and hierarchy:** one primary action on the first screen (*Open the sample project*, "No sign-up. Nothing you do is saved."), the header's *Open the sample* after the first screen, an ascent rail on large screens, and a lede that says what the picture means.
- **Type:** Archivo (variable, wide and heavy) for the public pages' headlines and the front page's place names (`.display-wide`, `.display-place`).
- Stills, the social image and the alt text are regenerated for the mountain.
- **Slow hardware:** when the world stops animating to save power, it draws where the page is, once, at rest, rather than freezing halfway through a change (stakes in mid-air, tags half faded).
- Tags over the world keep clear of the ascent rail; the beacon's tag sits on a plate in its own red, its leader line running down to the beacon; the sound switch and the scroll hint sit on small plates, so they stay readable over the dark volcanic rock in the light theme. Front-page Flurry never lands on the ascent rail.

### The workspace
- The faint mountain behind every page is now the same Fuji-like cone with its layered cap.

### Checks
- New unit tests: the mountain's geometry, layer bands, stake slots and landing order, the bulletin's share and words (`three/summit.test.ts`), and the survey's counts and beacon (`features/public/loft/survey.test.ts`). 230 in all.
- The Niveloft browser suite's front-page checks are rewritten for the mountain: unsettled at first, layered after a screen of scrolling, the layer counts, the beacon's tag, stake hover and click, the stations, the summit and the ascent rail.

## The avalanche, a roaming Flurry and the workspace in the same weather (2026-09-29)

The front page's look now carries into the app, Flurry roams until it's called, and the ice-brick mark on the front page is replaced by a scattered avalanche that scrolling disciplines into rows of snow on the mountain.

### Front page
- **The avalanche** replaces the ice-brick mark (`three/snowfield.ts`, `three/LoftWorld.ts`). A mountain face with hundreds of snow blocks (one per sample task, 420 on desktop, 220 on phones) tumbling down it in a loose stream with powder billows. Scrolling the first screen disciplines it: blocks fly out of the stream one after another, lowest rows first, and land in ordered rows on the slope, while the scoured, streaked mountain turns to fresh snow. A block is always either in the stream or flying to its row, never left hanging halfway. Hover lifts the nearest blocks and shows their task keys; a click opens the workspace. The camera then climbs the slope into the cloud before the crystals.
- A readout in the corner (*AVALANCHE_01*, *SCATTERED / SETTLING / IN ROWS*, the share in rows) follows the scroll; the scroll hint reads *Scroll to settle the snow*.
- The platform's first shape is now a mountain with its snow laid in rows.
- **Flurry roams the front page**, never landing on the words or controls; clicking it opens its panel. *Keep Flurry still* is in the *Menu*.
- Phones stand further back so the stream stays below the heading, with a little fog behind the heading.

### Flurry
- **It roams** (`features/flurry/roam.ts`, `useFlurryRoam.ts`): rests a few seconds, then flies in a soft, banking arc to another spot along the edges and empty parts of the page. It never lands on the field you're typing in, under the pointer, on open menus, dialogs or notices, or where it just was; it stays clear of the sidebar and the top bar.
- **It notices you:** its eyes follow the pointer; pointing at it or focusing it with the keyboard holds it still, and it looks back (a *curious* expression).
- **Called, it comes:** it flies to the conversation, perches on the card's top edge (or beside it when there's no room above), waves, and stays while it's open; clicking it then takes you to the question box.
- **Out of your way:** it flies off a field you start typing in, holds still while you type, and naps in its home corner after two quiet minutes (new *sleep* expression).
- **Drag it** anywhere: it stays there for half a minute, and the nearest corner becomes its home.
- **Stopping it:** *Let Flurry roam* (⋯ menu and Settings → Flurry), *Keep Flurry still*, *Minimise* and *Hide*; reduced motion stops it automatically. With roaming off it rests in its home corner and steps aside from fields as before. On phones it moves only along the bottom edge.
- The conversation's header shows a small mark instead of a second Flurry while Flurry perches beside it.

### The workspace
- **Weather behind every page** (`components/layout/AppAtmosphere.tsx`): a faint mountain range with its snow in rows along the bottom of the window and light snowfall, behind all content, still under reduced motion, paused in hidden tabs, and switchable in *Settings → Appearance*.
- **Instrument labels:** a `//` trail and a date-and-time stamp in the top bar, `//////` section marks in the sidebar and the assistant, mono eyebrows on page headers, and page titles that decode into place (screen readers get the real title at once).
- **Each project's Overview has its avalanche** (`features/overview/ProjectAvalancheCard.tsx`, `three/ProjectAvalanche.ts`): the project's own tasks as snow on a mountain. Approved work settles into rows in the order it was approved, work in review hovers over its place, the rest is still coming down, and work that holds others up glows amber. Hover a block for its key, title and state; click to open the task. The same information is beside it in words and as a list. It follows statuses only and changes nothing.

### Checks
- New unit tests: the avalanche's settling order and share (`three/snowMath.test.ts`), Flurry's roaming (spots, never under the pointer or on a field, fleeing a field, flights and banking, gaze, perching; `features/flurry/roam.test.ts`) and the project avalanche model (order, blocking, targets, the sentence; `features/overview/avalancheModel.test.ts`).
- The Niveloft browser suite covers the avalanche settling, the front page's Flurry, Flurry roaming, perching, dodging, dragging, roaming off and the rest of its menu, and a new *workspace* part (weather, instrument labels, the project avalanche and its list).

## The front page, as a cinematic journey (2026-09-29)

The front page now looks and moves like the reference video the owner sent: a monochrome 3D world with small monospaced instrument labels, built as Niveloft's own (no name, logo, character, text or brand logos from the reference).

### Added
- **The ridge:** a misty snow ridge with mountains, and the Niveloft mark built from ice bricks, lit from inside, with glowing seams (`three/LoftWorld.ts`). Each brick is a task from the sample project: hovering lifts the nearest bricks and shows their task keys with leader lines; clicking opens the workspace. The promise is the page's heading, in the corner, with one action.
- **The crystals:** a fly-through into a bright void with five faceted ice crystals, one per screen, each with a raised symbol, a label, readings from the sample and *Click to explore*. Each opens a dark summary panel (mono text that brightens under the pointer) with the real thing inside: the sample workspace and the demo sign-in, the role graphs, the forecast playground, Flurry, the questions.
- **The platform:** a ring platform where particles gather into the next step (the mark, Flurry, create, log in, the introduction), with arrows between steps.
- **The instrument frame:** the mark and a *Demo* tag, a *Menu* (sections, pages, search, theme, contact, cookies, legal), *Sound: Off/On*, bracketed controls, decoding labels. IBM Plex Mono is back, for these labels only.
- Deep links (`/#product` and the other sections) open their panels, so site search and the other pages' navigation still land on the right thing.

### Changed
- The earlier ice-sculpture story and the long scrolling sections are replaced by the three places and their panels; all their content is still there, inside the panels.
- New stills, social image and brand guide section.
- Speed: the world is built in two steps (the ridge first, the rest when the browser is idle), its reflection map is small, shaders compile without blocking where possible, phones get lighter materials, and slow hardware drops resolution and then animation.

### Checks
- The Niveloft, polish and calm browser suites were rewritten for the new page; the site-search and FAQ tests understand the crystals' anchors.

## Improvements: delivery forecast first, role graphs, a quieter Flurry and the ice story (2026-09-29)

This release answers two reviews: a hard critique of the product (forecasting, graphs, Flurry, reports, the front page) and a design critique (colour, type, layout, the front page's order). The product is now positioned around one promise: **see what will finish, when, and what’s in the way**, for small software and student teams.

### Flurry
- **AI replies that aren't clean JSON no longer break.** The browser's raw parser error (*Unexpected non-whitespace character after JSON…*) was shown to people. Replies are now read by a balanced-brace scanner that tries each JSON object in the text, falls back to a prose answer when there's no JSON (labelled with a note that the AI didn't use the expected format), and otherwise says in one plain sentence that the reply couldn't be read, with **Try again**. The technical detail goes to the browser console. The backend reads replies the same way (`AiService.parseReply`, with a new test).
- **Small by default.** Flurry rests in a corner as a small figure; opening it shows a compact card (400 px, 520 px for a plan or agenda, at most 640 px tall) instead of a full-height side panel. **Pin** docks it beside the page, and the page makes room. Phones get a full-screen sheet and a small, still button.
- **Corners, never covering fields.** Dragging snaps it to the nearest corner; the menu has *Rest in a corner* for keyboard users. When a field you focus would sit under it, it moves to the opposite corner and comes back after you leave the field. It never pops up on its own and has no speech bubbles; its idle motion is smaller and slower.
- **Greetings and thanks** get a short reply (*Hi Aarav. I’m Flurry…*) instead of a search. New questions: *When will I finish?* (your own forecast) and *Will we make the deadline?* now quote the delivery forecast.
- **It never invents dates.** Dates in an AI answer may only come from the forecast range and scheduler estimate it's given; the range is now part of the prompt (and of the server request, `forecast.range`).
- The owner suggestion in *Review blockers* now says plainly: *a manager can give each one an owner… I won’t assign people for you.*

### Forecasting
- **A delivery forecast leads the Overview and Reports:** the likely finish as a window, the most likely date, the chance of the deadline, what holds it up and the next move, then *remaining work*, *blocked tasks* and *available capacity*, then the timeline, then breakdowns.
- **Three separate answers:** remaining effort, *your* finish (after the work you wait on) and the project's finish. It names the main dependency, the availability assumption, data quality and when the records last changed. *Your time for this project* is a what-if that moves dates, not effort.
- **The engine is dependency-aware:** a Monte Carlo list scheduler where a task starts only when what it waits on is approved, each person does one task at a time and picks up other ready work while waiting, review time is added after submission, and unowned tasks start today (flagged).
- **Calibration is checked, not assumed:** each forecast reports how often its 80% ranges held for finished tasks (leave-one-out), or says there are too few to judge.
- **The plan and the forecast no longer contradict each other:** the scheduler's date is labelled *the plan, if every task takes exactly its estimate*, and the forecast explains why it differs. A health badge that disagrees with the forecast explains itself.
- **Demo data** now has realistic estimates, so its forecast is believable (it had said 0% chance for a project that was on track).
- **No productivity rankings:** the per-person table is labelled as not a ranking, and the Pace tile is replaced by *How good are the ranges?*

### Graphs
- **A 2D work graph is the default** (the chapter is renamed *Graph*): time across, one row per person, recorded work solid, planned work outlined, the forecast as a band, priority as a badge, the Today and Deadline lines, dependencies drawn only for the selected task, and everything else faded while one is selected. Labels stay fixed while time scrolls.
- **A view per role:** a member opens on *What should I work on, and when am I likely to finish?*, a reviewer on *Whose delivery am I blocking?*, an owner or manager on *What threatens delivery, and what change would help?*, a viewer or client on the delivery forecast by milestone.
- Always there: 2D or 3D, a date range, **Show as a list**, **Reset**, and keyboard access (arrow keys, Home, End, Enter, Escape).
- **The 3D model** is quieter: every block has the same height (priority is in the details, never size), matte materials, dependencies only for the selected chain unless you ask for all, a readable default camera, and sentence-case labels.

### Reports and numbers
- Reports open with a compact title row and a project selector, then the forecast, three numbers, the timeline and the breakdowns.
- Progress is **tasks approved** (*N of M*); effort-weighted progress appears only when at least 70% of tasks have estimates.
- **Cycle time** shows its definition, *n*, the median, the middle half and the full range, with a dot strip of every task.
- The project header says *N of M tasks approved* and *X% of the time to the deadline has passed*.

### Design
- **The palette from the design review:** canvas `#F6F7F9`, cards `#FFF`, ink `#17212B`, secondary `#596575`, primary `#245B78`, borders `#DCE3E9`; dark `#10151B` / `#18212B` / `#EDF2F7` / `#A5B2C0` / primary `#A8D8EE` with dark text / `#33404D`.
- **One family, Inter,** with the review's type scale, sentence case everywhere (no uppercase overlines), and tabular figures for keys, tables, dates and metrics. Manrope and IBM Plex Mono are removed.
- Fewer borders and shadows, 12 px card radii, flat primary buttons, no glass behind text. Buttons keep their label in place under the spinner while working. *Saved* notes appear only after a successful save and clear on the next attempt.

### Front page
- **New order:** the promise and one action over a restrained ice sculpture → four short, skippable steps (*Scattered*, *Assembled*, *Timeline*, *Forecast*, where the window, the deadline and the one blocker appear) → the sample workspace → *The same project, a different question for each person* (the four role graphs on the sample) → *Change an assumption. Watch the forecast move.* (three what-ifs, computed in the browser by the app's own engine) → Flurry → questions → a final action.
- The sculpture is built from the sample project's tasks (`IceSculpture.ts`); the alpine scene is removed. New stills, social image and page title and description.
- The navigation is *Product · Views · Forecast*; site search and footer links point at sections that exist (checked by a test and by the browser suite).
- Demo mode stays explicit: a *Demo* badge in the public header and a notice in the app's sidebar that everything stays in this browser.

### Fixed
- Front page role graphs: one-row lanes no longer overlap their labels, task keys aren't truncated before titles, dates don't hide under the Today and Deadline tags, and the delivery view's rows have room for two lines.
- The public footer leaves room for the floating Contact button.

## Niveloft: rebrand, the alpine front page and Flurry (2026-09-29)

ProjectFlow is now **Niveloft** (a working name: availability is still to be checked), *Project workspace for focused teams. Great work. Clear direction.* See [docs/BRAND.md](docs/BRAND.md).

### Added
- **Brand:** the Niveloft palette (snow, white, graphite, slate, ice blue, glacier, frost, glow) in light and dark, Manrope for display, Inter for text and IBM Plex Mono for keys and numbers (all self-hosted), a new mark (three planes: an *n* and a lit shelter) and wordmark (the i's dot is an ice-blue diamond), and regenerated favicons, app icons, manifest and social image. Radii are 8/12/16 px; main buttons are 48 px, everyday ones 40 px (44 px on touch screens).
- **The front page** is a scroll story inside an original alpine scene drawn with three.js: an illuminated glass pavilion, terrace and tower in a snowy valley. The sample project's tasks rearrange in four chapters: Projects, Tasks, Team and Progress. It has:
  - a still of the same scene that shows at once and stays without WebGL;
  - a separate phone composition, fewer particles and no shadow maps on small screens;
  - reduced motion (chapters snap, no snow), rendering paused off screen and in hidden tabs;
  - optional sound, off by default;
  - chapter buttons, a text equivalent for every chapter, and a *Skip the story* path.
  Then: the product preview, *Plan. Assign. Track.*, features, the interactive sample workspace, Flurry, a use case (no invented customers), questions, a closing call to action and a new footer. The header is *Product · How it works · Log in · Explore demo*.
- **The sample workspace**, *Launch the mobile onboarding update*: 17 tasks, 6 people, 3 milestones, a late task that holds others up, a waiting review and two unowned tasks. Board, list and timeline views, a person filter, a task panel with the app's workflow rules, owners, *Reset*, clearly labelled as a sample that saves nothing. The same project is in both demo datasets.
- **Flurry**, the AI project assistant (replaces *Assistant*):
  - **Plan a project:** a brief becomes up to 12 draft tasks (AI) or tasks drafted from the brief's own lines (no AI, labelled), reviewed before anything is created, then created through the normal endpoint with the suggested order as dependencies, with **Undo**. Server: `POST /api/projects/{id}/ai/plan` (needs permission to create tasks; nothing is saved by the endpoint itself).
  - **Summarise progress:** what the records show, what that suggests (estimates) and what the records don't show, kept apart.
  - **Review blockers:** late work that holds other work up, work without an owner, long review waits, each with a next move and *Dismiss*. It never assigns or reschedules.
  - **Meeting agendas** drafted from the records.
  - **Undo** for tasks it created or started.
  - **In the corner of every signed-in page:** drag it anywhere (remembered per person), move left or right from its menu, minimise, hide, sounds (off by default), *Keep Flurry still*, and reduced motion. It thinks, cheers and frowns only in response to what you asked, and settles while you type elsewhere. On phones it's a compact button. **Settings → Flurry** has the same switches.
  - *Ask Flurry* in the sidebar and in ⌘K, with shortcuts for its three abilities.
- **The app's sidebar:** a stable sidebar with the places, active projects, *Ask Flurry*, help, settings and the account menu, and a top bar naming where you are; a drawer on phones and tablets.
- **Tests:** Flurry's reports, plan drafting from a brief, the plan prompt and its validation (browser and server), the new sample project, and a Spring test for the plan endpoint.

### Changed
- Every page, email, API title, policy and FAQ answer says Niveloft. Internal identifiers keep the old name (`dev.projectflow`, the `projectflow` database, `projectflow.*` storage keys, `@projectflow.dev` demo accounts), so existing data and sign-ins keep working.
- *Sign in* is now *Log in*, and *Create account* is *Create your workspace*.
- The masthead is replaced by the sidebar; the old *Assistant* button by Flurry.

### Fixed
- The account and Flurry menus opened off screen near the bottom of the window; they now open upwards.
- The cookie banner covered the sidebar.
- Focus didn't return to the task after closing the sample workspace's panel.
- three.js r186 warnings in the console (the deprecated `Clock` and the removed soft shadow maps).

## Help, contact, forms and the Arena (2026-09-28)

### Added
- **Site search:** `/`, ⌘K or the header's search button on public pages finds FAQ answers, introduction chapters and policy sections as you type, with the matched words highlighted. In the app, ⌘K lists the same answers under *Help*.
- **Questions and answers** (`/faq`): 24 expandable answers in 7 topics, with links to each answer, *Copy link*, *Expand all* / *Collapse all*, a filter, *Print*, *Last updated* and FAQPage structured data. The front page shows five of them.
- **Contact:** a floating *Contact* button on public pages, and *Contact us* in the app's menus and on error messages. Messages are saved for the operators and emailed to `CONTACT_EMAIL` when email is set up. Honeypot, rate limit and optional Turnstile, as on sign-up. A message sent twice is saved once.
- **Site health** (`/site-health`), for accounts listed in `OPERATOR_EMAILS`: form success rates, sign-up sources, contact messages (mark answered), spending against the caps, and a tagged-link builder.
- **Form success rates:** every form reports shown / sent / accepted / refused / failed as daily counts (no contents, no identity).
- **UTM tracking:** campaign tags (or the referring site) are kept for the visit, removed from the address bar and saved with new accounts and contact messages. With analytics consent, Google Analytics gets them on the first page view.
- **The Arena** (`/arena`): two answer sources (the built-in model, the AI in Chrome, and each chat model installed in Ollama on the server) answer the same question about a project blind; you vote, the names are revealed, and a site-wide scoreboard counts the wins. Only the outcome is stored.
- **Server:** `GET /api/ai/models` and a `model` choice when asking about a project; `POST /api/contact`, `POST /api/metrics/forms`, `GET /api/site-health`, `PATCH /api/site-health/contact/{id}`, `POST /api/arena/votes`, `GET /api/arena/scoreboard`; migration V6 (contact messages, sign-up source columns, Arena votes); `operator` on the signed-in user.
- **Scrolling aids:** a reading-progress line and a shadow on the sticky header, a *back to top* button (it also returns focus to the content), and a down arrow on the front page that skips past the 3D preview.
- **Phone menu** for the public pages (pages, search, contact, sign-in, theme).
- **Copy buttons** for FAQ links, task keys, AI drafts, assistant answers, error references and tagged links. They say *Copied* (and announce it), and fall back when the clipboard is blocked.
- **Print stylesheet:** white paper, dark text, no navigation or buttons, answers expanded, link addresses printed, a header with the page and time, and a note in place of 3D scenes. *Print* buttons on FAQ, Reports, project summary, Prediction model and Site health.
- **Last updated** stamps with a refresh button on Today, My work, Projects, Inbox, Reports, the project summary, the Prediction model and Site health.
- **Loading:** a thin progress bar at the top whenever data loads (quick loads show nothing), page-shaped placeholders with a soft shimmer instead of spinners.
- **Password rules** that tick off as you type on sign-up, reset and change password.
- **Error summaries** listing every problem when a form has more than one, each linking to its field; **success panels** and *Saved* notes.
- **Confirmations** before discarding a changed form (and before leaving the page with one), revoking an invitation, removing a dependency, applying a plan and marking many notifications read.
- **Tests:** site search, the FAQ's links and structured data, UTM parsing and clean-up, form counts, Arena pairs, the demo API's new endpoints, and Spring tests for contact, form counts, sign-up sources, Site health access and Arena votes.

### Changed
- **Sticky headers:** a project's chapters and views stay under the masthead while its pages scroll (views scroll away on phones, to leave room).
- **Hover and press states:** every link and button now visibly reacts to the pointer; buttons press down a pixel when clicked.
- **ARIA:** confirmations are `alertdialog`s; menu buttons say whether they're open; icon-only buttons, the search box and progress bars are named; live regions announce copying, saving and results.
- **The built-in model** answers deadline questions ("Will we make the deadline?"): the scheduler's finish against the deadline, and the tasks most likely to be late.
- **Privacy policy** lists contact messages, UTM tags, form counts and Arena votes.

### Fixed
- Ticking a checklist item on a task page emptied the page until it was reloaded (the saved task was put back into the cache through `transformResponse` a second time).

## Prediction model, and running safely under load (2026-09-28)

### Added
- **Prediction model:** a new project chapter (IV), with a 3D chart of each person's progress, grouped by role (owner, manager, member, viewer).
  - History is a staircase of tasks each person got approved, from the project's recorded status changes.
  - The forecast runs 400 simulations of the work that's left. Each one uses that person's own pace against their estimates (shrunk towards the team's pace while there's little history) and the time reviews usually take.
  - It shows the likely finish (p50) and a range (p10 to p90) for each person, each role and the project, and compares them with the deadline.
  - It says what it learned from, and says plainly when no finished task has an estimate yet (so ranges are wide). Pointing at a row in the table below the chart highlights that person's line; the table gives the same numbers to keyboard and screen-reader users.
  - Loading, empty (no tasks, nobody with a role) and failed states each have their own message.
- **Rate limits:** 300 requests a minute per person, 120 per address without sign-in, 60 changes a minute and 60 uploads an hour. Going over answers 429 with `Retry-After`. Each limit is a setting; 0 turns it off.
- **API limits:** JSON bodies up to 512 KB (413 beyond), up to 5,000 tasks per project, 100 projects per person, 200 members per project and 1 GB of evidence per project (422 `LIMIT_REACHED` beyond).
- **Spending caps** for paid services, counted in the database so restarts don't reset them: AI requests a day, AI tokens a month, emails a day and a month. At a cap, AI answers say so and emails are skipped and logged, so nothing is charged beyond it.
- **No duplicates:** every create and submit from the app carries an `Idempotency-Key`. A retried request gets the first answer back (`Idempotent-Replayed: true`); one still running gets 409; the same key with a different body gets 422. Submitting work also locks the task, so a double click or two tabs make one submission. (ProjectFlow has no payments or subscriptions, so there were none to protect.)
- **Request ids:** every response has `X-Request-Id`, every log line carries it, and error messages show it as a reference.
- **Browser error reports:** crashes and unhandled errors in the browser are sent to `/api/client-errors` and logged (message and page only, no personal data; rate-limited). The privacy page says so.
- **Offline banner** when the browser loses its connection.
- **Database indexes** (migration V5) for notifications by person and type, tasks and milestones by due date, submissions by status, invitations, sign-in tokens and files.
- **Uptime monitoring:** `.github/workflows/uptime.yml` checks the frontend and the backend's readiness every 15 minutes (set `FRONTEND_URL` and `BACKEND_URL` as repository variables). Railway uses `backend/railway.json` to wait for readiness before switching traffic and to restart on failure.
- **Scripts:** `scripts/load-test.mjs` (simultaneous users, with a race check), `scripts/backup.sh`, `scripts/restore.sh` and `scripts/test-backup-restore.sh` (backs up, restores into a scratch database and compares every table).
- **Tests:** retried creates happen once, ten simultaneous submits make one submission, request ids, oversized bodies, error reports, usage counters, rate limits and quotas.

### Changed
- **Timeouts and retries:** requests from the app time out after 20 s (uploads 2 min, AI 200 s). Reads and keyed writes are retried twice on network errors, 502, 503, 504 and 429 (waiting as long as `Retry-After` asks, up to 10 s). AI requests are never retried.
- **Server timeouts:** 20 s for a slow client, 10 s to get a database connection, 15 s for a query, 30 s for a transaction. Running out of any of these answers 503 "busy, try again" instead of hanging. Shutdown finishes the requests in flight.
- **Faster queries:** notifications are filtered and paged by the database; the projects list loads tasks and member counts only for the page shown; *My work* loads only your tasks. Page sizes are capped (100 for lists, 500 for board tasks).
- **Cache:** project analytics and status history are cached per project and cleared as soon as anything in that project changes.
- **Uploads:** a failed submission deletes the files it uploaded.
- **Error messages** for 429, offline, timeouts, limits and caps say what happened and what to do.

## A working AI assistant, free (2026-09-28)

### Added
- **Ollama, found automatically:** the new default is `AI_PROVIDER=auto`. When a free Ollama model runs on the same computer as the backend, it's used with no keys or settings.
  - It picks a good chat model (llama3.2 first) and skips embedding models, or uses `AI_MODEL`.
  - It looks again every few seconds while nothing's found, so Ollama can start after the backend.
  - It talks to Ollama's own API, with JSON output and an 8,000-token context, so a whole project fits.
- **`scripts/setup-local-ai.sh`:** installs Ollama (Homebrew), starts it, downloads llama3.2 and checks it answers.
- **The AI built into Chrome:** with no server AI, the assistant offers *Turn on AI in this browser*. Chrome downloads Gemini Nano once, then answers run on the device, from the records the page already has.
  - The same rules as the server's AI apply: records marked as data, invented task keys dropped, suggestions checked and confirmed by a person.
  - When a project is too big, the prompt is cut down to fit, or it says the project doesn't fit.
  - It works in the Assistant panel and in the Model page's *Ask about this project*, and in demo mode too.

### Changed
- **Free questions** go to the server's AI, else the AI in Chrome, else the built-in model. Every answer says which one wrote it.
- **"No AI" messages** now say how to turn AI on for free, instead of only naming settings.

## Calm and organised: built-in model, free AI, roles, tidy pop-ups (2026-09-27)

### Added
- **Built-in model:** answers free questions without an AI service. It's trained in the browser, each time you ask, on that project's records:
  - each person's pace against their estimates;
  - a lateness model (logistic regression, with its accuracy measured on tasks it didn't see);
  - a search index over the records.
  Answers say what it learned from and how accurate it was, and are labelled *Built-in model · no AI service*.
- **Free AI providers:** `AI_PROVIDER=openai` works with any OpenAI-compatible service, including Ollama on your computer (no key) and the free tiers of Groq and Gemini. Claude stays available with `anthropic`.
- **"How will you use ProjectFlow?"** on the front page and the sign-up form. It sets the start page and a *Your first steps* card on Today, with steps ticked automatically when the records prove them. In demo mode it signs you in as the sample person with that role. It never grants permissions.
- **Roles guide:** *You: Owner* in every project header opens what each role can do, and what an assignee is. The Team card has *Roles explained*.
- **Pop-up lists:**
  - The Overview's To Do, In Progress, In Review, Done and Overdue counts open their tasks in a pop-up, grouped by person, due date or priority. Every row uses the same columns and the same order.
  - Each board column has a *Show as a grouped list* button that opens the same pop-up.

### Changed
- **Light theme:** cool neutral greys and one blue accent replace the stone-and-bronze palette. Cards have soft corners and a faint lift. Buttons use sentence case. Display type is light rather than extra-light. Dark mode matches, and every text colour still meets WCAG AA. The favicon, app icons and social image were regenerated.
- **Overview:** laid out on a strict grid of six equal cards, each previewing at most four rows with a *View all* bar in the same place, opening the rest in a pop-up.
- **Board messages** name the assignee: *Only Priya Nair, the assignee, can submit this task*.
- **Sign-in** goes to the start page for how you said you'd work (for example, My tasks for "I do the work"), unless a link asked for somewhere else.

## Launch-ready: real accounts, emails, legal pages, SEO and audits (2026-09-27)

### Added
- **Real accounts and email:**
  - sign-up with email confirmation;
  - a sign-in alert on every sign-in;
  - forgot password, and reset password (which signs out everywhere);
  - a "password changed" email;
  - emails sent through Resend's HTTPS API (or written to the log for local testing);
  - a new migration: V4 (confirmed email, accepted terms, session version, emailed-link tokens).
- **Bot protection:** a honeypot field, limits per IP address and per account (sign-in counts only failures), and optional Cloudflare Turnstile.
- **Pages:**
  - privacy policy (`/privacy`) and terms (`/terms`), with an "I agree" box on sign-up;
  - a custom 404, served with a real 404 status;
  - check-email, confirm-email, forgot-password and reset-password pages.
- **Cookie consent and analytics:**
  - a banner with equal yes/no, and *Cookie settings* in the footer and in Settings;
  - Vercel Web Analytics and/or GA4, loaded only after consent, with ids and tokens removed from addresses.
- **SEO:**
  - per-page titles, descriptions, canonical links and social-preview tags, also written into static HTML per public page;
  - `noindex` on signed-in pages;
  - sitemap.xml and robots.txt, generated at build time.
- **Social preview image and favicon set:** a 1200×630 image from a real frame of the 3D model; SVG with a dark-tab variant, ICO, Apple touch and app icons, and a web manifest.
- **Security headers and HTTPS:** a Content-Security-Policy and other security headers, HSTS, and a backend HTTPS redirect (`REQUIRE_HTTPS`).

### Changed
- **One call to action on the front page:** *Create your free account*.
- **Colours:** lightest grey, muted grey, warning amber and the wordmark now meet WCAG AA contrast in both themes.
- **Grids** without explicit columns can shrink, so nothing makes a phone page scroll sideways.
- **Tap targets:** bigger footer links, contents links and model checkboxes.
- **3D exhibits** on public pages load once the browser is idle.
- **Sample evidence links** use the reserved `.example` domain.

### Fixed
- **After sign-up**, new accounts sometimes landed on Today instead of the introduction: two redirects raced. Sign-in and sign-up now make one redirect.

### Security
- **Secrets:**
  - the backend refuses to start with the public default `JWT_SECRET` against a non-local database;
  - `vite build` fails if the bundle contains a secret key, or (with the real backend) the demo data;
  - the build refuses an `http://` API address.
- **Sessions:** tokens carry a session version; a password reset or change ends every other session.
- **Emailed links** are single-use (even when clicked twice at once), stored as SHA-256 hashes, and removed from the address bar once read.
- **Password reset and change** retire every older emailed link and close the account's live-update streams.
- **Confirming an email** doesn't sign in, so an address registered by someone else can't be taken over.
- **Sign-in limits** count only wrong passwords, per address and per account-and-address. There's no account-wide lockout that could be used against someone. IPv6 addresses are limited per /64 network.
- **Passwords over 72 bytes** get a clear message instead of a server error.
- **After a password change in one tab**, other tabs adopt the new session instead of signing the first tab out.
- **Google Analytics**' automatic events carry the redacted address too.
- **Names** are left out of confirmation and reset emails.

## Ready to host (2026-09-26)

### Added
- **Hosting files:**
  - `backend/Dockerfile` (a Java 21 container, running as a non-root user) and `.dockerignore`;
  - `frontend/vercel.json`, so app routes work on refresh;
  - a *Deploy it* section in the README listing every setting.

### Changed
- **Port:** the backend listens on the host's `PORT` when one is set (`SERVER_PORT` still wins).

### Fixed
- **False "backend isn't running" warning on a hosted site:** when the frontend and backend are on different addresses, the sign-in page's health check was blocked by CORS. `/actuator/health` now allows the configured origins.
- **Hosted wording:** the sign-in warning no longer gives local terminal commands when the backend is hosted.

## The assistant, with voice; the graph moves inside the app (2026-09-26)

### Added
- **Assistant:** an *Assistant* button on every signed-in page, plus Alt+A and the ⌘K palette, opens a side panel for the current or chosen project.
- **Predictive analysis:** forecast, risks, recent changes and "what should I work on next" are computed from the records and labelled *no AI*. Other questions go to the AI when a provider is configured, or get an honest "needs AI" reply.
- **Task management by command:** "Create a task … due Friday, high priority, assign it to Rohan" becomes a draft that opens the normal task form, filled in. "Start LIB-8" becomes a confirm button, and "Open LIB-8" or "Show the 3D model" navigate. Everything goes through the usual endpoints and permission checks, and nothing changes without a click.
- **AI suggestions:** AI answers may carry suggested actions (*create task*, *start task*). The server keeps only those two types and only real task keys, and shows them as the same confirm cards (also under *Ask about this project* on the Model page).
- **Voice:** push-to-talk, an optional "Hey ProjectFlow" wake phrase and answers read aloud, using the browser's speech recognition and synthesis.
  - The wake phrase is off by default, remembered per user on this browser, and listens only while the tab is visible.
  - The Assistant button and the panel header show whether it's listening now or paused. If the microphone is blocked or the speech service keeps stopping, it switches off and says why.
  - The panel says where audio goes.
  - Voice can prepare a change but never confirm one.
- **Keyboard and focus:** Alt+A opens the panel, moves into it when it's open, and closes it from inside (when the text box is empty). Focus returns to the Assistant button on close. The conversation is kept while the panel is closed.
- **Overview graph:** a *History and forecast* card on each project's Overview, with the graph and the analysis lines that need attention, linking to the 3D model.

### Changed
- **Front page:** keeps a small 3D preview of the sample project. The history-and-forecast graph, analysis and assistant are inside the app only; the sign-in and introduction exhibits no longer show the graph.
- **Model and Overview pages:** now share one hook for building the model (cached queries).
- **Task form:** can start from a draft (title, description, priority, due date, assignee, estimate).

## Front page, introduction, sign-in, history-and-forecast graph and AI assistant (2026-09-26)

### Added
- **Front page (`/`):**
  - a live exhibit of a fictional sample project, using the same 3D model, camera views, replay, graph and analysis as a real project;
  - three ideas, how work moves, a roles table computed from the permission rules, and everything inside the app.
- **Introduction (`/introduction`):** nine short chapters with a sticky index, including an interactive life of a task, how to read the model and forecast, and what the AI assistant can and can't do. New accounts land here unless an invitation link sent them elsewhere.
- **Sign-in and registration:**
  - redesigned under the public header;
  - on large screens, the sample project (sign-in) or the four-stage sculpture (registration);
  - *Keep me signed in* (off keeps the session in this tab only);
  - a Caps Lock warning;
  - sample accounts, shown in demo mode, or with the backend when `VITE_SHOW_SAMPLE_ACCOUNTS=true`.
- **History and forecast graph:** on every project's Model page, under the 3D model. It shows all tasks and approved tasks day by day, recorded up to today and dashed as an estimate after it. It's synced with the replay (click or drag to scrub), with a table of the numbers.
- **Analysis:** beside the model, computed from records and marked *Recorded* or *Estimate*, with the tone in words as well as colour. It covers:
  - the estimated finish against the deadline;
  - open tasks without an estimate (the forecast assumes 1 day each and says so);
  - overdue work and what it holds up;
  - reviews waiting and rework;
  - open tasks per person, listed alphabetically with no ranking.
- **AI assistant:** *Ask about this project*, backed by `POST /api/projects/{id}/ai/ask`.
  - Any member may ask; the server checks membership before gathering the project's records.
  - The page's scheduler estimate is sent along, filtered to the project's own task keys and labelled as an estimate.
  - Answers cite task keys (invented keys are dropped) and list what the records don't show.
  - With no provider configured it says it's unavailable, in demo mode too.

### Changed
- **AI prompts:** user-written text is escaped so it can't close its `<record>` wrapper.
- **Hourly AI limit:** a request counts once the provider replies, even if the reply is unusable; only transport failures are refunded.
- **Long answers:** trimmed so follow-up questions stay within the history limit.
- **Calendar days in the model:** rounded, so due dates don't shift by a day across daylight-saving changes.
- **Touch scrolling:** 3D views embedded in pages (the sample project, the sculpture, the skyline) leave touch scrolling to the page and don't zoom on the mouse wheel.
- **Sign-in on phones:** the exhibit isn't mounted at all, so no three.js download or WebGL.
- **Camera fitting:** the camera centres the model's projection.

## Fix: backend compile error, and run instructions that survive copy and paste (2026-09-26)

- **Backend didn't compile:** `GlobalExceptionHandler` imported `MissingServletRequestPartException` from `org.springframework.web.bind`; it lives in `org.springframework.web.multipart.support`.
- **Why it slipped through:** earlier compile checks used hand-written stand-ins for the Spring APIs, and they had the same mistake.
- **New checks:**
  - The backend (main and tests) is now compiled against the real source code of every library, at the versions Spring Boot 3.5.16 selects. It reports 0 errors.
  - Repository query method names, JPQL queries and entity column names are checked against the entities and migrations.
  - The frontend is type-checked against the libraries' real types. It reports 0 errors, and every imported lucide icon exists in 0.525.
- **README commands:** the command blocks no longer have `# comments` after commands. The macOS terminal (zsh) passes them to the command as arguments, so `npm install  # first time only` failed with `EINVALIDTAGNAME "#"`, and the dev server then couldn't find `@tailwindcss/vite`. Troubleshooting now covers both errors.
- **Changelog:** entries are back in date order.

## Redesign: a project you can walk around (2026-09-26)

Answers the design review in [docs/DESIGN_REVIEW.md](docs/DESIGN_REVIEW.md); the spec is [docs/REDESIGN.md](docs/REDESIGN.md).

### Added
- **Project Model** (chapter III, `/projects/:id/model`): a three.js model built from the project's records.
  - Layout: time runs left to right, one lane per person, and height is priority. Materials are stone, graphite, amber and bronze (approved). Dependency threads, a glass Today plane, milestone obelisks and the deadline are drawn in.
  - Replay: a scrubber rebuilds any day from the recorded status history; past today, scheduler estimates show as labelled ghosts.
  - Controls: camera presets (Overview, Plan, Elevation, Today), toggles, hover details, and a selection panel that highlights what the task waits on and what it unblocks.
  - Keyboard: full keyboard navigation with screen-reader announcements.
- **Portfolio Skyline** on Today: one tower per project, layered by status, with a red sleeve for overdue work, synchronised with a text list.
- **Flow Sculpture** on sign-in and registration: four stages as an interactive sculpture, with the stage names as real text.
- `GET /api/projects/{id}/history` (members only) and the same route in the demo API: every recorded status change, oldest first (time, then id).
- Project cards show a small **tower glyph** of their tasks instead of a coloured letter tile.
- Tests: the 3D model's geometry and replay logic, history ordering and access (backend and demo API).

### Changed
- **Navigation:** the sidebar and top bar are replaced by a typographic **masthead** with five places, and by a full-screen numbered index on phones. Projects have six numbered **chapters** instead of eleven tabs.
- **Today** (formerly Mission Control): the stat tiles, trend chart, project list and activity feed are gone; it's now the skyline, the decisions list, and up next, proven done and next three weeks. *My tasks* is now *My work* and *Analytics* is now *Reports*.
- **Loading:** pages load on demand; three.js only downloads with a 3D view.
- **Autofill:** autofilled inputs keep the app's colours (fixes the blue-grey fields in the registration screenshot).
- **Timeline:** month names no longer run together, and the Today/Deadline labels have their own row.
- **Demo indicator:** the badge by the wordmark no longer repeats as a live-status "Demo".

### Dependencies
- `three` ~0.186.0 and `@types/three` ~0.186.0. Run `npm install` in `frontend` after updating.

## Diagnostics for a backend that isn't reachable (2026-09-26)

- When Spring Boot isn't running, the Vite dev proxy now answers with the API's error shape (`503 BACKEND_UNAVAILABLE`) and a message saying how to start it, instead of an empty 500 that the app could only report as "The server ran into a problem".
- Sign-in and registration pages check `/actuator/health` in backend mode and show what to do if the backend is down or reports `DOWN` (usually MySQL); the notice clears itself once the backend answers.
- A 5xx without details now points to the backend terminal.
- README: *Troubleshooting* table for the common start-up failures.
- Verification: the backend **tests** now also compile against API stubs (main and test sources, 0 errors).

## Review fixes after Phases 2–6 (2026-09-26)

An independent read-through of Phases 2–6 found the issues below; all are fixed.

- **Plan apply stale check covers the whole basis.** The request now carries every open task's version and every dependency id the scenario used (`basis`); if any task was edited, added, finished or deleted, or a dependency changed, nothing is applied (`409 EDIT_CONFLICT`). Previously only the changed tasks were checked. Mock API matches; tests extended.
- **Plan page:** a rejected apply no longer refetches and silently recalculates the scenario; *Recalculate with the latest data* is the only way to clear the stale state. Fixed a TypeScript narrowing error in the scenario builder that would have failed `tsc -b`. The scenario tile no longer turns grey.
- **Per-project page state** (saved plan scenarios) can no longer carry over between projects when navigating back/forward.
- **Dependencies:** concurrent "A waits on B" and "B waits on A" requests can no longer both pass the loop check (row lock on the project). Deleting a dependency you can't access returns 404, the same as an unknown id.
- **Live updates:** removed members and everyone in a deleted project are now told to drop it; SSE timeouts and disconnects are closed quietly instead of logging errors; per-user ticket cap; member lookups are cached briefly so a large plan apply doesn't query once per event.
- **AI:** the provider call no longer holds a database connection (the prompt is built in a short read-only transaction first); a failed provider call no longer uses up the caller's hourly quota.
- **Timeline:** the *Today* and *Deadline* labels were hidden under the sticky header; they now sit in the header and are in the legend. Copy no longer says there are no estimates.
- **Dependency map:** no longer re-scrolls on every click and background refresh.
- **⌘K palette:** Enter can no longer open a result for the previous search text.
- **Task form:** server errors for the estimate now appear on the estimate field; an invalid estimate on the task page is reset to the saved value.

## Phase 6 — Live updates, accessibility and verification

- **Server-Sent Events** (`GET /api/events/stream`) with one-time tickets (`POST /api/events/ticket`, 60 s) because `EventSource` can't send a bearer token. Events are sent after commit, only to current project members, and carry ids only; clients refetch through the normal authorised endpoints. Automatic reconnect with back-off; demo mode syncs across tabs through storage events.
- Contrast and reduced-motion fixes across the new pages.

## Phase 5 — Event-based analytics and focused AI

- Analytics from recorded events: work in each status over time (from `task_status_events`), review turnaround (median hours to review), rework rate and rounds to approval, median time in each status. Workload is shown alphabetically; people are never ranked.
- **AI assistance (optional, server-side):** review notes per criterion with a draft of feedback, acceptance-criteria suggestions, and a draft project status update. Keys stay on the server; context is limited to records the caller can see; the model is told it cannot open links or files and every answer lists its limits; nothing is saved or applied without a person choosing to. With no provider configured every AI endpoint returns `503 AI_UNAVAILABLE` and the UI says so — no simulated answers. Per-user hourly limit.

## Phase 4 — Estimates and the what-if planner

- Optional estimates in working days on tasks (`V3__task_estimates.sql`), always labelled as estimates.
- **Plan** tab: a deterministic scheduler (working days, dependencies, one task at a time per person) projects finish dates. Build a scenario — reassign, re-estimate, add time off — compare it with the current projection, then apply the resulting changes in one transaction (owners/managers). People whose dates move are notified with the reason.

## Phases 2–3 — Mission Control, search, calendar agenda, dependencies, map, timeline

- **Mission Control** dashboard: "what needs attention", each item with the rule that raised it and the records behind it (reviews waiting, changes requested, overdue, due soon and not started, own work awaiting review, project and milestone risk, workload, unassigned work due soon, blocked and blocking tasks); recently approved work with its evidence.
- **⌘K / Ctrl K command palette:** pages, commands and server-side search over the projects and tasks you can access (`GET /api/search`).
- **Calendar agenda view** with *Hide completed*.
- **Dependencies** (`V2__task_dependencies.sql`): finish-to-start, same project only, loops rejected with the chain that would close them; blocked/blocking shown on cards, task pages and Mission Control. Demo data includes overdue blockers (CCP-10, MBA-4).
- **Map** tab: interactive dependency graph (layered, keyboard-focusable, upstream/downstream highlighting) plus an equivalent list view. It shows the longest chain of open tasks counted in tasks and explicitly doesn't call it a critical path.
- **Timeline** tab: tasks grouped by milestone on a date axis with a Today rule and the project deadline, drawn from recorded dates only.

## Phase 1 — Backend, persistence, permissions and the review workflow (2026-09-26)

### Added — backend (`backend/`, new)
- Spring Boot 3.5.16 / Java 21 application with Flyway (`V1__initial_schema.sql`) on MySQL 8.4, `docker-compose.yml` for local MySQL, `.env.example` without secrets, Maven Wrapper.
- Stateless JWT auth (jjwt 0.12.7, BCrypt), consistent `{success, message, data, timestamp}` envelope and `{success:false, status, code, …}` errors.
- Per-project roles enforced on the server: `@PreAuthorize("@projectAccess…")` on every project/task route, then role rules in services (`Permissions`).
- Every endpoint the frontend uses: auth, profile, dashboard, calendar, projects, members, invitations, milestones, tasks (list/filter/sort/paginate, board moves with fractional ordering), comments, notifications, activity, analytics.
- **Acceptance criteria and checklists** on tasks; criteria are snapshotted into each submission.
- **Evidence-based submissions**: typed evidence (repository, deployment, link, screenshot, file), multipart upload to local storage, member-only download at `GET /api/files/{id}` (`nosniff`, inline only for safe image types).
- **Criteria-based review**: approval requires every criterion marked met; changes requested requires feedback; nobody reviews their own work; In Review/Done are unreachable by drag or direct status calls; all versions and reviews are kept.
- Optimistic locking (`@Version` + client version) → `409 EDIT_CONFLICT`.
- `task_status_events` history used for cycle time; first-time approval rate.
- Demo data seeder (empty database only) with overdue work, review revisions (CCP-5, CCP-13, MBA-3), workload imbalance and completed milestones.
- MockMvc integration tests on H2 (MySQL mode): role boundaries, approval bypass, submission preconditions, full request-changes → resubmit → approve cycle, own-review block, evidence access, edit conflicts.
- Swagger UI at `/swagger-ui.html`.

### Added — frontend
- **Review workspace** (`/projects/:id/tasks/:taskId/review`): evidence on the left, per-criterion Met/Not met verdicts and feedback on the right, version switcher, "what was asked in the previous version".
- **Definition of done** card on tasks: editable acceptance criteria and checklist, locked in review/done.
- Submit dialog rebuilt around evidence: repository and deployment fields, extra links, screenshots with previews, checklist blockers you can tick in place, the criteria the reviewer will check.
- Authorised file previews/downloads (token-bearing fetch → object URL).
- Acceptance criteria on task creation (one per line).
- `EDIT_CONFLICT` handling with a reload action.

### Changed
- Frontend dev server moved to **port 5174**; backend mode calls same-origin `/api` through a Vite proxy to `localhost:8080`.
- API contract: `Submission.links/attachments` replaced by `criteria` + typed `evidence`; `Review.results`; `Task.acceptanceCriteria/checklist/version/startedAt`; `ProjectDetail.version`; new activity types and `EDIT_CONFLICT`.
- Board drops that mean "review" now open the review workspace instead of a dialog (the old `ReviewDialog` was removed).
- Analytics: cycle time measured from first start (not creation) to approval; "first-time approval" is the share of reviewed tasks approved on their first submission.
- Demo (mock) API brought to parity with the backend; stored schema bumped to v3 (older browser data is reseeded).
- Visual direction changed to a "gallery" catalogue look: stone canvas, square white panels, thin display type, tracked capitals for navigation and buttons, a single bronze accent.

### Verification
- Ran: TypeScript syntax parse of all frontend sources (0 errors).
- Not run (no registry access in the build sandbox): `./mvnw verify`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and the manual demo flow. See README → *Verify locally*.

## Phase 0 — Frontend with in-browser mock API

- Complete React frontend (projects, board, list, task detail, comments, notifications, milestones, calendar, analytics) running against an in-browser mock API.
