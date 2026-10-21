import type { TaskCounts } from '@/api/types';
import { cn } from '@/lib/cn';

export interface StrataCounts {
  /** Approved. */
  done: number;
  review: number;
  progress: number;
  /** Not started. */
  todo: number;
}

/** Late tasks in each open layer. */
export interface StrataLate {
  todo?: number;
  progress?: number;
  review?: number;
}

const ORDER = [
  { key: 'done', label: 'approved', color: 'var(--strata-done)' },
  { key: 'review', label: 'in review', color: 'var(--strata-review)' },
  { key: 'progress', label: 'in progress', color: 'var(--strata-progress)' },
  { key: 'todo', label: 'not started', color: 'var(--strata-todo)' },
] as const;

/** A project's task counts as the strata bar's layers. */
export function strataOf(c: TaskCounts): StrataCounts {
  return { done: c.done, review: c.inReview, progress: c.inProgress, todo: c.todo };
}

/** Where a project's late tasks are, layer by layer. */
export function lateOf(c: TaskCounts): StrataLate {
  return { todo: c.overdueTodo ?? 0, progress: c.overdueInProgress ?? 0, review: c.overdueInReview ?? 0 };
}

/** "6 approved, 1 in review, 4 in progress and 6 not started" (zero layers left out). */
export function strataSentence(c: StrataCounts): string {
  const parts = ORDER.filter((o) => c[o.key] > 0).map((o) => `${c[o.key]} ${o.label}`);
  if (!parts.length) return 'No tasks yet';
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The snowpack bar: a project's tasks as layers, approved first (firm snow), then the weak layer
 * (late work, taken out of the layers it's in), then in review, in progress and not started (fresh
 * snow), each in its colour and as wide as its share, separated by a hairline gap. It is the
 * project's block of snowpack laid flat: the same layers in the same order as every 3D view.
 */
export function StrataBar({
  counts,
  late,
  size = 'md',
  className,
  label,
}: {
  counts: StrataCounts;
  /** Late tasks in each open layer. */
  late?: StrataLate;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Accessible name; defaults to the counts in words. */
  label?: string;
}) {
  const total = ORDER.reduce((n, o) => n + counts[o.key], 0);
  const h = size === 'sm' ? 'h-1.5' : size === 'lg' ? 'h-3' : 'h-2';
  const lateIn = (k: keyof StrataLate) => Math.min(counts[k], Math.max(0, late?.[k] ?? 0));
  const weak = lateIn('todo') + lateIn('progress') + lateIn('review');
  const name = label ?? `${strataSentence(counts)}${weak ? `; ${weak} of them late` : ''}`;
  if (!total) return <div className={cn('w-full rounded-full bg-surface-3', h, className)} role="img" aria-label={name} />;
  const segments = [
    { key: 'done', n: counts.done, color: 'var(--strata-done)' },
    { key: 'weak', n: weak, color: 'var(--strata-weak)' },
    { key: 'review', n: counts.review - lateIn('review'), color: 'var(--strata-review)' },
    { key: 'progress', n: counts.progress - lateIn('progress'), color: 'var(--strata-progress)' },
    { key: 'todo', n: counts.todo - lateIn('todo'), color: 'var(--strata-todo)' },
  ].filter((x) => x.n > 0);
  return (
    <div className={cn('flex w-full gap-[2px]', h, className)} role="img" aria-label={name} data-strata-bar="">
      {segments.map((x) => (
        <span
          key={x.key}
          className="block h-full first:rounded-l-full last:rounded-r-full"
          style={{ flexGrow: x.n, flexBasis: 0, minWidth: 4, backgroundColor: x.color }}
          data-strata-layer={x.key}
        />
      ))}
    </div>
  );
}

/** The legend for a strata bar: a small swatch and count per layer. */
export function StrataLegend({ counts, late, className }: { counts: StrataCounts; late?: number; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted', className)}>
      {ORDER.map((o) => (
        <li key={o.key} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[3px]" style={{ backgroundColor: o.color }} aria-hidden="true" />
          <span className="tabular font-medium text-ink-2">{counts[o.key]}</span> {o.label}
        </li>
      ))}
      {late ? (
        <li className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[3px] bg-strata-weak" aria-hidden="true" />
          <span className="tabular font-medium text-ink-2">{late}</span> late
        </li>
      ) : null}
    </ul>
  );
}
