import { describe, expect, it } from 'vitest';
import { excerpt, mentionAliases, mentionsIn, parseInline, parseRichText, plainText, taskKeysIn, type Block, type Inline } from './richText';

const PEOPLE = ['Priya Nair', 'Rohan Mehta', 'Sneha Iyer', 'Aarav Sharma', 'Aarav Das'];

/** A compact picture of inline content, for readable assertions. */
function show(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case 'text':
          return n.v;
        case 'code':
          return `<code>${n.v}</code>`;
        case 'link':
          return `<a ${n.href}>${show(n.children)}</a>`;
        case 'strong':
          return `<b>${show(n.children)}</b>`;
        case 'em':
          return `<i>${show(n.children)}</i>`;
        case 'key':
          return `<key ${n.key}>`;
        case 'mention':
          return `<@${n.name}>`;
        case 'br':
          return '<br>';
      }
    })
    .join('');
}

describe('rich text: inline', () => {
  it('turns task keys into references, but not inside words, code or links', () => {
    expect(show(parseInline('Waiting on ONB-9 and CCP-12.'))).toBe('Waiting on <key ONB-9> and <key CCP-12>.');
    expect(show(parseInline('xONB-9, ONB-9x, onb-9, ONB-, A-1, ONB-9-2'))).toBe('xONB-9, ONB-9x, onb-9, ONB-, A-1, ONB-9-2');
    expect(show(parseInline('run `ONB-9` now'))).toBe('run <code>ONB-9</code> now');
    expect(show(parseInline('[see ONB-9](https://x.example/ONB-9)'))).toBe('<a https://x.example/ONB-9>see ONB-9</a>');
  });

  it('formats bold, italic and code, and leaves snake_case and lone stars alone', () => {
    expect(show(parseInline('**Ship** it *today* or _soon_'))).toBe('<b>Ship</b> it <i>today</i> or <i>soon</i>');
    expect(show(parseInline('a snake_case_name and 2 * 3 * 4'))).toBe('a snake_case_name and 2 * 3 * 4');
    expect(show(parseInline('**ONB-9 is late**'))).toBe('<b><key ONB-9> is late</b>');
  });

  it('only links to http, https and mailto, and trims trailing punctuation from bare links', () => {
    expect(show(parseInline('[click](javascript:alert(1))'))).toBe('[click](javascript:alert(1))');
    expect(show(parseInline('See https://example.com/a.'))).toBe('See <a https://example.com/a>https://example.com/a</a>.');
    expect(show(parseInline('[mail](mailto:team@example.com)'))).toBe('<a mailto:team@example.com>mail</a>');
  });

  it('finds mentions by full name, or by a first name only one person has', () => {
    expect(show(parseInline('@Priya Nair can you check?', { people: PEOPLE }))).toBe('<@Priya Nair> can you check?');
    expect(show(parseInline('thanks @rohan!', { people: PEOPLE }))).toBe('thanks <@Rohan Mehta>!');
    // Two people called Aarav: the first name alone is ambiguous, the full name isn't.
    expect(show(parseInline('@Aarav and @Aarav Das', { people: PEOPLE }))).toBe('@Aarav and <@Aarav Das>');
    // An email address isn't a mention; nor is a name that runs on into another word.
    expect(show(parseInline('mail priya@nair.dev or @Priyanka', { people: PEOPLE }))).toBe('mail priya@nair.dev or @Priyanka');
  });

  it('lists who is mentioned and which tasks are referenced, once each', () => {
    expect(mentionsIn('@Priya Nair and @sneha, then @Priya Nair again; `@Rohan Mehta`', PEOPLE)).toEqual(['Priya Nair', 'Sneha Iyer']);
    expect(taskKeysIn('ONB-9 holds up ONB-10 and ONB-9; `ONB-11` is code')).toEqual(['ONB-9', 'ONB-10']);
    expect(mentionAliases(['Ana Lima']).map((a) => a.text)).toEqual(['ana lima', 'ana']);
  });
});

describe('rich text: blocks', () => {
  const kinds = (b: Block[]) => b.map((x) => x.t).join(',');

  it('reads paragraphs, keeping single line breaks', () => {
    const b = parseRichText('First line\nsecond line\n\nNew paragraph');
    expect(kinds(b)).toBe('p,p');
    expect(show((b[0] as { children: Inline[] }).children)).toBe('First line<br>second line');
  });

  it('reads headings, lists, checklists, quotes, rules and code blocks', () => {
    const src = ['## Plan', '- one', '- [x] done', '- [ ] open', '', '1. first', '2. second', '', '> quoted ONB-9', '---', '```', '**not bold** ONB-1', '```'].join('\n');
    const b = parseRichText(src);
    expect(kinds(b)).toBe('h,list,list,quote,hr,code');
    const ul = b[1] as Extract<Block, { t: 'list' }>;
    expect(ul.ordered).toBe(false);
    expect(ul.items.map((i) => i.checked)).toEqual([null, true, false]);
    const ol = b[2] as Extract<Block, { t: 'list' }>;
    expect(ol.ordered && ol.start).toBe(1);
    expect(show((b[3] as { children: Inline[] }).children)).toBe('quoted <key ONB-9>');
    expect((b[5] as { v: string }).v).toBe('**not bold** ONB-1');
  });

  it('never produces markup from what people type', () => {
    const b = parseRichText('<img src=x onerror=alert(1)> <script>bad()</script>');
    expect(show((b[0] as { children: Inline[] }).children)).toBe('<img src=x onerror=alert(1)> <script>bad()</script>');
  });

  it('gives plain text for previews', () => {
    expect(plainText('## Plan\n- [x] **Ship** the `build`\n> see [docs](https://x.example)')).toBe('Plan Ship the build see docs');
  });

  it('excerpts around a key, marking where the text was cut', () => {
    expect(excerpt('**Blocked** by [the API](https://x.example) ONB-9', 'ONB-9', 160)).toBe('Blocked by the API ONB-9');
    const cut = excerpt(`${'a'.repeat(200)} ONB-9 ${'b'.repeat(200)}`, 'ONB-9', 60);
    expect(cut).toContain('ONB-9');
    expect(cut.startsWith('…') && cut.endsWith('…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(62);
  });

  it('agrees with the server about which keys a text names (not inside links or code)', () => {
    // The same cases as TextRefsTest.java, so backlinks and highlighted keys match.
    expect(taskKeysIn('Blocked by ONB-9, see notes')).toEqual(['ONB-9']);
    expect(taskKeysIn('See ONB-90 instead')).toEqual(['ONB-90']);
    expect(taskKeysIn('XONB-9 is not it')).not.toContain('ONB-9');
    expect(taskKeysIn('`ONB-9` in code')).toEqual([]);
    expect(taskKeysIn('[ONB-9 notes](https://x.example/ONB-9)')).toEqual([]);
    expect(taskKeysIn('see https://tracker.example/browse/ONB-9')).toEqual([]);
    expect(taskKeysIn('[notes](https://x.example) then ONB-9')).toEqual(['ONB-9']);
  });
});
