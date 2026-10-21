#!/usr/bin/env node
// Rules for database migrations (backend/src/main/resources/db/migration), so a deploy can be
// rolled back without restoring the database:
//   - files are V<n>__<words>.sql, numbered 1, 2, 3… with no gaps or repeats;
//   - a released migration never changes (its SHA-256 is recorded in backend/migrations.sha256; Flyway
//     would refuse to start on an edited one anyway);
//   - a new migration is additive: no DROP, RENAME, MODIFY/CHANGE COLUMN, TRUNCATE, DELETE
//     without WHERE, or NOT NULL column without a DEFAULT, unless the line before says
//     "-- reviewed-destructive: <why, and the expand/contract step it belongs to>".
//
//   node scripts/check-migrations.mjs            # check
//   node scripts/check-migrations.mjs --record   # after review, record new migrations as released
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../backend/src/main/resources/db/migration');
const manifestPath = path.resolve(dir, '../../../../../migrations.sha256');
const record = process.argv.includes('--record');
const problems = [];

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort((a, b) => Number(a.match(/^V(\d+)__/)?.[1] ?? 0) - Number(b.match(/^V(\d+)__/)?.[1] ?? 0));
files.forEach((f, i) => {
  const m = /^V(\d+)__[a-z0-9_]+\.sql$/.exec(f);
  if (!m) problems.push(`${f}: name it V<number>__words_with_underscores.sql`);
  else if (Number(m[1]) !== i + 1) problems.push(`${f}: expected V${i + 1} here (no gaps or repeated numbers)`);
});

const released = new Map();
if (fs.existsSync(manifestPath)) {
  for (const line of fs.readFileSync(manifestPath, 'utf8').split('\n')) {
    const m = /^([a-f0-9]{64})\s+(\S+)$/.exec(line.trim());
    if (m) released.set(m[2], m[1]);
  }
}
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex');

const RULES = [
  [/\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|FOREIGN\s+KEY|PRIMARY\s+KEY)\b/i, 'drops something an older release may still use'],
  [/\bALTER\s+TABLE\s+\S+\s+DROP\b/i, 'drops a column an older release may still read'],
  [/\bRENAME\s+(TABLE|COLUMN|TO)\b/i, 'renames something an older release still uses'],
  [/\b(MODIFY|CHANGE)\s+(COLUMN\s+)?\w+/i, 'changes a column in place (narrowing or retyping breaks older releases)'],
  [/\bTRUNCATE\b/i, 'removes every row'],
  [/\bDELETE\s+FROM\s+\w+\s*;/i, 'deletes every row (no WHERE)'],
  [/\bADD\s+(COLUMN\s+)?\w+\s+[A-Z]+(\(\d+(,\s*\d+)?\))?[^,;]*\bNOT\s+NULL\b(?![^,;]*\bDEFAULT\b)/i, 'adds a NOT NULL column without a DEFAULT, so an older release can no longer insert rows'],
];

let checked = 0;
for (const f of files) {
  const hash = sha(f);
  if (released.has(f)) {
    if (released.get(f) !== hash) problems.push(`${f}: a released migration was edited. Put the change in a new migration instead.`);
    continue;
  }
  checked++;
  const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
  lines.forEach((line, i) => {
    const code = line.replace(/--.*$/, '');
    for (const [re, why] of RULES) {
      if (re.test(code) && !/--\s*reviewed-destructive:\s*\S/.test(lines[i - 1] ?? '')) problems.push(`${f}:${i + 1}: ${why}. Split it into expand and contract steps (docs/launch/RUNBOOKS.md), or mark it "-- reviewed-destructive: <why>" on the line before.`);
    }
  });
}

if (problems.length) {
  console.log(`Migration problems:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
if (record) {
  const lines = files.map((f) => `${sha(f)}  ${f}`);
  fs.writeFileSync(manifestPath, `${lines.join('\n')}\n`);
  console.log(`Recorded ${files.length} migrations as released in ${path.relative(process.cwd(), manifestPath)}.`);
} else {
  console.log(`${files.length} migrations in order; ${files.length - checked} released and unchanged; ${checked} new, all additive.`);
}
