import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface Option<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
}

/** Compact radio-group styled as a segmented control. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Option<T>[];
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-[10px] bg-surface-3 p-[3px]', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex h-7 pointer-coarse:h-9 items-center gap-1.5 rounded-[7px] px-2.5 text-[13px] font-medium whitespace-nowrap transition-[color,background-color,box-shadow] duration-150 [&_svg]:size-3.5',
              active ? 'bg-surface text-ink shadow-[0_1px_2px_hsl(var(--shadow-color)/0.12),0_0_0_1px_hsl(var(--shadow-color)/0.04)] dark:bg-surface-2 dark:shadow-none dark:ring-1 dark:ring-line-strong' : 'text-muted hover:text-ink',
            )}
          >
            {o.icon}
            {o.label}
            {o.count !== undefined && <span className={cn('tabular text-xs', active ? 'text-muted' : 'text-subtle')}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
