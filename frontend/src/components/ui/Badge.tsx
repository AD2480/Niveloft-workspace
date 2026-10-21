import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-ink-2',
  brand: 'bg-brand-soft text-brand-ink',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

/** A small state word ("At risk", "Owner"): a soft pill in its tone's colour. */
export function Badge({ tone = 'neutral', className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn('inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full px-2 text-[12px] leading-none font-medium whitespace-nowrap [&_svg]:size-3', tones[tone], className)}
      {...rest}
    />
  );
}

/** Small numeric pill, e.g. unread counts in navigation. */
export function CountPill({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span className={cn('inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white tabular dark:text-canvas', className)}>
      {count > 99 ? '99+' : count}
    </span>
  );
}
