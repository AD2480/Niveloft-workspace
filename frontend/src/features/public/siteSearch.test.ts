import { describe, expect, it } from 'vitest';
import { INTRO_CHAPTERS } from './content';
import { FAQ, FAQ_ENTRIES, faqJsonLd } from './faq';
import { highlight, LEGAL_SECTIONS, normalise, searchSite, SITE_INDEX, snippet } from './siteSearch';

const ids = (hits: ReturnType<typeof searchSite>) => hits.map((h) => h.entry.id);

// The tests run in Node (vitest's node environment); the app's own types don't include Node's.
const FS = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ FS)) as { readFileSync: (path: string, encoding: 'utf8') => string };

/** The front page's anchors: literal ids in its components, plus the stations' section ids. */
function homeAnchors(): Set<string> {
  const files = ['src/pages/public/HomePage.tsx', 'src/features/public/home/HomeLanding.tsx'].map((f) => readFileSync(f, 'utf8')).join('\n');
  const ids = new Set<string>();
  for (const m of files.matchAll(/id="([a-z-]+)"/g)) ids.add(m[1]);
  for (const m of files.matchAll(/\bid: '([a-z-]+)'/g)) ids.add(m[1]);
  return ids;
}

describe('site search', () => {
  it('finds FAQ answers by their words, best first', () => {
    expect(ids(searchSite('only the assignee'))[0]).toBe('faq-only-the-assignee');
    expect(ids(searchSite('forgot password'))[0]).toBe('faq-forgot-password');
    expect(ids(searchSite('drag done'))).toContain('faq-drag-to-done');
    // Keywords count too: "utm" is only in the tracking answer's keywords.
    expect(ids(searchSite('utm'))).toContain('faq-what-is-tracked');
  });

  it('matches the start of words, ignores case, accents and filler words', () => {
    expect(ids(searchSite('PREDICT'))).toContain('faq-how-predictions-work');
    expect(ids(searchSite('what is the arena?'))).toContain('faq-arena');
    expect(normalise('Can’t  Café!')).toBe("can't cafe");
  });

  it('needs every word to match, and returns nothing for filler only', () => {
    expect(searchSite('assignee zebra')).toEqual([]);
    expect(searchSite('the and of')).toEqual([]);
  });

  it('highlights matched words and cuts a snippet around the first match', () => {
    const parts = highlight('Only the assignee can submit.', 'assignee submit');
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(['assignee', 'submit']);
    const long = `${'x '.repeat(100)}the evidence is here ${'y '.repeat(100)}`;
    const s = snippet(long, 'evidence');
    expect(s).toContain('evidence');
    expect(s.startsWith('…')).toBe(true);
  });

  it('indexes every FAQ answer, chapter and policy section once', () => {
    const all = SITE_INDEX.map((e) => e.id);
    expect(new Set(all).size).toBe(all.length);
    expect(all.filter((id) => id.startsWith('faq-')).length).toBe(FAQ_ENTRIES.length);
    expect(all.filter((id) => id.startsWith('intro-')).length).toBe(INTRO_CHAPTERS.length);
  });

  it('points only at sections that exist', () => {
    const legal = readFileSync('src/pages/public/LegalPages.tsx', 'utf8');
    for (const s of LEGAL_SECTIONS) expect(legal.includes(`id: '${s.id}'`), `${s.page}#${s.id}`).toBe(true);
    const home = homeAnchors();
    const intro = new Set<string>(INTRO_CHAPTERS.map((c) => c.id));
    const legalIds = new Set(LEGAL_SECTIONS.map((s) => `/${s.page}#${s.id}`));
    for (const e of SITE_INDEX) {
      const [path, hash] = e.to.split('#');
      if (!hash) continue;
      if (path === '/') expect(home.has(hash), e.to).toBe(true);
      else if (path === '/introduction') expect(intro.has(hash), e.to).toBe(true);
      else if (path === '/faq') expect(FAQ_ENTRIES.some((f) => f.id === hash), e.to).toBe(true);
      else expect(legalIds.has(e.to), e.to).toBe(true);
    }
  });
});

describe('FAQ', () => {
  it('has unique ids and plain-text answers', () => {
    const ids = FAQ.flatMap((g) => g.entries.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of FAQ_ENTRIES) {
      expect(e.answer.length).toBeGreaterThan(0);
      expect(e.question.endsWith('?')).toBe(true);
    }
  });

  it('links only to pages and sections that exist', () => {
    const intro = new Set<string>(INTRO_CHAPTERS.map((c) => c.id));
    const home = homeAnchors();
    for (const e of FAQ_ENTRIES) {
      if (!e.link) continue;
      const [path, hash] = e.link.to.split('#');
      expect(['/', '/introduction', '/privacy', '/terms', '/forgot-password', '/arena', '/faq'], e.link.to).toContain(path);
      if (hash && path === '/introduction') expect(intro.has(hash), e.link.to).toBe(true);
      if (hash && path === '/') expect(home.has(hash), e.link.to).toBe(true);
      if (hash && path === '/privacy') expect(LEGAL_SECTIONS.some((s) => s.page === 'privacy' && s.id === hash), e.link.to).toBe(true);
    }
  });

  it('writes FAQPage structured data that can’t break out of its script tag', () => {
    const json = faqJsonLd();
    expect(json).not.toContain('<');
    const data = JSON.parse(json) as { '@type': string; mainEntity: { name: string }[] };
    expect(data['@type']).toBe('FAQPage');
    expect(data.mainEntity.length).toBe(FAQ_ENTRIES.length);
  });
});
