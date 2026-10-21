import { Check } from 'lucide-react';
import type { TaskStatus } from '@/api/types';
import { cn } from '@/lib/cn';
import { STATUS_LABEL, TASK_STATUSES } from '@/lib/constants';

/** Visualises To Do → In Progress → In Review → Done with the current step highlighted. */
export function WorkflowStepper({ status }: { status: TaskStatus }) {
  const current = TASK_STATUSES.indexOf(status);
  return (
    <ol className="flex items-center gap-1.5" aria-label="Workflow">
      {TASK_STATUSES.map((s, i) => {
        const done = i < current || status === 'DONE';
        const active = i === current && status !== 'DONE';
        return (
          <li key={s} className="flex flex-1 items-center gap-1.5" aria-current={i === current ? 'step' : undefined}>
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold',
                done ? 'bg-success text-white dark:text-canvas' : active ? 'bg-brand text-white ring-4 ring-brand/20 dark:text-canvas' : 'bg-surface-3 text-muted',
              )}
            >
              {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <span className={cn('hidden text-xs font-medium whitespace-nowrap sm:inline', active ? 'text-ink' : done ? 'text-ink-2' : 'text-muted')}>{STATUS_LABEL[s]}</span>
            {i < TASK_STATUSES.length - 1 && <span className={cn('h-px flex-1', i < current ? 'bg-success' : 'bg-line-strong')} aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
