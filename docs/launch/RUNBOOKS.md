# Runbooks

What to do when something goes wrong in production, and the controls for doing it. Practise each
one on staging before launch and note the date in the launch register (RECOVERY-10, TRAFFIC-14).

The operator controls need an account listed in `OPERATOR_EMAILS`. They're in Site health in the
app, or on the API with that account's token (`TOKEN` below):

```bash
API=https://api.example.com/api
H="Authorization: Bearer $TOKEN"
```

## Emergency switches

Each switch turns one feature off for everyone within 5 seconds and leaves the rest of Niveloft
working. Every change is recorded in the audit log.

| Switch | Turns off |
| --- | --- |
| `ai` | Flurry and every AI feature (the app shows an honest unavailable state) |
| `voice` | The natural voice (the browser's own voice still reads answers) |
| `uploads` | Uploading files |
| `exports` | Account copies and project task-history exports |
| `signups` | Creating accounts |
| `invitations` | Inviting people to projects |
| `forecast-model` | The forecast model trial on the Delivery page (Niveloft's own forecast is unaffected; nothing more is recorded or shown until it's back on) |

```bash
curl -X PUT "$API/ops/switches/ai" -H "$H" -H 'Content-Type: application/json' \
  -d '{"enabled": false, "reason": "token spend spike, investigating"}'
curl "$API/ops/switches" -H "$H"        # see them all
```

Turn a switch back on with `"enabled": true` once the cause is fixed, and say so where you
announced the outage.

## Stopping abuse

- **One account**: suspend it. It's signed out everywhere and can't sign in until unsuspended.
  ```bash
  curl -X POST "$API/ops/accounts/suspend" -H "$H" -H 'Content-Type: application/json' \
    -d '{"email": "someone@example.com", "reason": "abuse report 42"}'
  curl -X POST "$API/ops/accounts/unsuspend" -H "$H" -H 'Content-Type: application/json' -d '{"email": "someone@example.com"}'
  ```
- **Accounts left from the retired demo data** (`…@projectflow.dev`, whose password was published)
  are suspended automatically when a production server starts; each shows in the audit log as
  `ops.account_suspended` with the reason, and the server log names them. Nothing else is needed.
- **Sign-up spam**: turn on Turnstile (`TURNSTILE_SECRET_KEY` and `VITE_TURNSTILE_SITE_KEY`), or the
  `signups` switch.
- **Invitation floods**: the `invitations` switch; then suspend the sender.
- **Expensive traffic**: lower `API_REQUESTS_PER_MINUTE` and the AI caps, restart; turn on the
  host's firewall or rate rules in front of the API.
- **Someone locked out by a rate limit** (after mistyping a password, say): limits clear themselves,
  15 minutes after wrong passwords and an hour after sign-ups and emailed links. To clear one
  sooner, delete its counter. Counters are shared by every instance and stored under a hash of the
  key, never the address itself, so hash the key the same way:
  ```sql
  DELETE FROM rate_limit_windows
   WHERE bucket_key = LEFT(SHA2(LOWER('login-fail:203.0.113.9|ann@example.org'), 256), 40);
  ```
  Keys are the limit's name, a colon, and what it counts: `login-fail:ADDRESS|EMAIL` and
  `login-fail-ip:ADDRESS` for wrong passwords, `register-ip:ADDRESS`, `link-ip:ADDRESS`,
  `api:u:ACCOUNT_ID`, `api:ip:ADDRESS`, `ai-hour:ACCOUNT_ID`. (IPv6 addresses count per /64 network.)
- **"Rate limits couldn't use the database" in the log**: that instance is counting limits in its own
  memory until the database answers again, so limits are per instance meanwhile. Check the
  database's health and connections (`DB_POOL_SIZE` + `RATE_LIMIT_DB_POOL` per instance).

## A leaked key or token

1. **Rotate first.** Removing a key from code or history doesn't revoke it.
   - AI, ElevenLabs, Resend, Turnstile, database: create a new key at the provider, set it on the
     host, restart, then revoke the old one.
   - Sign-in key (`JWT_SECRET`): set the new value as `JWT_SECRET` and the old one as
     `JWT_PREVIOUS_SECRET`, restart. Existing sign-ins keep working. If the old key leaked, don't keep
     it: leave `JWT_PREVIOUS_SECRET` empty and sign everyone out (below). Otherwise remove it after a
     day (`JWT_EXPIRATION_SECONDS`): kept sign-ins get a token signed with the new key from their
     cookie by then.
2. **Sign everyone out** (your own sessions stay):
   ```bash
   curl -X POST "$API/ops/sessions/end-all" -H "$H" -H 'Content-Type: application/json' -d '{"reason": "JWT key rotation after leak"}'
   ```
3. Check the audit log for what the key was used for: `curl "$API/ops/audit?limit=500" -H "$H"`.
4. Run `node scripts/secret-scan.mjs --history` and fix where it leaked from.

## Incidents

**Roles**: an incident lead (decides, coordinates), an operator (runs the controls), a
communicator (customers and authorities), and a scribe (times and actions). One person can hold
several roles in a small team. Name them before launch: ____________________.

**Severity**:
- *Critical*: data exposed to the wrong people, accounts taken over, data lost, or the service down.
- *High*: a main feature broken for many people, or spending out of control.
- *Normal*: a feature degraded or broken for a few people.

**Steps**: contain (switches, suspend, sign everyone out, roll back) → preserve evidence (export the
audit log and host logs before they rotate) → investigate (request ids link logs and audit records)
→ recover → tell people → write down what happened and what changes.

**Who to tell, and when** (have a lawyer confirm these for your entity before launch):
- **CERT-In** (India): report specified cyber incidents within **6 hours** of noticing them, to
  incident@cert-in.org.in, using CERT-In's form. Keep logs for 180 days in India and keep clocks in
  sync with NTP.
- **Data Protection Board of India and the affected people** (DPDP Act, 2023 and the DPDP Rules):
  the Rules ask for notice to affected people and an initial report to the Board without delay, and
  a detailed report within 72 hours. Check which obligations have commenced for you.
- **Customers**: the status page and an email to affected owners.
- **Providers**: the AI, email or hosting provider if their systems are involved.

## Rolling back

**The application** (most incidents): redeploy the previous build. Migrations only ever add
(`scripts/check-migrations.mjs` enforces it in CI), so the previous release runs against the newer
schema. No database restore is needed.

**A forecast model on trial** (its forecasts look wrong, or it slows the Delivery page): switch off
`forecast-model` (above), or remove `FORECAST_MODEL_FILE` and restart. The app never used it
instead of its own forecast, so nothing else changes; its recorded rows stay for the post-mortem.

**Data** (only when data was damaged): restore a backup (below). This loses changes made after the
backup, so it's a separate decision, made by the incident lead.

**Triggers to roll back or pause** (OPERATE-09): a security gate fails (data visible to the wrong
people, a bypass of approvals or roles), errors above 1% of requests for 10 minutes, p95 latency
twice the gate for 15 minutes, data loss, or spending growing faster than planned.

**Changing the schema safely** (expand and contract): add the new column or table (nullable or with
a default) and ship code that writes both; backfill; ship code that reads the new one; only in a
later release remove the old one, in a migration marked `-- reviewed-destructive: <why>`.

## Backups and restoring

- `scripts/backup.sh` dumps the database and archives `STORAGE_DIR`; schedule it daily (or use the
  provider's backups) and keep copies in a separate account, encrypted.
- Proposed for the pilot: **RPO 24 hours, RTO 4 hours** (confirm with the owner).
- **Drill** before accepting customer data, then quarterly:
  `scripts/test-backup-restore.sh` restores into a scratch database and compares row counts; also
  check a few files open, a project's owner and roles, and a private task stays private. Write down
  how long it took.
- **After restoring**, re-apply deletions made since the backup: the audit log lists them
  (`account.deleted`, `project.deleted`). Delete those accounts again (with the same rules) and those
  projects, so a restore never brings back data someone asked to remove.
- **One project only**: restore into a scratch database and copy that project's rows across; never
  restore the shared database over the live one for one customer.

## Access

Turn on multi-factor sign-in, and keep a list of who has access, for: GitHub, Vercel, the API host,
the database provider, the domain registrar and DNS, Resend, Cloudflare, the AI and voice
providers. Review the list every quarter and remove anyone who no longer needs it. Staff don't read
customers' projects; if support ever needs to, agree who approves it, for how long, and record it.

## Reporting vulnerabilities

`/.well-known/security.txt` lists the contact (`VITE_SECURITY_CONTACT`). Acknowledge reports within
2 working days, fix critical issues first, tell the reporter when it's fixed, and record each report
and fix.
