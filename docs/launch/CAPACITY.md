# Capacity

How much traffic to plan for, how to test it, and what has been measured so far.

## Sizing the traffic

Average requests per second = active users × requests per minute per user ÷ 60.

| | Value |
| --- | --- |
| People active at the busiest time | ______ |
| Requests a minute while someone works (the app makes about 6–12) | ______ |
| Average requests per second | ______ |
| Peak (busiest 5 minutes, usually 3–5× average) | ______ |
| Where the users are | ______ |
| Busiest periods | ______ |

Don't publish a supported number of users from home-page traffic or daily visitors; publish only
what the profiles below have shown.

## Load-test profiles and gates

`scripts/load-test.mjs` runs simultaneous signed-in users through board reads, analytics, the
dashboard, task reads and (with `--writes`) comment writes, with `--race` checking that 20
identical requests create one comment. Run it against **staging**, never production, signed in as
test accounts you created there (`--email a@x,b@y` and `LOAD_TEST_PASSWORD`; each needs an active
project), and keep each run's JSON (`--out`).

With `API`, `EMAILS` (the test accounts, comma-separated) and `LOAD_TEST_PASSWORD` set in the shell; the other rows add the same `--api` and `--email`.

| Profile | Shape | Command |
| --- | --- | --- |
| Smoke | 2 users, 1 minute: every journey completes | `node scripts/load-test.mjs --api $API --email $EMAILS --profile smoke --writes --race` |
| Peak | your peak users for 15 minutes | `--profile peak --users 50 --writes --active-users 200 --rpm-per-user 8` |
| Reserve | 3× peak for 30 minutes | `--profile reserve --users 50 --writes` |
| Spike | 10× peak, all within 10 seconds, for 3 minutes | `--profile spike --users 50` |
| Soak | peak for several hours | `--profile soak --users 50 --hours 4 --writes` |

Gates (from the checklist): **reads p95 under 500 ms**, **writes p95 under 1 s**, **unexpected
failures under 1%** (5xx, timeouts, lost connections). 429s are reported separately: they're the
rate limits working. To measure raw capacity rather than the limits, run staging with
`API_REQUESTS_PER_MINUTE=0 API_WRITES_PER_MINUTE=0`.

While a profile runs, watch database connections, slow queries, lock waits and CPU. Find the break
point by raising `--users` until a gate fails, and record it.

**What ran here**: the smoke profile against a local stand-in API (not Niveloft), to check the script
itself: 412 requests, every gate computed, the race check passed. No capacity has been measured on
the real API yet.

## Instances and limits

- Run **one API instance** at launch (scale it up, not out), because of live updates: each instance
  keeps its own list of open streams, so with two, people on one don't see changes made through the
  other until they reload. Limits are no longer a reason: rate limits (requests, changes, uploads,
  sign-in, sign-up, emailed links, Flurry's and the voice's hourly limits) are counted in the
  database in production (`RATE_LIMIT_STORE=auto`), as AI and email spending already were. Each
  instance warns in its log if it has to count in memory because the database is unreachable.
- Database connections: (`DB_POOL_SIZE` (10) + `RATE_LIMIT_DB_POOL` (3)) × instances must stay
  under the database's limit, with room for migrations and backups.
- Live updates: at most 8 streams per person and `LIVE_MAX_STREAMS` (5,000) per instance; the host's
  proxy must allow long-lived responses.
- Flurry: at most `AI_MAX_CONCURRENT` (8) questions at once per instance; more get "busy".

## What limits traffic first

How many people one instance serves hasn't been measured on the real API yet: run the profiles
above on staging, and publish only what they show. These are the ceilings it's configured with,
and what happens beyond each:

| What | Ceiling (default) | Setting | Beyond it |
| --- | --- | --- | --- |
| Requests handled at once | 200 per instance | `SERVER_THREADS` | Further requests queue for a thread |
| Database connections | 10, plus 3 for the rate-limit counters, per instance | `DB_POOL_SIZE`, `RATE_LIMIT_DB_POOL` | A request waits up to 10 s for one, then gets "server busy" (503) and the app retries |
| Live-update streams | 5,000 per instance, 8 per person | `LIVE_MAX_STREAMS` | A new tab's stream is refused and retried later; until then that tab shows changes when it next loads data |
| Flurry questions at once | 8 per instance | `AI_MAX_CONCURRENT` | Flurry says it's answering as many questions as the server allows; try again in a few seconds |
| AI | 1,000 requests a day, 5 million tokens a month, 30 questions a person an hour | `AI_MAX_*` | Flurry says the budget is used up and uses the AI in Chrome or the built-in model |
| Email | 100 a day, 3,000 a month (Resend's free tier) | `EMAIL_MAX_PER_DAY`, `EMAIL_MAX_PER_MONTH` | Not sent. Sign-in alerts stop at 80% so confirmations and resets keep the rest |
| Server voice | 20,000 characters a day | `VOICE_MAX_CHARACTERS_PER_DAY` | The browser's own voice reads answers |
| Per person | 300 requests and 60 changes a minute, 60 uploads an hour | `API_*` | 429 with Retry-After; the app waits and retries |

On the free email plan, the email budget is what a launch meets first: every sign-in sends an
alert, and 100 sign-ins in a day would leave nothing for new people's confirmation emails. Alerts
now stop at 80 so the rest is kept, but raise `EMAIL_MAX_PER_DAY` (and the Resend plan) before you
expect more than that. After it come the AI budget (if Flurry is popular) and the host's plan
(Vercel's Hobby plan is for non-commercial use only). Scale the one API instance up (CPU, memory,
`DB_POOL_SIZE` and `SERVER_THREADS` together, within the database's connection limit) rather than
out, until live updates go through a shared broker.

## Provider limits to record

| Provider | Plan | Limits that matter | Spend alert | What happens at the limit |
| --- | --- | --- | --- | --- |
| Vercel | (Hobby is non-commercial only) | bandwidth, functions | | |
| API host | | CPU, memory, instances, volume size | | |
| MySQL | | connections, storage, IOPS, backups | | |
| Resend | | 100/day and 3,000/month on the free tier | | the app's EMAIL_MAX caps |
| AI provider | | requests and tokens per minute and month | | the app's AI caps and the `ai` switch |
| ElevenLabs | | characters a month | | VOICE_MAX_CHARACTERS_PER_DAY |

## Front-end performance (lab)

Measured in the sandbox on 21 October 2026: the build with the tests' in-browser API, served
locally, Chromium, median of 3 loads, this release and the previous one built and measured back to
back, twice each, on the same machine. The sandbox builds with its own bundler, not the Vite
production build, so measure again on the release.

| Page | Desktop LCP | Desktop CLS | Phone LCP (4× CPU, slow 4G) | Phone CLS |
| --- | ---: | ---: | ---: | ---: |
| Home, this release | 1.10 s, 1.40 s | 0.001 | 6.0 s, 5.5 s | 0.000 |
| Home, previous release | 1.07 s, 1.05 s | 0.001 | 5.7 s, 5.6 s | 0.000 |
| Sign in, this release | 0.74 s, 0.71 s | 0.002 | 5.1 s, 4.9 s | 0.021 |
| Sign in, previous release | 0.73 s, 0.71 s | 0.002 | 4.8 s, 4.8 s | 0.021 |

The two releases are within a few tenths of a second of each other, about as far apart as the same
build measured twice. The previous release measured slower today than it did on 19 October (home
5.0 s and sign-in 4.4 s on the phone profile then), so the sandbox was slower today, not the pages. The tests' in-browser API is itself a large file the build loads on the first request,
and it grew with this release; production builds don't include it.

Targets at p75: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1. The sign-in page's layout shift on the phone,
0.27 on 14 October (the sample accounts the demo added once the app loaded), is 0.02 now that they're
gone, within the target. On the emulated phone both pages still miss the LCP target: the first paint
waits for the JavaScript, and prerendering the public pages would fix that. INP needs real
interactions to measure. After launch, collect field data (Vercel Speed Insights or the web-vitals
library) and use those numbers.
