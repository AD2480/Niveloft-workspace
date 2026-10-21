import { Link } from 'react-router';
import { useBoardTasksQuery, useProjectsQuery } from '@/api/endpoints';
import type { Task } from '@/api/types';
import { useAppSelector } from '@/app/store';
import { DueDate } from '@/components/domain';
import { PriorityGlyph, StatusGlyph } from '@/components/glyphs';
import { Avatar } from '@/components/ui/Avatar';
import { HoverCard } from '@/components/ui/HoverCard';
import { cn } from '@/lib/cn';
import { PRIORITY_LABEL, STATUS_LABEL } from '@/lib/constants';
import { daysUntil } from '@/lib/dates';
import { plainText } from '@/lib/richText';

export type TaskRefState = { state: 'loading' } | { state: 'found'; task: Task } | { state: 'missing' };

/**
 * Finds the task a key names, among the projects you belong to: the key's prefix is the project's
 * key, and the project's tasks (the board's list, cached) hold the rest. A key from a project you
 * can't see, or one that doesn't exist, is "missing" (the two aren't told apart).
 */
export function useTaskRef(key: string): TaskRefState {
  const signedIn = useAppSelector((s) => s.auth.token !== null);
  const prefix = key.slice(0, key.lastIndexOf('-'));
  const projects = useProjectsQuery({ size: 100 }, { skip: !signedIn });
  const project = projects.data?.content.find((p) => p.key === prefix);
  const board = useBoardTasksQuery(project?.id ?? 0, { skip: !project });
  if (!signedIn) return { state: 'missing' };
  if (projects.isLoading || (project && board.isLoading)) return { state: 'loading' };
  const task = board.data?.find((t) => t.key === key);
  return task ? { state: 'found', task } : { state: 'missing' };
}

/** What a task looks like at a glance: its state, title, owner, due date and priority. */
export function TaskPreview({ task }: { task: Task }) {
  const late = task.overdue && task.dueDate ? -daysUntil(task.dueDate) : 0;
  const summary = task.description ? plainText(task.description) : '';
  return (
    <div className="space-y-2.5" data-task-preview={task.key}>
      <p className="flex items-center gap-2 text-[12px] text-muted">
        <StatusGlyph status={task.status} late={task.overdue} />
        <span className="shrink-0 font-medium whitespace-nowrap text-ink-2 tabular">{task.key}</span>
        <span className="shrink-0 whitespace-nowrap">{STATUS_LABEL[task.status]}</span>
        <span className="ml-auto min-w-0 truncate">{task.projectName}</span>
      </p>
      <p className="text-[14px] leading-snug font-semibold text-ink">{task.title}</p>
      {summary && <p className="line-clamp-2 text-[12.5px] leading-relaxed text-muted">{summary}</p>}
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-t border-line pt-2.5 text-[12.5px] text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <Avatar user={task.assignee} size="xs" />
          {task.assignee ? task.assignee.name : <span className="text-warning">No owner</span>}
        </span>
        <DueDate date={task.dueDate} done={task.status === 'DONE'} className="text-[12.5px]" />
        <span className="inline-flex items-center gap-1">
          <PriorityGlyph priority={task.priority} label={false} />
          {PRIORITY_LABEL[task.priority]}
        </span>
      </div>
      {late > 0 && <p className="text-[12.5px] font-medium text-danger">{late === 1 ? '1 day late' : `${late} days late`}</p>}
    </div>
  );
}

/**
 * A task key written in text (a description, a comment, a review), as a link to the task with a
 * preview on hover or focus. Keys you can't open stay plain text.
 */
export function TaskRef({ taskKey, className }: { taskKey: string; className?: string }) {
  const ref = useTaskRef(taskKey);
  if (ref.state !== 'found') {
    return (
      <span
        className={cn('font-medium tabular', ref.state === 'loading' ? 'text-ink-2' : 'text-ink-2 decoration-line-strong decoration-dotted', className)}
        title={ref.state === 'missing' ? 'Not a task you can open (it may be in a project you’re not in, or not exist)' : undefined}
        data-task-ref={taskKey}
        data-task-ref-state={ref.state}
      >
        {taskKey}
      </span>
    );
  }
  const t = ref.task;
  return (
    <HoverCard content={<TaskPreview task={t} />}>
      {(p) => (
        <Link
          to={`/projects/${t.projectId}/tasks/${t.id}`}
          {...p}
          className={cn(
            'inline-flex items-baseline gap-1 rounded-[5px] px-0.5 font-medium text-accent tabular decoration-accent/40 underline-offset-2 hover:underline focus-visible:underline',
            t.status === 'DONE' && 'text-ink-2',
            className,
          )}
          data-task-ref={taskKey}
          data-task-ref-state="found"
        >
          <StatusGlyph status={t.status} late={t.overdue} className="size-3 self-center" />
          {taskKey}
        </Link>
      )}
    </HoverCard>
  );
}
