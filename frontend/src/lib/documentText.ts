/**
 * How a project document is cut into passages: the same rules as the server's DocumentText (split
 * at Markdown headings and blank lines, paragraphs gathered to about 900 characters, a paragraph
 * over 1,200 characters cut at sentence ends, each passage with the headings above it). Used by the
 * in-browser test API and to show how many passages a draft will have.
 */
export const TARGET = 900;
export const LONGEST_PARAGRAPH = 1200;

export interface DocPassage {
  ordinal: number;
  heading: string | null;
  content: string;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

function pieces(p: string): string[] {
  if (p.length <= LONGEST_PARAGRAPH) return [p];
  const out: string[] = [];
  let cur = '';
  for (let s of p.split(/(?<=[.!?])\s+/)) {
    while (s.length > LONGEST_PARAGRAPH) {
      let cut = s.lastIndexOf(' ', TARGET);
      cut = cut <= 0 ? TARGET : cut;
      if (cur) {
        out.push(cur.trim());
        cur = '';
      }
      out.push(s.slice(0, cut).trim());
      s = s.slice(cut).trim();
    }
    if (cur && cur.length + s.length + 1 > TARGET) {
      out.push(cur.trim());
      cur = '';
    }
    cur = cur ? `${cur} ${s}` : s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function splitDocument(body: string): DocPassage[] {
  const out: DocPassage[] = [];
  const path: string[] = [];
  let heading: string | null = null;
  let cur = '';
  let para: string[] = [];
  const flush = () => {
    if (cur.trim()) out.push({ ordinal: out.length, heading, content: cur.trim() });
    cur = '';
  };
  const endParagraph = () => {
    const p = para.join('\n').trim();
    para = [];
    if (!p) return;
    for (const piece of pieces(p)) {
      if (cur && cur.length + piece.length + 2 > TARGET) flush();
      cur = cur ? `${cur}\n\n${piece}` : piece;
    }
  };
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    const h = HEADING.exec(line.trim());
    if (h) {
      endParagraph();
      flush();
      const level = h[1].length;
      while (path.length >= level) path.pop();
      while (path.length < level - 1) path.push('');
      path.push(h[2].trim());
      const joined = path.filter(Boolean).join(' › ');
      heading = joined ? (joined.length > 300 ? `${joined.slice(0, 299)}…` : joined) : null;
    } else if (!line.trim()) {
      endParagraph();
    } else {
      para.push(line);
    }
  }
  endParagraph();
  flush();
  return out;
}
