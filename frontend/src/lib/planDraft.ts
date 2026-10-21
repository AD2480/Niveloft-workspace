/**
 * "Plan a project" without AI: turns a written brief into draft tasks, one per line, bullet or
 * sentence that asks for something to be done. It only uses what the brief says: dates, owners,
 * priorities and estimates come from the words ("by Friday", "assign to Priya", "urgent", "takes 3
 * days"); nothing is invented. Headings ("Design:") become a note on the tasks under them.
 *
 * The draft is shown for review; nothing is created until the person confirms.
 */
import type { Priority } from '@/api/types';
import { parseTaskPhrase } from './assistantIntents';

export interface DraftTask {
  title: string;
  description: string | null;
  priority: Priority | null;
  dueDate: string | null;
  assigneeName: string | null;
  estimateDays: number | null;
  /** Indexes (in the same draft) of tasks this one waits on. */
  dependsOn: number[];
  /** The part of the brief it came from. */
  source: string;
}

export interface DraftPlan {
  tasks: DraftTask[];
  /** Lines that didn't read like work to do (kept so the person can see nothing was dropped silently). */
  skipped: string[];
  /** What the brief doesn't say, so the person can add it. */
  gaps: string[];
}

export const MAX_DRAFT_TASKS = 20;

const LEAD_IN =
  /^(?:(?:and|also|then|next|finally|first(?:ly)?|second(?:ly)?|after that|afterwards)[,\s]+)*(?:(?:we|i|you|they|the team|someone)\s+(?:need|needs|have|has|want|wants|should|must|will|would like|'d like|are going|am going|is going)\s+(?:to\s+)?|(?:need|needs|have|has)\s+to\s+|(?:please|let's|lets)\s+|(?:we'll|i'll|we will|i will)\s+)/i;
const NOT_WORK = /^(?:the goal|goal|background|context|why|note|notes|summary|overview|we are|this is|it is|it's|there is|there are)\b/i;
/** Headings whose lines explain the work rather than list it. */
const CONTEXT_HEADING = /^(?:background|context|goals?|why|notes?|summary|overview|problem|about)$/i;

/** Splits a brief into candidate pieces of work: lines, bullets, numbered items, then sentences. */
export function splitBrief(brief: string): { heading: string | null; text: string; listItem?: boolean }[] {
  const out: { heading: string | null; text: string; listItem?: boolean }[] = [];
  let heading: string | null = null;
  for (const raw of brief.replace(/\r/g, '').split('\n')) {
    let line = raw.trim();
    if (!line) continue;
    line = line.replace(/^(?:[-*•·–—]|\d{1,2}[.)]|\[[ x]\])\s+/i, '').trim();
    if (!line) continue;
    // "Design:" alone is a heading for the lines below it.
    const h = /^([^:.!?]{2,40}):$/.exec(line);
    if (h) {
      heading = h[1].trim();
      continue;
    }
    // "Design: wireframes, copy" — a heading and its work on one line; a list after it becomes one piece each.
    const inline = /^([^:.!?]{2,40}):\s+(.+)$/.exec(line);
    let body = line;
    let lineHeading = heading;
    if (inline && !/\b(?:by|due|on|at)$/i.test(inline[1])) {
      lineHeading = inline[1].trim();
      body = inline[2];
      if (body.includes(',') && !/[.!?]\s/.test(body)) {
        for (const item of body.replace(/[.!?]+$/, '').split(/\s*,\s*(?:and\s+)?|\s+and\s+/)) {
          if (item.trim()) out.push({ heading: lineHeading, text: item.trim(), listItem: true });
        }
        continue;
      }
    }
    // Sentences, then "; " lists.
    for (const sentence of body.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
      for (const part of sentence.split(/\s*;\s*/)) {
        const text = part.trim().replace(/[.!?]+$/, '').trim();
        if (text) out.push({ heading: lineHeading, text });
      }
    }
  }
  return out;
}

function tidyTitle(t: string): string {
  let s = t.replace(LEAD_IN, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(?:to|a task to)\s+/i, '');
  if (s) s = s.charAt(0).toUpperCase() + s.slice(1);
  return s.length > 200 ? `${s.slice(0, 197)}…` : s;
}

function looksLikeWork(text: string, listItem = false): boolean {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < (listItem ? 1 : 2)) return false;
  if (NOT_WORK.test(text)) return false;
  return true;
}

/** A draft plan from a brief. `today` turns "Friday" or "in 2 weeks" into dates. */
export function draftPlanFromBrief(brief: string, today: Date = new Date()): DraftPlan {
  const tasks: DraftTask[] = [];
  const skipped: string[] = [];
  for (const piece of splitBrief(brief)) {
    const cleaned = piece.text.replace(LEAD_IN, '');
    if ((piece.heading && CONTEXT_HEADING.test(piece.heading)) || !looksLikeWork(cleaned, piece.listItem)) {
      skipped.push(piece.text);
      continue;
    }
    if (tasks.length >= MAX_DRAFT_TASKS) {
      skipped.push(piece.text);
      continue;
    }
    const parsed = parseTaskPhrase(cleaned, today);
    const title = tidyTitle(parsed.title ?? cleaned);
    if (!title) {
      skipped.push(piece.text);
      continue;
    }
    // "after the designs are done" / "once X" → waits on the task before it (only when it clearly says so).
    const waits = /\b(?:after|once|when)\b.+\b(?:done|finished|ready|approved|signed off)\b/i.test(piece.text) && tasks.length > 0 ? [tasks.length - 1] : [];
    tasks.push({
      title,
      description: piece.heading ? `Part of: ${piece.heading}` : null,
      priority: parsed.priority,
      dueDate: parsed.due,
      assigneeName: parsed.assignee,
      estimateDays: parsed.estimate,
      dependsOn: waits,
      source: piece.text,
    });
  }
  const gaps: string[] = [];
  if (tasks.length) {
    const noOwner = tasks.filter((t) => !t.assigneeName).length;
    const noDate = tasks.filter((t) => !t.dueDate).length;
    const noEstimate = tasks.filter((t) => !t.estimateDays).length;
    if (noOwner) gaps.push(`The brief doesn’t name an owner for ${noOwner === tasks.length ? 'any task' : `${noOwner} of the ${tasks.length} tasks`}, so they’re left unassigned.`);
    if (noDate) gaps.push(`No due date is given for ${noDate === tasks.length ? 'any task' : `${noDate} of them`}; I haven’t made any up.`);
    if (noEstimate) gaps.push(`No estimates for ${noEstimate === tasks.length ? 'any task' : `${noEstimate} of them`}, so forecasts will assume a default length until someone estimates them.`);
  }
  return { tasks, skipped, gaps };
}

/** The brief itself from what was typed: the words after "Plan a project:" (line breaks kept). */
export function briefFrom(raw: string): string {
  const m = /^\s*(?:hey\s+flurry[\s,]*)?(?:please\s+)?(?:plan(?:\s+(?:a|the|this|my|our)\s+(?:new\s+)?project)?|draft\s+(?:a\s+|the\s+)?(?:project\s+)?plan|make\s+(?:a\s+)?plan|turn\s+(?:this|the|my|a)\s+brief\s+into\s+(?:a\s+)?(?:plan|tasks))\b\s*(?:for|from|of|with)?\s*[:\-–—]?\s*/i.exec(raw);
  return (m ? raw.slice(m[0].length) : raw).trim();
}
