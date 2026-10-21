import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Page header: the title in Archivo (a little wide), an optional one-line description, and the
 * page's actions aligned to the title's baseline. `eyebrow` is a quiet line of context above the
 * title (today's date, say), never a repeat of the page's name.
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-4 pb-7 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="text-[28px] text-ink sm:text-[32px]">{title}</h1>
        {description && <p className="mt-2 max-w-[68ch] text-[14.5px] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2" data-print="hide">
          {actions}
        </div>
      )}
    </div>
  );
}
