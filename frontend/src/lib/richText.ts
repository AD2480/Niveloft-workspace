/**
 * The light formatting people write in descriptions, comments, reviews and notes: a small, safe
 * subset of Markdown, plus Niveloft's own links. Parsed into a tree (never into HTML), so nothing a
 * person types can become markup or script.
 *
 * Blocks: paragraphs (single line breaks kept), `#`/`##`/`###` headings, `- ` and `1. ` lists,
 * `- [ ]` / `- [x]` checklists, `> ` quotes, ``` code blocks and `---` rules.
 * Inline: **bold**, *italic* or _italic_, `code`, [text](https://…) and bare https links,
 * task keys (ONB-9) and @mentions of the people given.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; children: Inline[] }
  | { t: 'strong'; children: Inline[] }
  | { t: 'em'; children: Inline[] }
  | { t: 'key'; key: string }
  | { t: 'mention'; name: string }
  | { t: 'br' };

export type Block =
  | { t: 'p'; children: Inline[] }
  | { t: 'h'; level: 1 | 2 | 3; children: Inline[] }
  | { t: 'quote'; children: Inline[] }
  | { t: 'list'; ordered: boolean; start: number; items: { checked: boolean | null; children: Inline[] }[] }
  | { t: 'code'; v: string }
  | { t: 'hr' };

export interface RichTextOptions {
  /** Full names of the people who can be mentioned (a project's members). */
  people?: string[];
}

/** A task key: a project key (2–10 capitals or digits, starting with a letter), a hyphen and a number. */
export const TASK_KEY = /(?<![A-Za-z0-9_-])([A-Z][A-Z0-9]{1,9}-\d{1,6})(?![A-Za-z0-9_-])/g;
/** The same, anchored where the scan stands. */
const KEY_HERE = /[A-Z][A-Z0-9]{1,9}-\d{1,6}(?![A-Za-z0-9_-])/y;

const SAFE_URL = /^(https?:\/\/|mailto:)/i;
const BARE_URL = /https?:\/\/[^\s<>()[\]]+/g;

// ------------------------------------------------------------------------------------------ mentions

interface Alias {
  /** What's typed after the @, lower case. */
  text: string;
  /** The person's full name. */
  name: string;
}

/** Full names, and first names that only one person has, longest first. */
export function mentionAliases(people: string[] = []): Alias[] {
  const out: Alias[] = [];
  const firsts = new Map<string, string[]>();
  for (const name of people) {
    const clean = name.trim();
    if (!clean) continue;
    out.push({ text: clean.toLowerCase(), name: clean });
    const first = clean.split(/\s+/)[0].toLowerCase();
    firsts.set(first, [...(firsts.get(first) ?? []), clean]);
  }
  for (const [first, names] of firsts) if (names.length === 1 && names[0].toLowerCase() !== first) out.push({ text: first, name: names[0] });
  return out.sort((a, b) => b.text.length - a.text.length);
}

/** The person mentioned at `at` (the index of an @), and how many characters the mention takes. */
function mentionAt(s: string, at: number, aliases: Alias[]): { name: string; length: number } | null {
  if (s[at] !== '@') return null;
  // An @ inside a word (an email address) isn't a mention.
  if (at > 0 && /[A-Za-z0-9._%+-]/.test(s[at - 1])) return null;
  const rest = s.slice(at + 1).toLowerCase();
  for (const a of aliases) {
    if (rest.startsWith(a.text)) {
      const after = s[at + 1 + a.text.length];
      if (after === undefined || !/[\p{L}\p{N}_]/u.test(after)) return { name: a.name, length: 1 + a.text.length };
    }
  }
  return null;
}

/** Everyone mentioned in a text (full names, once each, in order). Code is ignored. */
export function mentionsIn(text: string, people: string[] = []): string[] {
  const aliases = mentionAliases(people);
  if (!aliases.length) return [];
  const found: string[] = [];
  const walk = (nodes: Inline[]) => {
    for (const n of nodes) {
      if (n.t === 'mention' && !found.includes(n.name)) found.push(n.name);
      if ('children' in n) walk(n.children);
    }
  };
  for (const b of parseRichText(text, { people }))
    if ('children' in b) walk(b.children);
    else if (b.t === 'list') for (const it of b.items) walk(it.children);
  return found;
}

/** Every task key in a text (once each, in order). Code and links are ignored. */
export function taskKeysIn(text: string): string[] {
  const found: string[] = [];
  const walk = (nodes: Inline[]) => {
    for (const n of nodes) {
      if (n.t === 'key' && !found.includes(n.key)) found.push(n.key);
      if (n.t !== 'link' && 'children' in n) walk(n.children);
    }
  };
  for (const b of parseRichText(text))
    if ('children' in b) walk(b.children);
    else if (b.t === 'list') for (const it of b.items) walk(it.children);
  return found;
}

// ------------------------------------------------------------------------------------------ inline

function pushText(out: Inline[], v: string) {
  if (!v) return;
  const last = out[out.length - 1];
  if (last && last.t === 'text') last.v += v;
  else out.push({ t: 'text', v });
}

/** Task keys and mentions in plain text (no other formatting). `keys` is off inside a link's own words. */
function plain(s: string, aliases: Alias[], keys = true): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  let from = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '@' && aliases.length) {
      const m = mentionAt(s, i, aliases);
      if (m) {
        pushText(out, s.slice(from, i));
        out.push({ t: 'mention', name: m.name });
        i += m.length;
        from = i;
        continue;
      }
    }
    if (keys && ch >= 'A' && ch <= 'Z' && (i === 0 || !/[A-Za-z0-9_-]/.test(s[i - 1]))) {
      KEY_HERE.lastIndex = i;
      const m = KEY_HERE.exec(s);
      if (m) {
        pushText(out, s.slice(from, i));
        out.push({ t: 'key', key: m[0] });
        i += m[0].length;
        from = i;
        continue;
      }
    }
    i++;
  }
  pushText(out, s.slice(from));
  return out;
}

/** Emphasis (bold, then italic), with keys and mentions inside. */
function emphasis(s: string, aliases: Alias[], keys = true): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__|(?<![\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])|(?<![\w_])_(?=\S)([^_\n]*?\S)_(?![\w_])/g;
  let from = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    for (const n of plain(s.slice(from, m.index), aliases, keys)) {
      if (n.t === 'text') pushText(out, n.v);
      else out.push(n);
    }
    const bold = m[1] ?? m[2];
    if (bold !== undefined) out.push({ t: 'strong', children: emphasis(bold, aliases, keys) });
    else out.push({ t: 'em', children: emphasis(m[3] ?? m[4], aliases, keys) });
    from = m.index + m[0].length;
  }
  for (const n of plain(s.slice(from), aliases, keys)) {
    if (n.t === 'text') pushText(out, n.v);
    else out.push(n);
  }
  return out;
}

/** Links (written and bare), then emphasis in what's left. */
function links(s: string, aliases: Alias[]): Inline[] {
  const out: Inline[] = [];
  const re = /\[([^\]\n]+)\]\(([^)\s]+)\)|https?:\/\/[^\s<>()[\]]+/g;
  let from = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    let whole = m[0];
    let href: string;
    let label: Inline[];
    if (m[1] !== undefined) {
      href = m[2];
      if (!SAFE_URL.test(href)) continue; // not a link we'd open: leave the text as written
      label = emphasis(m[1], [], false);
    } else {
      // A bare link ends before trailing punctuation.
      const trimmed = whole.replace(/[.,;:!?'"’”]+$/, '');
      whole = trimmed;
      href = trimmed;
      label = [{ t: 'text', v: trimmed }];
    }
    for (const n of emphasis(s.slice(from, m.index), aliases)) out.push(n);
    out.push({ t: 'link', href, children: label });
    from = m.index + whole.length;
    re.lastIndex = from;
  }
  for (const n of emphasis(s.slice(from), aliases)) out.push(n);
  return out;
}

/** One block's inline content: code spans first (nothing inside them is formatted), then links. */
export function parseInline(s: string, opts: RichTextOptions = {}): Inline[] {
  const aliases = mentionAliases(opts.people);
  const out: Inline[] = [];
  const parts = s.split(/(`[^`\n]+`)/);
  for (const part of parts) {
    if (!part) continue;
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) out.push({ t: 'code', v: part.slice(1, -1) });
    else {
      for (const n of links(part, aliases)) {
        if (n.t === 'text') pushText(out, n.v);
        else out.push(n);
      }
    }
  }
  return out;
}

/** Lines joined with line breaks. */
function lines(ls: string[], opts: RichTextOptions): Inline[] {
  const out: Inline[] = [];
  ls.forEach((l, i) => {
    if (i) out.push({ t: 'br' });
    out.push(...parseInline(l, opts));
  });
  return out;
}

// ------------------------------------------------------------------------------------------ blocks

export function parseRichText(text: string, opts: RichTextOptions = {}): Block[] {
  const src = (text ?? '').replace(/\r\n?/g, '\n');
  const ls = src.split('\n');
  const out: Block[] = [];
  let i = 0;
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: 'p', children: lines(para, opts) });
    para = [];
  };
  while (i < ls.length) {
    const line = ls[i];
    // Code block: everything up to the closing fence, as written.
    if (/^\s*```/.test(line)) {
      flush();
      const body: string[] = [];
      i++;
      while (i < ls.length && !/^\s*```\s*$/.test(ls[i])) body.push(ls[i++]);
      i++; // the closing fence (or the end)
      out.push({ t: 'code', v: body.join('\n') });
      continue;
    }
    if (!line.trim()) {
      flush();
      i++;
      continue;
    }
    const h = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      out.push({ t: 'h', level: h[1].length as 1 | 2 | 3, children: parseInline(h[2], opts) });
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      out.push({ t: 'hr' });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const q: string[] = [];
      while (i < ls.length && /^\s*>/.test(ls[i])) q.push(ls[i++].replace(/^\s*>\s?/, ''));
      out.push({ t: 'quote', children: lines(q, opts) });
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.*)$/;
    const numbered = /^\s*(\d{1,3})[.)]\s+(.*)$/;
    if (bullet.test(line) || numbered.test(line)) {
      flush();
      const ordered = numbered.test(line) && !bullet.test(line);
      const start = ordered ? Number(numbered.exec(line)![1]) : 1;
      const items: { checked: boolean | null; children: Inline[] }[] = [];
      while (i < ls.length) {
        const m = ordered ? numbered.exec(ls[i]) : bullet.exec(ls[i]);
        if (!m) break;
        const body = ordered ? m[2] : m[1];
        const box = /^\[( |x|X)\]\s+(.*)$/.exec(body);
        items.push(box ? { checked: box[1].toLowerCase() === 'x', children: parseInline(box[2], opts) } : { checked: null, children: parseInline(body, opts) });
        i++;
      }
      out.push({ t: 'list', ordered, start, items });
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return out;
}

/** The text without its formatting marks, for previews and notifications. */
export function plainText(text: string): string {
  return (text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, '$1')
    .replace(/(?<![\w_])_([^_\n]+)_(?![\w_])/g, '$1')
    .replace(/^\s*#{1,3}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*•]\s+\[( |x|X)\]\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A short plain excerpt of the text around `needle` (or from its start), with … where it's cut. */
export function excerpt(text: string, needle: string | null, max: number): string {
  const plain = plainText(text);
  if (plain.length <= max) return plain;
  const at = needle ? plain.indexOf(needle) : -1;
  const start = at < 0 ? 0 : Math.max(0, Math.min(at - Math.floor(max / 3), plain.length - max));
  const cut = plain.slice(start, start + max).trim();
  return (start > 0 ? '…' : '') + cut + (start + max < plain.length ? '…' : '');
}

export { BARE_URL };
