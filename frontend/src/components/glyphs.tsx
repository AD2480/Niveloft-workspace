import { useId } from 'react';
import type { Priority, TaskStatus } from '@/api/types';
import { cn } from '@/lib/cn';
import { PRIORITY_LABEL, STATUS_LABEL } from '@/lib/constants';

/**
 * Niveloft's own small marks, drawn for this product rather than taken from an icon set.
 *
 * A task's state is a snow gauge: a round window that fills from the bottom as the work settles.
 * Empty is fresh snow (not started), a third is settling (in progress), two thirds is waiting for a
 * decision (in review), and full, with a tick, is firm (approved). The fill level says the state on
 * its own, so it reads without colour too; the colour is the layer's. Late work gets a red pip on
 * the rim: the weak layer.
 */
const FILL: Record<TaskStatus, number> = { TODO: 0, IN_PROGRESS: 0.36, IN_REVIEW: 0.68, DONE: 1 };
const TONE: Record<TaskStatus, string> = {
  TODO: 'var(--strata-todo)',
  IN_PROGRESS: 'var(--strata-progress)',
  IN_REVIEW: 'var(--strata-review)',
  DONE: 'var(--strata-done)',
};

export function StatusGlyph({
  status,
  late = false,
  className,
  label = false,
}: {
  status: TaskStatus;
  /** Late work gets a red pip on the rim: the weak layer. */
  late?: boolean;
  className?: string;
  /** Give it its own accessible name (when no text beside it says the state). */
  label?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const c = 7;
  const r = 5.6;
  const fill = FILL[status];
  const top = c + r - 2 * r * fill;
  // The rim a shade deeper than the layer's colour, so even the empty gauge stands out (3:1).
  const rim = `color-mix(in oklab, ${TONE[status]} ${status === 'TODO' ? 58 : 80}%, var(--ink))`;
  return (
    <svg
      viewBox="0 0 14 14"
      className={cn('size-3.5 shrink-0', className)}
      role={label ? 'img' : undefined}
      aria-label={label ? `${STATUS_LABEL[status]}${late ? ', late' : ''}` : undefined}
      aria-hidden={label ? undefined : true}
      data-status-glyph={status}
    >
      <defs>
        <clipPath id={`gauge-${id}`}>
          <circle cx={c} cy={c} r={r} />
        </clipPath>
      </defs>
      {fill > 0 && <rect x={0} y={top} width={14} height={14 - top} fill={TONE[status]} clipPath={`url(#gauge-${id})`} />}
      {/* The level where the settled snow ends, so a third and two thirds read apart at a glance. */}
      {fill > 0 && fill < 1 && <line x1={c - r} x2={c + r} y1={top} y2={top} stroke="var(--surface)" strokeWidth={0.9} clipPath={`url(#gauge-${id})`} />}
      <circle cx={c} cy={c} r={r - 0.6} fill="none" style={{ stroke: rim }} strokeWidth={1.25} />
      {status === 'DONE' && <path d="M4.6 7.2 6.3 8.8 9.5 5.5" fill="none" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />}
      {late && <circle cx={11.2} cy={2.8} r={2.4} fill="var(--strata-weak)" stroke="var(--surface)" strokeWidth={1.1} />}
    </svg>
  );
}

/**
 * Priority as three bars that fill left to right (low one, medium two, high three), and urgent as
 * the same bars knocked out of a red tile, so it differs in shape as well as colour.
 */
const LEVEL: Record<Priority, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, URGENT: 3 };

export function PriorityGlyph({ priority, className, label = true }: { priority: Priority; className?: string; label?: boolean }) {
  const urgent = priority === 'URGENT';
  const level = LEVEL[priority];
  const bars = [
    { x: 2.5, h: 4 },
    { x: 6, h: 6.5 },
    { x: 9.5, h: 9 },
  ];
  return (
    <svg
      viewBox="0 0 14 14"
      className={cn('size-3.5 shrink-0', className)}
      role={label ? 'img' : undefined}
      aria-label={label ? `${PRIORITY_LABEL[priority]} priority` : undefined}
      aria-hidden={label ? undefined : true}
      data-priority-glyph={priority}
    >
      {urgent && <rect x={0.5} y={0.5} width={13} height={13} rx={3.5} fill="var(--danger)" />}
      {bars.map((b, i) => {
        const on = i < level;
        const top = (urgent ? 11 : 12) - b.h * (urgent ? 0.82 : 1);
        return (
          <rect
            key={b.x}
            x={b.x}
            y={top}
            width={2}
            height={(urgent ? 11 : 12) - top}
            rx={0.8}
            fill={urgent ? '#fff' : on ? 'var(--ink-2)' : 'var(--line-strong)'}
            opacity={urgent || on ? 1 : 0.9}
          />
        );
      })}
    </svg>
  );
}

/** How one of Flurry's lookups went (see AiLookup). */
export type LookupResult = 'found' | 'nothing' | 'unavailable' | 'declined';

/**
 * A probe mark for one of Flurry's lookups: filled when it found records; an empty ring when it
 * looked and the records show nothing; a broken ring when it couldn't look, so the answer is
 * unknown rather than "no"; a struck ring for a suggestion that wasn't noted. The shape says it
 * without colour; the words beside it say it to screen readers.
 */
export function LookupGlyph({ result, className }: { result: LookupResult; className?: string }) {
  const c = 6;
  const r = 3.9;
  return (
    <svg viewBox="0 0 12 12" className={cn('size-3 shrink-0', className)} aria-hidden="true" data-lookup-glyph={result}>
      {result === 'found' ? (
        <circle cx={c} cy={c} r={r + 0.4} fill="var(--accent)" />
      ) : (
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={result === 'unavailable' ? 'var(--warning)' : 'var(--muted)'}
          strokeWidth={1.25}
          strokeDasharray={result === 'unavailable' ? '2.2 1.7' : undefined}
        />
      )}
      {result === 'declined' && <line x1={c - r - 0.6} y1={c + r + 0.6} x2={c + r + 0.6} y2={c - r - 0.6} stroke="var(--muted)" strokeWidth={1.25} strokeLinecap="round" />}
    </svg>
  );
}
