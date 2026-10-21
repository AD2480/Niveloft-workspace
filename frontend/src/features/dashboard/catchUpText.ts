import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { ActivityType, CatchUp } from '@/api/types';

/** The kinds of change worth a word, in the order a reader cares about them. */
const PHRASES: [ActivityType, (n: number) => string][] = [
  ['REVIEW_APPROVED', (n) => `${n} approved`],
  ['SUBMISSION_CREATED', (n) => `${n} submitted for review`],
  ['REVIEW_CHANGES_REQUESTED', (n) => `${n} sent back for changes`],
  ['TASK_CREATED', (n) => `${n} new ${n === 1 ? 'task' : 'tasks'}`],
  ['TASK_STATUS_CHANGED', (n) => `${n} moved on the board`],
  ['COMMENT_ADDED', (n) => `${n} ${n === 1 ? 'comment' : 'comments'}`],
  ['TASK_ASSIGNED', (n) => `${n} ${n === 1 ? 'assignment' : 'assignments'}`],
  ['PLAN_APPLIED', (n) => `${n} ${n === 1 ? 'plan' : 'plans'} applied`],
  ['MEMBER_JOINED', (n) => `${n} ${n === 1 ? 'person' : 'people'} joined`],
];
const NAMED = new Set<ActivityType>(PHRASES.map(([t]) => t));

/** "2 approved, 3 submitted for review and 4 comments." from the counts (nothing estimated). */
export function catchUpSentence(c: Pick<CatchUp, 'counts' | 'dueDateChanges'>): string | null {
  const parts = PHRASES.flatMap(([type, say]) => (c.counts[type] ? [say(c.counts[type]!)] : []));
  if (c.dueDateChanges) parts.push(`${c.dueDateChanges} due ${c.dueDateChanges === 1 ? 'date' : 'dates'} changed`);
  // Everything else (edits to details, criteria, milestones…) is counted, not itemised.
  const other = Object.entries(c.counts).reduce((sum, [type, n]) => (NAMED.has(type as ActivityType) ? sum : sum + (n ?? 0)), 0) - c.dueDateChanges;
  if (other > 0) parts.push(`${other} other ${other === 1 ? 'change' : 'changes'}`);
  if (!parts.length) return null;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `${list[0].toUpperCase()}${list.slice(1)}.`;
}

/** The moment, to follow "Since you were last here": "yesterday at 18:00", "on Saturday at 18:00", "on 4 October". */
export function sinceWords(iso: string, now: Date = new Date()): string {
  const d = parseISO(iso);
  const days = differenceInCalendarDays(now, d);
  if (days <= 0) return `today at ${format(d, 'HH:mm')}`;
  if (days === 1) return `yesterday at ${format(d, 'HH:mm')}`;
  if (days < 7) return `on ${format(d, 'EEEE')} at ${format(d, 'HH:mm')}`;
  return `on ${format(d, 'd MMMM')}`;
}
