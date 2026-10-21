import { AlertTriangle, MessageCircle, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { getErrorMessage, getRequestId } from '@/api/errors';
import { openContact } from '@/features/contact/contactStore';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { useInDocument } from './Card';
import { CopyButton } from './CopyButton';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({ icon: Icon, title, description, action, className, compact }: EmptyStateProps) {
  const inDocument = useInDocument();
  // In a document, emptiness is a line of text, not a centred illustration.
  if (inDocument) {
    return (
      <div className={cn('flex items-start gap-2.5 text-[13px] leading-relaxed', className)} data-empty-state="">
        <Icon className="mt-[3px] size-4 shrink-0 text-subtle" strokeWidth={1.75} aria-hidden="true" />
        <p className="min-w-0 flex-1 text-muted">
          <span className="font-medium text-ink-2">{title}.</span>
          {description && <> {description}</>}
        </p>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    );
  }
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'px-4 py-8' : 'px-6 py-14', className)}>
      <div
        className={cn(
          'flex items-center justify-center rounded-full bg-gradient-to-b from-surface to-surface-3 text-muted shadow-[0_1px_2px_hsl(var(--shadow-color)/0.08),inset_0_0_0_1px_var(--line)] dark:from-surface-3 dark:to-surface-2',
          compact ? 'size-10' : 'size-14',
        )}
      >
        <Icon className={compact ? 'size-[18px]' : 'size-6'} strokeWidth={1.75} aria-hidden="true" />
      </div>
      <h3 className={cn('font-semibold text-ink', compact ? 'mt-3 text-[14px]' : 'mt-5 text-[16px]')}>{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/**
 * A failed load: what went wrong in plain words, a way to try again and, when the server gave the
 * failure a reference, the reference with a copy button and a way to report it.
 */
export function ErrorState({ error, onRetry, title = 'Couldn’t load this', className }: { error: unknown; onRetry?: () => void; title?: string; className?: string }) {
  const reference = getRequestId(error);
  const message = getErrorMessage(error).replace(/ \(Reference: [^)]+\)$/, '');
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)} data-error-state="">
      <div className="flex size-14 items-center justify-center rounded-full bg-danger-soft text-danger ring-1 ring-danger/20">
        <AlertTriangle className="size-6" aria-hidden="true" />
      </div>
      <h3 className="mt-4 text-[15px] font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-md text-[13px] text-muted">{message}</p>
      {reference && (
        <p className="mt-3 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-[12px] text-muted">
          Reference <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[12px] text-ink-2">{reference}</code>
          <CopyButton text={reference} what="the reference" iconOnly />
        </p>
      )}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
        {reference && (
          <Button variant="ghost" size="sm" leftIcon={<MessageCircle aria-hidden="true" />} onClick={() => openContact({ topic: 'PROBLEM', reference })}>
            Report this problem
          </Button>
        )}
      </div>
    </div>
  );
}
