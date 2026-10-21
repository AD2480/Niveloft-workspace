# Going to production

This folder takes Niveloft to a product people rely on. It works through the
production launch checklist of 14 October 2026 (341 checks across 27 areas):

- [LAUNCH_READINESS.md](LAUNCH_READINESS.md): where every check stands, with evidence, what's left
  and the next step. It's generated from [register.json](register.json); [checklist.json](checklist.json)
  holds the checklist itself.
- [RUNBOOKS.md](RUNBOOKS.md): emergency controls, incidents, rollback, restoring backups, rotating keys,
  and who to notify.
- [CAPACITY.md](CAPACITY.md): sizing the expected traffic, the load-test profiles and gates, lab
  performance numbers, and the provider limits to record.

Keep the register up to date: change a check's record in `register.json` (status, owner, evidence,
risk, next, tested, retest), run `node scripts/launch-register.mjs --write`, and commit both. CI
runs `--check` on every change.

## What this release added for production

**Refusing unsafe settings.** With `APP_ENV=production` (or `auto` and a database that isn't on the
same machine) the API won't start with the public development key, `*`/localhost/http
origins, an http `APP_URL`, `REQUIRE_HTTPS=false`, public API docs, an unencrypted database
connection, `EMAIL_PROVIDER=log`, no operator, AI without spending caps, or uploads in a container's
own folder. It lists every problem at once, and it suspends any account left from the retired demo
data (`…@projectflow.dev`, whose password was published). A production frontend build always uses
the real API: it needs `VITE_API_BASE_URL`, refuses `http://`, the tests' in-browser API
(`VITE_TEST_API`) and the retired demo (`VITE_USE_MOCK_API=true`), and leaves the tests' stand-in and
its sample password out of the bundle. See `backend/.env.production.example`.

**Sessions you can end.** Every sign-in is a session on the server, checked on each request:
signing out ends it everywhere the token was copied; Settings lists your sessions and ends any of
them; "sign out everywhere", password changes and resets, suspension and account deletion end them
all. Sessions end after 12 hours unused and at most 24 hours, or 14 days with "keep me signed in"
(off unless ticked). Tokens carry an issuer, audience and session id; the signing key can be
rotated without signing everyone out.

**Keep me signed in, without a long-lived token in the page.** A sign-in token lives only in the
tab (sessionStorage) and lasts a day at most. A kept sign-in is an HttpOnly cookie set by the API
(`__Secure-niveloft-session`: Secure, `Path=/api/auth`, `SameSite=None` and `Partitioned` over
HTTPS so it works with the API on another site, 14 days or until the session ends). It holds the
session's id and a random 256-bit secret, of which the database keeps only the SHA-256. All it can do
is get a new token for its own session (`POST /api/auth/refresh`, only from the app's origin,
rate-limited), so a tab opened later, or one whose token expired, carries on without the password,
and signing out, signing out everywhere, a password change or reset, suspension and deletion end it
with the session. Signing out in one tab signs the browser out: its kept sign-in ends too, and the
account's other tabs sign out at once. Tokens that an earlier release kept in localStorage are moved
into the tab on first load.

**Rate limits shared by every instance.** Every rate limit (requests, changes, uploads, sign-in,
sign-up, emailed links, Flurry's and the voice's hourly limits) is counted in the database in
production (`RATE_LIMIT_STORE=auto`): a sliding-window counter per key, updated with one atomic
conditional statement on a small connection pool of its own, with keys stored as hashes, never
addresses. If the database is unreachable, each instance counts in memory until it's back, and
logs that it did.

**Your data, your account.** Settings → Data and privacy downloads a JSON copy of everything held
about you and deletes your account (password and the word DELETE). An account that owns a project
with other people must hand it over first: owners can now transfer ownership, and the previous
owner stays on as a manager.

**Invitations that can't be reused.** They expire after 14 days, need a confirmed address to accept
when email is on, and work only while the sender may still grant that role. Removing someone
revokes their pending invitations.

**Passwords.** Common passwords, look-alikes (P@ssw0rd2024) and your own email name are refused;
passphrases are encouraged. Optional breach check against Have I Been Pwned without sending the
password (`PASSWORD_BREACH_CHECK=hibp`).

**Uploads.** An allowlist of extensions; the stored type comes from the extension, never the
browser; images, PDFs and Office files must start like what they claim to be; optional virus
scanning with ClamAV before anything is stored. Deleting a task now deletes its evidence files.

**An audit log.** Sign-ins, password changes, sessions ended, invitations, role changes, ownership,
exports, account deletion, operator actions and every Flurry request (never its text), with the
outcome. Owners and managers see their project's log in its settings; operators see everything.
Kept at least 180 days.

**Spending that can't run away.** Flurry reserves its share of the server's daily requests, the
project's daily requests and the month's tokens before calling a provider, atomically in the
database (so several servers share one budget), settles the real use afterwards, and refuses when
the budget can't be read. At most 8 questions are answered at once.

**Emergency switches.** Operators can turn off AI, the natural voice, uploads, exports, sign-ups or
invitations in Site health without a deploy, suspend an account, or sign everyone out.

**Release tooling.** A CI workflow (tests, type check, lint, build, dependency audit, secret scan,
migration rules, this register), Dependabot, `scripts/secret-scan.mjs`,
`scripts/check-migrations.mjs` (released migrations can't change; new ones must be additive), and
load-test profiles with the checklist's gates.

## Decisions to confirm

- **Where sign-in tokens live (SESSION-02), decided:** bearer tokens in the tab only (a day at
  most), and "keep me signed in" as an HttpOnly cookie that can only renew its own session (above).
  What remains exposed to a script injected into the page: it could use, or read, the open tab's
  token (a day at most, ended by signing out), and renew it while it runs; it can't read the cookie
  or take a long-lived token away. The Content-Security-Policy allows scripts from this site only,
  React escapes everything it shows, and no raw HTML is rendered. To confirm: where the API lives.
  With it on another site, Safari (and browsers blocking all cross-site cookies) may drop the cookie,
  so kept sign-ins there last as long as the tab; serving the API from the app's own site avoids
  that (then set `SESSION_COOKIE_SAMESITE=lax`).
- **One API instance at launch (OPERATE-01).** Rate limits and spending counters are shared through
  the database now (TRAFFIC-05), but live updates go through each instance's own list of open
  streams: with two instances, people on one don't see changes made through the other until they
  reload. Scale the one instance up, not out, until live updates go through a shared broker.
- **Ages (PRIVACY-12).** Sign-up now asks people to confirm they're 18 or older, and the policy says
  so, because India's DPDP rules require verifiable parental consent for under-18s.
- **Password hashing (AUTH-03).** BCrypt at Spring's default cost of 10. Raise it to 12 or move to
  Argon2id after measuring sign-in time on the production host.

## Inventory

| Part | What it is | Data it holds |
| --- | --- | --- |
| Frontend | React app on Vercel (static files) | Nothing on the server; the tab keeps the sign-in token, the browser keeps preferences and, for kept sign-ins, the API's HttpOnly cookie |
| API | Spring Boot 3.5 on Java 21 (a container host) | Everything below, through MySQL |
| Database | MySQL 8.4 | Accounts, sessions, projects, tasks, comments, submissions, reviews, notifications, activity, audit log, spending counters, switches |
| Uploads | Files on a persistent volume (STORAGE_DIR) | Submission evidence |
| Email | Resend (optional) | Messages sent: confirm, reset, alerts, invitations |
| Bot check | Cloudflare Turnstile (optional) | Sign-up and link forms |
| AI | One provider: OpenAI-compatible, Anthropic or Ollama (optional) | The asking member's project records, per question |
| Voice | ElevenLabs (optional) | The text of an answer being read aloud |
| Virus scan | ClamAV clamd (optional) | Uploaded files, scanned before they're stored |
| Breach check | Have I Been Pwned range API (optional) | The first 5 characters of a password's SHA-1 |
| Analytics | Vercel Web Analytics or GA4, only with consent | Page views |
| Uptime | GitHub Actions (.github/workflows/uptime.yml) | Nothing |

Routes: every API route is under `/api` (see the controllers in `backend/src/main/java/dev/projectflow`),
plus `/actuator/health` and, outside production, the API docs at `/swagger-ui.html`.

## Supported (fill in before launch)

| | |
| --- | --- |
| Team size per project | up to 200 members (MAX_MEMBERS_PER_PROJECT), 5,000 tasks |
| Regions | |
| Browsers | |
| Mobile | |
| Owner of each part above | |
