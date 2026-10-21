import {
  differenceInCalendarDays,
  format,
  formatDistanceToNowStrict,
  isThisYear,
  isToday,
  isTomorrow,
  isYesterday,
  parseISO,
} from 'date-fns';

/** Today's date as `yyyy-MM-dd` in the user's local time zone. */
export function todayIso(now: Date = new Date()): string {
  return format(now, 'yyyy-MM-dd');
}

/** Parse a `yyyy-MM-dd` date as a local calendar date (not UTC midnight). */
export function parseLocalDate(iso: string): Date {
  return parseISO(iso.length === 10 ? `${iso}T00:00:00` : iso);
}

export function addDaysIso(iso: string, days: number): string {
  const d = parseLocalDate(iso);
  d.setDate(d.getDate() + days);
  return todayIso(d);
}

/** Calendar days from today until `iso` (negative when in the past). */
export function daysUntil(iso: string, now: Date = new Date()): number {
  return differenceInCalendarDays(parseLocalDate(iso), now);
}

/** "Today", "Tomorrow", "Yesterday", "Mon, 3 Mar" or "3 Mar 2025". */
export function formatDueDate(iso: string | null | undefined): string {
  if (!iso) return 'No due date';
  const d = parseLocalDate(iso);
  if (isToday(d)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  if (isYesterday(d)) return 'Yesterday';
  return isThisYear(d) ? format(d, 'EEE, d MMM') : format(d, 'd MMM yyyy');
}

export function formatDate(iso: string | null | undefined, pattern = 'd MMM yyyy'): string {
  if (!iso) return '—';
  return format(parseLocalDate(iso), pattern);
}

export function formatDateTime(iso: string): string {
  return format(parseISO(iso), "d MMM yyyy 'at' HH:mm");
}

/** "3m ago", "2h ago", "5d ago"; falls back to a date after 30 days. */
export function timeAgo(iso: string): string {
  const d = parseISO(iso);
  const days = differenceInCalendarDays(new Date(), d);
  if (days > 30) return isThisYear(d) ? format(d, 'd MMM') : format(d, 'd MMM yyyy');
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 45_000) return 'just now';
  return `${formatDistanceToNowStrict(d)
    .replace(/ seconds?/, 's')
    .replace(/ minutes?/, 'm')
    .replace(/ hours?/, 'h')
    .replace(/ days?/, 'd')} ago`;
}

/** A heading for the day something happened: "Today", "Yesterday", "Monday", "Monday 6 October". */
export function dayHeading(iso: string, now: Date = new Date()): string {
  const d = parseISO(iso);
  const days = differenceInCalendarDays(now, d);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return format(d, 'EEEE');
  return d.getFullYear() === now.getFullYear() ? format(d, 'EEEE d MMMM') : format(d, 'd MMMM yyyy');
}

/** Relative description for a due date: "Due in 3 days", "2 days overdue". */
export function dueRelative(iso: string): string {
  const n = daysUntil(iso);
  if (n === 0) return 'Due today';
  if (n === 1) return 'Due tomorrow';
  if (n > 1) return `Due in ${n} days`;
  if (n === -1) return '1 day overdue';
  return `${-n} days overdue`;
}
