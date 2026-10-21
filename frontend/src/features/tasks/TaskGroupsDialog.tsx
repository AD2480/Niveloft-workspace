import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Task } from '@/api/types';
import { DueDate, PriorityIcon, StatusBadge } from '@/components/domain';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { todayIso } from '@/lib/dates';
import { groupTasks, type GroupBy } from '@/lib/taskGroups';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** undefined while loading. */
  tasks: Task[] | undefined;
  initialGroup?: GroupBy;
  /** Shows each task's status (for lists that mix statuses, e.g. overdue). */
  showStatus?: boolean;
  /** "Open in task list" target, relative to the project. */
  listLink?: string;
  /** Open a task in place (e.g. the board's side panel) instead of following a link. */
  onOpenTask?: (task: Task) => void;
}

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'person', label: 'Person' },
  { value: 'due', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
];

/**
 * A tidy pop-up list of tasks: grouped (by person, due date or priority), each group counted,
 * every row in the same columns and the same order, so nothing has to be hunted for.
 */
export function TaskGroupsDialog({ open, onOpenChange, title, description, tasks, initialGroup = 'person', showStatus = false, listLink, onOpenTask }: Props) {
  const [by, setBy] = useState<GroupBy>(initialGroup);
  const groups = useMemo(() => (tasks ? groupTasks(tasks, by, todayIso()) : []), [tasks, by]);
  const overdue = tasks?.filter((t) => t.overdue).length ?? 0;
  const people = new Set(tasks?.map((t) => t.assignee?.id ?? 0)).size;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="lg"
      footer={
        <>
          {listLink && (
            <Link to={listLink} onClick={() => onOpenChange(false)} className="mr-auto inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline">
              Open in the task list
            </Link>
          )}
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </>
      }
    >
      {!tasks ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12.5px] text-muted tabular">
              {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
              {tasks.length > 0 && (
                <>
                  {' '}
                  , {people} {people === 1 ? 'person' : 'people'}
                  {overdue > 0 && <span className="text-danger">, {overdue} overdue</span>}
                </>
              )}
            </p>
            {tasks.length > 0 && <Segmented label="Group by" value={by} onChange={setBy} options={GROUP_OPTIONS} />}
          </div>

          {tasks.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center text-[13px] text-muted">No tasks here.</p>
          ) : (
            groups.map((g) => (
              <section key={g.key} aria-label={`${g.label}, ${g.tasks.length}`} className="overflow-hidden rounded-lg border border-line">
                <header className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
                  {g.user !== undefined && <Avatar user={g.user} size="xs" />}
                  <h3 className={cn('text-[13px] font-semibold', g.tone === 'danger' ? 'text-danger' : g.tone === 'warning' ? 'text-warning' : 'text-ink')}>{g.label}</h3>
                  <span className="ml-auto rounded-full bg-surface-3 px-2 text-xs font-medium text-muted tabular">{g.tasks.length}</span>
                </header>
                <ul className="divide-y divide-line">
                  {g.tasks.map((t) => (
                    <li key={t.id}>
                      <TaskRow task={t} showStatus={showStatus} onOpenTask={onOpenTask ? (x) => (onOpenChange(false), onOpenTask(x)) : undefined} />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}
    </Dialog>
  );
}

/** One row, in fixed columns: priority · key · title · (status) · due. */
function TaskRow({ task, showStatus, onOpenTask }: { task: Task; showStatus: boolean; onOpenTask?: (t: Task) => void }) {
  const inner = (
    <>
      <PriorityIcon priority={task.priority} />
      <span className="w-16 shrink-0 font-mono text-[12px] text-muted">{task.key}</span>
      <span className="min-w-0 flex-1 truncate text-left text-[13px] text-ink">{task.title}</span>
      {showStatus && (
        <span className="hidden shrink-0 sm:block">
          <StatusBadge status={task.status} late={task.overdue} />
        </span>
      )}
      <DueDate date={task.dueDate} done={task.status === 'DONE'} showIcon={false} className="w-24 shrink-0 justify-end text-right text-xs" />
    </>
  );
  const cls = 'flex w-full items-center gap-3 px-3 py-2 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2';
  return onOpenTask ? (
    <button type="button" className={cls} onClick={() => onOpenTask(task)}>
      {inner}
    </button>
  ) : (
    <Link to={`/projects/${task.projectId}/tasks/${task.id}`} className={cls}>
      {inner}
    </Link>
  );
}
