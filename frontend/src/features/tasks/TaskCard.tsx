import { Flag, Lock, MessageSquare, Paperclip } from 'lucide-react';
import { forwardRef, useMemo, type HTMLAttributes } from 'react';
import { useDependenciesQuery } from '@/api/endpoints';
import type { Task } from '@/api/types';
import { DueDate, PriorityIcon } from '@/components/domain';
import { Avatar } from '@/components/ui/Avatar';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/cn';
import { PRIORITY_LABEL } from '@/lib/constants';

interface TaskCardProps extends HTMLAttributes<HTMLDivElement> {
  task: Task;
  dragging?: boolean;
  overlay?: boolean;
}

/** Compact task card used on the Kanban board. */
export const TaskCard = forwardRef<HTMLDivElement, TaskCardProps>(function TaskCard({ task, dragging, overlay, className, ...rest }, ref) {
  const done = task.status === 'DONE';
  // One shared request per project (RTK Query de-duplicates it across cards).
  const { data: deps } = useDependenciesQuery(task.projectId);
  const blockers = useMemo(() => (deps ?? []).filter((d) => d.blocked.id === task.id && d.blocker.status !== 'DONE').map((d) => d.blocker), [deps, task.id]);
  const lateBlocker = blockers.some((b) => b.overdue);
  return (
    <div
      ref={ref}
      data-task-key={overlay ? undefined : task.key}
      className={cn(
        'group relative rounded-lg border border-line bg-surface p-3 text-left shadow-card transition-shadow',
        'hover:border-line-strong hover:shadow-pop',
        task.overdue && 'border-l-[3px] border-l-danger',
        dragging && 'opacity-40',
        overlay && 'rotate-[1.5deg] cursor-grabbing shadow-pop ring-2 ring-brand/40',
        className,
      )}
      {...rest}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[12px] font-medium text-muted">{task.key}</span>
        <Tooltip content={`${PRIORITY_LABEL[task.priority]} priority`}>
          <span>
            <PriorityIcon priority={task.priority} className="size-3.5" />
          </span>
        </Tooltip>
      </div>
      <p className={cn('mt-1 line-clamp-3 text-[13.5px] leading-snug font-medium text-ink', done && 'text-ink-2')}>{task.title}</p>

      {!done && blockers.length > 0 && (
        <Tooltip content={`Waiting on ${blockers.map((b) => b.key).join(', ')}${lateBlocker ? ' (overdue)' : ''}`}>
          <p className={cn('mt-2 inline-flex items-center gap-1 text-[12px] font-medium', lateBlocker ? 'text-danger' : 'text-muted')}>
            <Lock className="size-3 shrink-0" aria-hidden="true" />
            Waiting on {blockers.length === 1 ? blockers[0].key : `${blockers.length} tasks`}
          </p>
        </Tooltip>
      )}

      {task.milestoneName && (
        <p className="mt-2 inline-flex max-w-full items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[12px] text-ink-2">
          <Flag className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{task.milestoneName}</span>
        </p>
      )}

      <div className="mt-2.5 flex items-center gap-3">
        {task.dueDate ? <DueDate date={task.dueDate} done={done} className="text-xs" /> : <span className="text-xs text-subtle">No due date</span>}
        <div className="ml-auto flex items-center gap-2.5 text-xs text-muted">
          {task.commentCount > 0 && (
            <span className="inline-flex items-center gap-0.5" aria-label={`${task.commentCount} comments`}>
              <MessageSquare className="size-3.5" aria-hidden="true" />
              <span className="tabular">{task.commentCount}</span>
            </span>
          )}
          {task.submissionCount > 0 && (
            <span className="inline-flex items-center gap-0.5" aria-label={`${task.submissionCount} submissions`}>
              <Paperclip className="size-3.5" aria-hidden="true" />
              <span className="tabular">{task.submissionCount}</span>
            </span>
          )}
          <Avatar user={task.assignee} size="sm" tooltip />
        </div>
      </div>
    </div>
  );
});
