#!/usr/bin/env node
// The launch evidence register: docs/launch/register.json holds one record per check of the
// production launch checklist (docs/launch/checklist.json, 341 checks). This script checks that
// the register is complete and well-formed, and writes docs/launch/LAUNCH_READINESS.md from it.
//
//   node scripts/launch-register.mjs --check    # CI: every check present once, statuses valid
//   node scripts/launch-register.mjs --write    # also regenerate LAUNCH_READINESS.md
//
// Update a check by editing its record in register.json (status, owner, evidence, risk, next,
// tested, retest), then run --write and commit both files.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = path.join(root, 'docs/launch');
const checklist = JSON.parse(fs.readFileSync(path.join(dir, 'checklist.json'), 'utf8'));
const register = JSON.parse(fs.readFileSync(path.join(dir, 'register.json'), 'utf8'));
const STATUSES = ['PASS', 'FAIL', 'UNVERIFIED', 'N/A'];

const problems = [];
const items = checklist.items;
const byId = new Map(register.checks.map((c) => [c.id, c]));
const seen = new Set();
for (const c of register.checks) {
  if (seen.has(c.id)) problems.push(`${c.id}: listed twice`);
  seen.add(c.id);
  if (!items.some((i) => i.id === c.id)) problems.push(`${c.id}: not a check in the checklist`);
  if (!STATUSES.includes(c.status)) problems.push(`${c.id}: status must be one of ${STATUSES.join(', ')}`);
  if (c.status === 'PASS' && !c.evidence?.trim()) problems.push(`${c.id}: PASS needs evidence`);
  if (c.status === 'N/A' && !c.evidence?.trim()) problems.push(`${c.id}: N/A needs the reason the capability or risk is absent`);
  if ((c.status === 'FAIL' || c.status === 'UNVERIFIED') && !(c.next?.trim() || c.risk?.trim())) problems.push(`${c.id}: say what remains (risk) or what to do next`);
}
for (const i of items) if (!byId.has(i.id)) problems.push(`${i.id}: missing from the register`);

const count = (list) => Object.fromEntries(STATUSES.map((s) => [s, list.filter((c) => c.status === s).length]));
const total = count(register.checks);
const owners = register.checks.filter((c) => c.status !== 'N/A' && !c.owner?.trim()).length;

if (problems.length) {
  console.log(`Register problems (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`${register.checks.length} checks: ${STATUSES.map((s) => `${total[s]} ${s}`).join(', ')}. ${owners} still need an owner before sign-off.`);

if (!process.argv.includes('--write')) process.exit(0);

// ---------------------------------------------------------------------------------- the report
const area = (id) => id.replace(/-\d+$/, '');
const gateOf = (id) => Object.entries(register.gates).find(([, g]) => g.areas.includes(area(id)))?.[0] ?? '?';
const esc = (s) => (s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const label = (s) => (s === 'PASS' ? 'PASS (code)' : s);
const text = new Map(items.map((i) => [i.id, i.text]));

const BLOCKERS = [
  ['Data leak', ['ACCESS-02', 'ACCESS-04', 'ACCESS-05', 'FILES-01', 'AI-DATA-05', 'LIVE-01', 'VERIFY-07']],
  ['Unauthorized administration', ['ACCESS-13', 'SESSION-05', 'AUTH-07', 'PRODUCT-09']],
  ['Critical saving or payment failure', ['PRODUCT-05', 'DATA-01', 'DATA-05', 'BILLING-02']],
  ['Uncontrolled AI spending', ['FLURRY-12', 'COST-06', 'COST-07', 'COST-08']],
  ['Untested backup', ['RECOVERY-05', 'RECOVERY-06']],
  ['Unsafe migration rollback', ['RELEASE-10', 'RELEASE-11', 'RELEASE-12', 'DATA-12']],
  ['Unmeasured capacity', ['TRAFFIC-01', 'LOAD-05', 'LOAD-06']],
];

const lines = [];
const out = (s = '') => lines.push(s);
out('# Launch readiness');
out();
out(`*Generated from [register.json](register.json) by \`node scripts/launch-register.mjs --write\`. Edit the register, not this file.*`);
out();
out(`The production launch checklist (${items.length} checks across 27 areas, [checklist.json](checklist.json)) applied to this release candidate (${register.candidate.date}). Where it was checked: ${register.candidate.environment}.`);
out();
out('**This is not a launch approval.** Under the checklist, a check passes only when it is verified on the intended release with evidence and a named owner. No check here has an owner yet, and none was verified on a deployed environment, so the release can\'t be signed off from this page. What it gives is an honest starting point: what the code now does, what ran, and the next step for every check.');
out();
out('## What the statuses mean here');
out();
for (const s of STATUSES) out(`- **${label(s)}**: ${register.statusMeaning[s]}`);
out();
out('## Summary');
out();
out(`| | ${STATUSES.map(label).join(' | ')} | Total |`);
out(`| --- | ${STATUSES.map(() => '---:').join(' | ')} | ---: |`);
out(`| All checks | ${STATUSES.map((s) => total[s]).join(' | ')} | ${register.checks.length} |`);
for (const [g, def] of Object.entries(register.gates)) {
  const list = register.checks.filter((c) => gateOf(c.id) === g);
  const n = count(list);
  out(`| ${g} ${def.name} | ${STATUSES.map((s) => n[s]).join(' | ')} | ${list.length} |`);
}
out();
{
  // Worked out from the register, so it can't go stale: a gate is met only when every check is N/A,
  // or PASS with an owner and a date it was tested on the release.
  const gates = Object.keys(register.gates);
  const inGate = (g) => register.checks.filter((c) => gateOf(c.id) === g);
  const named = (list) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);
  const met = gates.filter((g) => inGate(g).every((c) => c.status === 'N/A' || (c.status === 'PASS' && c.owner && c.tested)));
  const open = gates.filter((g) => inGate(g).some((c) => c.status === 'UNVERIFIED'));
  const failing = gates.filter((g) => inGate(g).some((c) => c.status === 'FAIL'));
  const why = [
    open.length === gates.length ? 'each still has UNVERIFIED checks' : open.length ? `${named(open)} still ${open.length === 1 ? 'has' : 'have'} UNVERIFIED checks` : '',
    failing.length ? `${named(failing)} ${failing.length === 1 ? 'has' : 'have'} FAILs` : '',
  ].filter(Boolean);
  out(`A gate is met when every one of its checks is PASS on the release or N/A with a reason. ${met.length
    ? `**Met: ${named(met)}.**${met.length < gates.length ? ` Not yet met: ${named(gates.filter((g) => !met.includes(g)))}${why.length ? ` (${why.join(', and ')})` : ''}.` : ''}`
    : `**No gate is met yet**${why.length ? `: ${why.join(', and ')}` : ''}.`}`);
}
out();
out('## Launch-blocking outcomes');
out();
out('The checklist names outcomes that block a launch on their own. The checks that guard each one:');
out();
out('| Outcome | Checks | Where it stands |');
out('| --- | --- | --- |');
for (const [name, ids] of BLOCKERS) {
  const st = ids.map((id) => `${id} ${label(byId.get(id).status)}`).join(', ');
  const open = ids.filter((id) => !['PASS', 'N/A'].includes(byId.get(id).status)).length;
  out(`| ${name} | ${st} | ${open ? `Open: ${open} of ${ids.length} not yet shown on the release` : 'Guarded'} |`);
}
out();
out('## Failing checks');
out();
out('| Check | What fails | Fix |');
out('| --- | --- | --- |');
for (const c of register.checks.filter((x) => x.status === 'FAIL')) out(`| **${c.id}** ${esc(text.get(c.id))} | ${esc(c.risk || c.evidence)} | ${esc(c.next)} |`);
out();
out('## Evidence key');
out();
out('Evidence names the checks that support it:');
out();
for (const [k, v] of Object.entries(register.evidenceKey)) out(`- \`${k}\` ${v}`);
out();
out('## Every check');
out();
let currentArea = '';
for (const item of items) {
  if (item.area !== currentArea) {
    currentArea = item.area;
    out(`### ${currentArea.replace(/^\d+ \/ /, '')}`);
    out();
    out('| Check | Status | Evidence | Remaining risk and next step |');
    out('| --- | --- | --- | --- |');
  }
  const c = byId.get(item.id);
  const rest = [c.risk, c.next].filter((x) => x && x.trim()).join(' Next: ');
  out(`| **${item.id}** ${esc(item.text)} | ${label(c.status)} | ${esc(c.evidence) || '—'} | ${esc(c.risk && c.next ? `${c.risk} Next: ${c.next}` : rest) || '—'} |`);
  const next = items[items.indexOf(item) + 1];
  if (!next || next.area !== currentArea) out();
}
out('## Sign-off');
out();
out('| Field | Record |');
out('| --- | --- |');
for (const f of ['Release commit and date', 'Environments tested', 'G1 Security', 'G2 Integrity', 'G3 AI boundaries', 'G4 Capacity', 'G5 Recovery', 'G6 Operation', 'G7 Commercial duties', 'Accepted lower-impact risks (owner, mitigation, retest date)', 'Launch decision and approver']) out(`| ${f} | |`);
out();
fs.writeFileSync(path.join(dir, 'LAUNCH_READINESS.md'), `${lines.join('\n')}\n`);
console.log(`Wrote docs/launch/LAUNCH_READINESS.md (${lines.length} lines).`);
