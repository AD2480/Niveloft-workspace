import { createContext, useContext, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * How cards draw themselves. Inside a document (the task page), the same components become plain
 * sections, a heading and its content on the page, instead of boxes stacked on boxes.
 */
const Look = createContext<'card' | 'section'>('card');

/** Cards inside this render as document sections. */
export function DocumentSections({ children }: { children: ReactNode }) {
  return <Look.Provider value="section">{children}</Look.Provider>;
}

/** Whether the component is drawn inside a document (see {@link DocumentSections}). */
export function useInDocument() {
  return useContext(Look) === 'section';
}

/** A surface for one group of related things: white on the snow canvas, a hairline and a whisper of shadow. */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const doc = useInDocument();
  if (doc) return <section className={cn('min-w-0', className)} data-doc-section="" {...rest} />;
  return <div className={cn('rounded-lg border border-line bg-surface shadow-card [&>*:first-child]:rounded-t-[inherit] [&>*:last-child]:rounded-b-[inherit]', className)} {...rest} />;
}

export function CardHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  const doc = useInDocument();
  return (
    // Spacing, not a divider, separates the title from the content.
    <div className={cn('flex items-start justify-between gap-3', doc ? 'pb-3' : 'px-4 pt-4 pb-1 sm:px-5 sm:pt-5', className)}>
      <div className="min-w-0">
        <h2 className={cn('leading-snug font-semibold text-ink', doc ? 'text-[14px]' : 'text-[15px]')}>{title}</h2>
        {description && <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const doc = useInDocument();
  return <div className={cn(doc ? '' : 'px-4 py-4 sm:px-5 sm:pt-4 sm:pb-5', className)} {...rest} />;
}
