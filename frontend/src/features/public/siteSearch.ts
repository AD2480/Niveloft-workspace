/**
 * Site search over the public pages: page sections, the introduction's chapters, every FAQ
 * answer and the legal pages' sections. It runs in the browser from this fixed index (nothing is
 * sent anywhere), and the signed-in command palette uses it for its Help results.
 */
import { INTRO_CHAPTERS, ROLES } from './content';
import { FAQ_ENTRIES } from './faq';

export interface SiteEntry {
  id: string;
  /** Where it opens: a path with an optional #section. */
  to: string;
  title: string;
  /** Which page it's on, shown under the title. */
  where: string;
  text: string;
  keywords?: string;
}

/** Sections of the privacy policy and the terms (their ids are checked against LegalPages by a test). */
export const LEGAL_SECTIONS: { page: 'privacy' | 'terms'; id: string; title: string; keywords?: string }[] = [
  { page: 'privacy', id: 'who', title: 'Who is responsible', keywords: 'operator controller contact' },
  { page: 'privacy', id: 'collect', title: 'What we collect', keywords: 'personal data account utm form counts' },
  { page: 'privacy', id: 'use', title: 'Why we use it' },
  { page: 'privacy', id: 'cookies', title: 'Cookies and browser storage', keywords: 'cookie consent localstorage analytics' },
  { page: 'privacy', id: 'share', title: 'Who can see it', keywords: 'share third parties processors' },
  { page: 'privacy', id: 'keep', title: 'How long we keep it', keywords: 'retention delete' },
  { page: 'privacy', id: 'security', title: 'How we protect it', keywords: 'security encryption bcrypt' },
  { page: 'privacy', id: 'rights', title: 'Your choices and rights', keywords: 'gdpr access export delete correct' },
  { page: 'privacy', id: 'age', title: 'Age', keywords: 'children minimum age' },
  { page: 'privacy', id: 'changes', title: 'Changes to this policy' },
  { page: 'terms', id: 'agreement', title: 'The agreement' },
  { page: 'terms', id: 'service', title: 'The service' },
  { page: 'terms', id: 'account', title: 'Your account', keywords: 'password sign in' },
  { page: 'terms', id: 'content', title: 'Your content', keywords: 'ownership uploads' },
  { page: 'terms', id: 'use', title: 'Acceptable use', keywords: 'rules abuse' },
  { page: 'terms', id: 'ai', title: 'AI answers and forecasts', keywords: 'ai accuracy liability' },
  { page: 'terms', id: 'ending', title: 'Ending your use', keywords: 'close account terminate' },
  { page: 'terms', id: 'liability', title: 'Liability', keywords: 'warranty' },
  { page: 'terms', id: 'changes', title: 'Changes and contact' },
];

const HOME: SiteEntry[] = [
  { id: 'home', to: '/', title: 'Front page', where: 'Niveloft', text: 'See what will finish, when, and what’s in the way. A project workspace for small software and student teams: tasks, owners, reviews and a delivery forecast with a range.', keywords: 'home start' },
  { id: 'home-product', to: '/#product', title: 'Sample workspace', where: 'Front page', text: 'Launch the mobile onboarding update: an interactive sample project with a board, a list and a timeline. Open a task, change its status, give work an owner, reset.', keywords: 'try sample example board list timeline explore' },
  { id: 'home-roles', to: '/#roles', title: 'One project, four views', where: 'Front page', text: `Each role opens on the view that answers its question: a member sees their own work and likely finish, a reviewer sees whose delivery they block, an owner sees what threatens delivery, a viewer sees the forecast. ${ROLES.map((r) => `${r.label}: ${r.summary}`).join(' ')}`, keywords: 'roles permissions member reviewer owner viewer client graph timeline' },
  { id: 'home-how', to: '/#how', title: 'How the forecast works', where: 'Front page', text: 'Change an assumption and watch the forecast move: the finish window, the chance of meeting the deadline and the task holding it up, worked out from estimates, dependencies and how long finished tasks really took.', keywords: 'forecast prediction deadline estimate range what if assumption' },
  { id: 'home-flurry', to: '/#flurry', title: 'Meet Flurry, the AI assistant', where: 'Front page', text: 'Find your next move. Plan a project, summarise progress and review blockers. Flurry asks before changing anything.', keywords: 'assistant ai flurry helper' },
  { id: 'flurry-page', to: '/flurry', title: 'Meet Flurry', where: 'Flurry', text: 'Flurry’s character at every size, how it behaves (idle, roaming, dragged, clicked, working, done, needs you, hidden), a sandbox to try it, and the rules it keeps.', keywords: 'assistant ai flurry mascot character sandbox try roam drag hide' },
  { id: 'home-questions', to: '/#questions', title: 'Common questions', where: 'Front page', text: 'Short answers to the questions people ask first, with a link to the full list.', keywords: 'faq questions' },
  { id: 'faq', to: '/faq', title: 'Frequently asked questions', where: 'FAQ', text: 'Answers about roles, reviews, predictions, AI, your account and troubleshooting.', keywords: 'help questions support' },
  { id: 'register', to: '/register', title: 'Create your workspace', where: 'Account', text: 'Sign up for free and create your workspace.', keywords: 'sign up register join' },
  { id: 'login', to: '/login', title: 'Log in', where: 'Account', text: 'Log in to continue to your projects.', keywords: 'log in login' },
];

export const SITE_INDEX: SiteEntry[] = [
  ...HOME,
  ...INTRO_CHAPTERS.map((c) => ({ id: `intro-${c.id}`, to: `/introduction#${c.id}`, title: c.title, where: 'Introduction', text: `Chapter of the introduction: ${c.title}.` })),
  ...FAQ_ENTRIES.map((e) => ({ id: `faq-${e.id}`, to: `/faq#${e.id}`, title: e.question, where: `FAQ: ${e.group}`, text: e.answer.join(' '), keywords: e.keywords })),
  ...LEGAL_SECTIONS.map((s) => ({
    id: `${s.page}-${s.id}`,
    to: `/${s.page}#${s.id}`,
    title: s.title,
    where: s.page === 'privacy' ? 'Privacy policy' : 'Terms and conditions',
    text: '',
    keywords: s.keywords,
  })),
];

/** Lower case, accents and punctuation removed, curly quotes straightened. */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set(['a', 'an', 'the', 'is', 'it', 'to', 'of', 'and', 'or', 'i', 'my', 'do', 'does', 'how', 'what', 'can', 'in', 'on', 'for', 'with', 'why', 'me']);

export interface SiteHit {
  entry: SiteEntry;
  score: number;
}

/**
 * Every word of the query must appear somewhere in the entry (as a word or the start of one);
 * matches in the title count most, then keywords, then the text. Returns the best first.
 */
export function searchSite(query: string, limit = 8, index: SiteEntry[] = SITE_INDEX): SiteHit[] {
  const words = normalise(query)
    .split(' ')
    .filter((w) => w.length > 0 && !STOP.has(w));
  if (!words.length) return [];
  const hits: SiteHit[] = [];
  for (const entry of index) {
    const title = ` ${normalise(entry.title)} `;
    const keys = ` ${normalise(entry.keywords ?? '')} ${normalise(entry.where)} `;
    const text = ` ${normalise(entry.text)} `;
    let score = 0;
    let all = true;
    for (const w of words) {
      const s = weight(title, w) * 5 + weight(keys, w) * 3 + weight(text, w);
      if (s === 0) {
        all = false;
        break;
      }
      score += s;
    }
    if (!all) continue;
    if (title.includes(` ${words.join(' ')}`)) score += 6; // the whole phrase in the title
    hits.push({ entry, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.entry.title.length - b.entry.title.length).slice(0, limit);
}

/** 2 for a whole word, 1 for the start of a word, 0 otherwise. */
function weight(haystack: string, word: string): number {
  if (haystack.includes(` ${word} `)) return 2;
  if (haystack.includes(` ${word}`)) return 1;
  return 0;
}

/** Splits text around the query's words, so the matches can be highlighted. */
export function highlight(text: string, query: string): { text: string; match: boolean }[] {
  const words = normalise(query)
    .split(' ')
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return [{ text, match: false }];
  const re = new RegExp(`\\b(${words.join('|')})`, 'gi');
  const out: { text: string; match: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    // Extend to the end of the word.
    let end = i + m[0].length;
    while (end < text.length && /[\p{L}\p{N}]/u.test(text[end])) end++;
    if (i > last) out.push({ text: text.slice(last, i), match: false });
    out.push({ text: text.slice(i, end), match: true });
    last = end;
  }
  if (last < text.length) out.push({ text: text.slice(last), match: false });
  return out;
}

/** A short piece of the text around the first match. */
export function snippet(text: string, query: string, max = 140): string {
  if (text.length <= max) return text;
  const words = normalise(query).split(' ').filter((w) => w.length > 1 && !STOP.has(w));
  const lower = text.toLowerCase();
  const at = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 40);
  const cut = text.slice(start, start + max);
  return `${start > 0 ? '…' : ''}${cut.trim()}${start + max < text.length ? '…' : ''}`;
}
