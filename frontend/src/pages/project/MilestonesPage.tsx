import { CheckCircle2, Circle, Flag, ListTodo, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useDeleteMilestoneMutation, useMilestonesQuery, useUpdateMilestoneMutation } from '@/api/endpoints';
import { getErrorMessage } from '@/api/errors';
import type { Milestone } from '@/api/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { ProgressBar } from '@/components/ui/Progress';
import { Skeleton } from '@/components/ui/Spinner';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { MilestoneFormDialog } from '@/features/projects/MilestoneFormDialog';
import { useProjectContext } from '@/features/projects/projectContext';
import { cn } from '@/lib/cn';
import { daysUntil, dueRelative, formatDate, timeAgo, todayIso } from '@/lib/dates';
import { can } from '@/lib/permissions';

export function MilestonesPage() {
  const { project, openNewTask } = useProjectContext();
  const { data, isLoading, isError, error, refetch } = useMilestonesQuery(project.id);
  const [update] = useUpdateMilestoneMutation();
  const [remove, removeState] = useDeleteMilestoneMutation();
  const [editing, setEditing] = useState<Milestone | null | 'new'>(null);
  const [deleting, setDeleting] = useState<Milestone | null>(null);
  const manage = can.manageMilestones(project.myRole);
  const today = todayIso();

  const toggle = async (m: Milestone) => {
    try {
      await update({ id: m.id, projectId: project.id, body: { name: m.name, description: m.description, dueDate: m.dueDate, completed: !m.completed } }).unwrap();
      toast.success(m.completed ? `“${m.name}” reopened` : `“${m.name}” completed`);
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const nextIndex = data?.findIndex((m) => !m.completed && m.dueDate >= today) ?? -1;

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-10">
      <div className="max-w-4xl">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">Milestones</h2>
            <p className="text-[13px] text-muted">Checkpoints on the way to the deadline. Progress is based on linked tasks.</p>
          </div>
          {manage && (
            <Button leftIcon={<Plus />} onClick={() => setEditing('new')}>
              New milestone
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : !data || data.length === 0 ? (
          <EmptyState
            icon={Flag}
            title="No milestones yet"
            description={manage ? 'Add checkpoints such as “Design complete” or “Beta release” and link tasks to them.' : 'Managers can add milestones to this project.'}
            action={
              manage ? (
                <Button leftIcon={<Plus />} onClick={() => setEditing('new')}>
                  New milestone
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ol className="relative space-y-4 before:absolute before:top-4 before:bottom-4 before:left-[15px] before:w-px before:bg-line-strong">
            {data.map((m, i) => {
              const overdue = !m.completed && m.dueDate < today;
              const soon = !m.completed && !overdue && daysUntil(m.dueDate) <= 7;
              return (
                <li key={m.id} className="relative flex gap-4">
                  <button
                    type="button"
                    disabled={!manage}
                    onClick={() => void toggle(m)}
                    className={cn(
                      'relative z-10 mt-4 flex size-8 shrink-0 items-center justify-center rounded-full bg-surface ring-4 ring-canvas',
                      manage && 'hover:scale-110 transition-transform',
                    )}
                    aria-label={m.completed ? `Mark ${m.name} as not completed` : `Mark ${m.name} as completed`}
                    title={manage ? (m.completed ? 'Mark as not completed' : 'Mark as completed') : undefined}
                  >
                    {m.completed ? (
                      <CheckCircle2 className="size-7 text-success" />
                    ) : (
                      <Circle className={cn('size-7', i === nextIndex ? 'text-accent' : overdue ? 'text-danger' : 'text-line-strong')} />
                    )}
                  </button>
                  <div className={cn('flex-1 rounded-xl border bg-surface p-4 shadow-card', i === nextIndex ? 'border-brand/40' : 'border-line')}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className={cn('text-[15px] font-semibold text-ink', m.completed && 'text-muted')}>{m.name}</h3>
                          {m.completed && <Badge tone="success">Completed</Badge>}
                          {i === nextIndex && <Badge tone="brand">Next up</Badge>}
                          {overdue && <Badge tone="danger">Overdue</Badge>}
                          {soon && <Badge tone="warning">Due soon</Badge>}
                        </div>
                        <p className="mt-0.5 text-xs text-muted">
                          {formatDate(m.dueDate, 'EEEE, d MMMM yyyy')}
                          {!m.completed && `, ${dueRelative(m.dueDate).toLowerCase()}`}
                          {m.completed && m.completedAt && `, completed ${timeAgo(m.completedAt)}`}
                        </p>
                      </div>
                      {manage && (
                        <Menu>
                          <MenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${m.name}`}>
                              <MoreHorizontal />
                            </Button>
                          </MenuTrigger>
                          <MenuContent>
                            <MenuItem icon={<Pencil />} onSelect={() => setEditing(m)}>
                              Edit
                            </MenuItem>
                            <MenuItem icon={<Plus />} onSelect={() => openNewTask({ milestoneId: m.id })}>
                              Add task to milestone
                            </MenuItem>
                            <MenuSeparator />
                            <MenuItem icon={<Trash2 />} danger onSelect={() => setDeleting(m)}>
                              Delete
                            </MenuItem>
                          </MenuContent>
                        </Menu>
                      )}
                    </div>
                    {m.description && <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{m.description}</p>}
                    <div className="mt-3 flex items-center gap-3">
                      <ProgressBar value={m.progress} color={m.completed ? 'var(--success)' : project.color} label={`${m.name} progress`} />
                      <span className="shrink-0 text-xs font-medium text-ink tabular">{m.progress}%</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted">
                      <span>
                        {m.doneCount} of {m.taskCount} tasks done
                      </span>
                      {m.taskCount > 0 && (
                        <Link
                          to={`../tasks?milestone=${m.id}`}
                          relative="path"
                          className="-my-1 inline-flex min-h-6 items-center gap-1 py-1 font-medium text-accent hover:underline"
                        >
                          <ListTodo className="size-3.5" aria-hidden="true" /> View tasks
                        </Link>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <MilestoneFormDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} projectId={project.id} milestone={editing === 'new' ? null : editing} />
        <ConfirmDialog
          open={deleting !== null}
          onOpenChange={(o) => !o && setDeleting(null)}
          title={`Delete “${deleting?.name}”?`}
          description="Tasks linked to this milestone are kept but will no longer belong to a milestone."
          confirmLabel="Delete milestone"
          loading={removeState.isLoading}
          onConfirm={async () => {
            if (!deleting) return;
            try {
              await remove({ id: deleting.id, projectId: project.id }).unwrap();
              toast.success('Milestone deleted');
              setDeleting(null);
            } catch (e) {
              toast.error(getErrorMessage(e));
            }
          }}
        />
      </div>
    </div>
  );
}
