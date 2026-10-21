#!/usr/bin/env node
// Looks for credentials in the repository: every file in the working tree (tracked or not, minus
// what .gitignore excludes), optionally every line ever added in the Git history, and optionally a
// built bundle. Node 18+, nothing to install.
//
//   node scripts/secret-scan.mjs                 # the working tree
//   node scripts/secret-scan.mjs --history       # and every commit on every branch
//   node scripts/secret-scan.mjs --dist frontend/dist
//
// A finding prints its place and the kind of secret (never the value) and the exit code is 1.
// Deleting a leaked key from the files doesn't revoke it: rotate it at the provider first.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const HISTORY = args.includes('--history');
const distAt = args.indexOf('--dist');
const DIST = distAt >= 0 ? args[distAt + 1] : null;
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

export const PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'an Anthropic API key'],
  [/\bsk-(?!ant-)(proj-)?[A-Za-z0-9_-]{32,}/, 'an OpenAI API key'],
  [/\bgsk_[A-Za-z0-9]{40,}/, 'a Groq API key'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'a Google API key'],
  [/\bsk_[a-f0-9]{48}\b/, 'an ElevenLabs API key'],
  [/\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}/, 'a Resend API key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key'],
  [/-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY( BLOCK)?-----/, 'a private key'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}/, 'a GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{60,}/, 'a GitHub token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
  [/\b(sk|rk)_live_[A-Za-z0-9]{16,}/, 'a Stripe live key'],
  [/\bwhsec_[A-Za-z0-9]{24,}/, 'a Stripe webhook secret'],
  [/\b0x4AAAAAAA[A-Za-z0-9_-]{20,}/, 'a Cloudflare Turnstile secret'],
  [/jdbc:mysql:\/\/[^\s"'`]*:[^\s"'`@/]{6,}@/, 'a database URL with a password'],
  [/mysql:\/\/[^\s:"'`]+:[^\s@"'`]{6,}@/, 'a database URL with a password'],
];

/** NAME=value lines in env-style files: a value that isn't a placeholder is a finding. */
const ENV_LINE = /^\s*(?:export\s+)?([A-Z0-9_]*(?:SECRET|PASSWORD|API_KEY|TOKEN|PRIVATE_KEY))\s*=\s*([^\s#]+)/;
const PLACEHOLDER = /^(\$\{.*\}|change-?me|<.*>|your[-_].*|replace[-_].*|x+|\.\.\.|example.*|placeholder|none|false|true|0|projectflow|""|'')$/i;

/** Public values that look like secrets on purpose. */
const ALLOWED = [
  'ZGV2LW9ubHktcHJvamVjdGZsb3ctc2VjcmV0LWNoYW5nZS1tZS1iZWZvcmUtZGVwbG95aW5nLTEyMzQ1Ng==', // the public development JWT key (refused in production)
  'dGVzdC1vbmx5LXByb2plY3RmbG93LXNlY3JldC1rZXktZm9yLXVuaXQtdGVzdHMtMTIzNDU2Nzg5MA==', // the tests' JWT key
  'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123', // a made-up key in frontend/tools/seo.test.ts
];
const SKIP = /(^|\/)(node_modules|\.git|target|dist|__pycache__|\.venv)\//;
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|glb|gltf|bin|zip|gz|pdf|mp3|mp4|wav|jar|class|lock)$/i;

export function scanText(text, place, findings) {
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (ALLOWED.some((a) => line.includes(a))) return;
    for (const [re, what] of PATTERNS) if (re.test(line)) findings.push(`${place}:${i + 1}  ${what}`);
    const env = ENV_LINE.exec(line);
    if (env && /\.env|\.properties$|\.ya?ml$|\.conf$/.test(place) && !PLACEHOLDER.test(env[2].replace(/^["']|["']$/g, ''))) {
      findings.push(`${place}:${i + 1}  a value for ${env[1]}`);
    }
  });
}

const findings = [];
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter((f) => f && !SKIP.test(`/${f}`) && !BINARY.test(f) && f !== 'scripts/secret-scan.mjs' && fs.existsSync(path.join(root, f)));
for (const f of files) {
  const full = path.join(root, f);
  if (fs.statSync(full).size > 2_000_000) continue;
  scanText(fs.readFileSync(full, 'utf8'), f, findings);
}
let commits = 0;
if (HISTORY) {
  const log = execFileSync('git', ['log', '--all', '-p', '--no-color', '--no-ext-diff', '--format=commit %H'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30 });
  let commit = '';
  let file = '';
  for (const line of log.split('\n')) {
    if (line.startsWith('commit ')) {
      commit = line.slice(7, 19);
      commits++;
    } else if (line.startsWith('+++ b/')) file = line.slice(6);
    else if (line.startsWith('+') && !line.startsWith('+++') && file !== 'scripts/secret-scan.mjs' && !BINARY.test(file)) {
      scanText(line.slice(1), `${commit} ${file}`, findings);
    }
  }
}
if (DIST) {
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (!BINARY.test(e.name)) scanText(fs.readFileSync(p, 'utf8'), path.relative(root, p), findings);
    }
  };
  walk(path.resolve(DIST));
}
const where = [`${files.length} files`, HISTORY ? `${commits} commits` : null, DIST ? DIST : null].filter(Boolean).join(', ');
if (findings.length) {
  console.log(`Possible secrets (${findings.length}) in ${where}:\n  ${[...new Set(findings)].join('\n  ')}`);
  console.log('Rotate any real credential at its provider first; removing it from the files or history does not revoke it.');
  process.exit(1);
}
console.log(`No secrets found in ${where}.`);
