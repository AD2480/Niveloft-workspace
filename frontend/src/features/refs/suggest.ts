/**
 * Suggestions while writing: what's being typed before the caret (a mention or a task link), and
 * the people or tasks that match it. Pure, so it's tested.
 */
import type { Member, Task } from '@/api/types';

/** What's being typed right before the caret, if it's a mention (@…) or a task link (#…). */
export function triggerAt(text: string, caret: number): { kind: '@' | '#'; start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(?:^|[\s([{,;])([@#])([^\s@#()[\]{}]{0,30}(?: [^\s@#()[\]{}]{0,20})?)$/u.exec(before);
  if (!m) return null;
  const start = caret - m[2].length - 1;
  return { kind: m[1] as '@' | '#', start, query: m[2] };
}

/** People whose name (or any word of it) starts with what's typed. */
export function matchPeople(members: Member[], query: string): Member[] {
  const q = query.trim().toLowerCase();
  return members
    .filter(
      (m) =>
        !q ||
        m.user.name.toLowerCase().startsWith(q) ||
        m.user.name
          .toLowerCase()
          .split(/\s+/)
          .some((w) => w.startsWith(q)),
    )
    .slice(0, 6);
}

/** Tasks whose key or title matches what's typed: keys first, then titles. */
export function matchTasks(tasks: Task[], query: string): Task[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...tasks].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 6);
  const byKey = tasks.filter((t) => t.key.toLowerCase().startsWith(q) || t.key.toLowerCase().split('-')[1]?.startsWith(q));
  const byTitle = tasks.filter((t) => !byKey.includes(t) && t.title.toLowerCase().includes(q));
  return [...byKey, ...byTitle].slice(0, 6);
}
