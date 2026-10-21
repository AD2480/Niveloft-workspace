import * as RD from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Prevent closing by clicking outside (e.g. while a form is submitting). */
  dismissible?: boolean;
  /** 'alertdialog' for questions that need an answer (confirmations). */
  role?: 'dialog' | 'alertdialog';
}

const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

export function Dialog({ open, onOpenChange, title, description, children, footer, size = 'md', dismissible = true, role = 'dialog' }: DialogProps) {
  return (
    <RD.Root open={open} onOpenChange={(o) => (dismissible || o ? onOpenChange(o) : undefined)}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-[rgb(8_18_27/0.42)] backdrop-blur-[3px] animate-fade-in dark:bg-black/60" />
        <RD.Content
          role={role}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col',
            'rounded-2xl border border-line bg-surface shadow-float animate-pop-in focus:outline-none dark:bg-surface-2',
            widths[size],
          )}
          onInteractOutside={(e) => {
            if (!dismissible) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (!dismissible) e.preventDefault();
          }}
        >
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
            <div className="min-w-0">
              <RD.Title className="text-[17px] leading-snug font-semibold text-ink">{title}</RD.Title>
              {description ? (
                <RD.Description className="mt-1 text-[13.5px] leading-relaxed text-muted">{description}</RD.Description>
              ) : (
                <RD.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</RD.Description>
              )}
            </div>
            <RD.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close" disabled={!dismissible} className="-mt-1 -mr-1.5">
                <X />
              </Button>
            </RD.Close>
          </div>
          {children && <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-6 pt-1 pb-5">{children}</div>}
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 rounded-b-2xl border-t border-line bg-surface-2/60 px-6 py-3.5 dark:bg-surface/40">{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

interface ConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void | Promise<unknown>;
}

/**
 * Asks before something that can't be undone (or loses work). The safe choice comes first and
 * Enter doesn't confirm by accident: the confirm button has to be pressed.
 */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'danger', loading, onConfirm }: ConfirmProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="sm"
      role="alertdialog"
      dismissible={!loading}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading} data-confirm-cancel="">
            {cancelLabel}
          </Button>
          <Button variant={tone} loading={loading} onClick={() => void onConfirm()} data-confirm-ok="">
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-ink-2">{description}</div>
    </Dialog>
  );
}
