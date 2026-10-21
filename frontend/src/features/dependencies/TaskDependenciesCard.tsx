import { GitFork, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useAddDependencyMutation, useBoardTasksQuery, useDependenciesQuery, useRemoveDependencyMutation } from '@/api/endpoints';
import { getErrorMessage, getFieldErrors } from '@/api/errors';
import type { Dependency, DependencyTask, Task } from '@/api/types';
import { DueDate, StatusBadge } from '@/components/domain';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Select } from '@/components/ui/Form';
import { Skeleton } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { downstream } from '@/lib/dependencies';
import { ConfirmDialog } from '@/components/ui/Dialog';

function Row({ dep, side, canEdit, onRemove, busy }: { dep: Dependency; side: 'blocker' | 'blocked'; canEdit: boolean; onRemove: () => void; busy: boolean }) {
  const t: DependencyTask = dep[side];
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Link to={`/projects/${dep.projectId}/tasks/${t.id}`} className="group flex min-w-0 flex-1 items-center gap-3">
        <span className="w-16 shrink-0 font-mono text-xs text-muted">{t.key}</span>
        <span className={cn('min-w-0 flex-1 truncate text-[13.5px] text-ink group-hover:text-accent', t.status === 'DONE' && 'text-muted')}>{t.title}</span>
        <StatusBadge status={t.status} />
        <DueDate date={t.dueDate} done={t.status === 'DONE'} className="hidden w-24 text-xs sm:inline-flex" showIcon={false} />
        <Avatar user={t.assignee} size="sm" tooltip />
      </Link>
      {canEdit && (
        <Button variant="ghost" size="icon-sm" onClick={onRemove} disabled={busy} aria-label={`Remove dependency on ${t.key}`}>
          <X />
        </Button>
      )}
    </li>
  );
}

/**
 * "Waiting on" and "Holding up" for one task, with add/remove. Options that would create a
 * loop are disabled here with the reason; the server rejects them regardless.
 */
export function TaskDependenciesCard({ task, canEdit }: { task: Task; canEdit: boolean }) {
  const { data: deps, isLoading } = useDependenciesQuery(task.projectId);
  const { data: projectTasks } = useBoardTasksQuery(task.projectId, { skip: !canEdit });
  const [add, addState] = useAddDependencyMutation();
  const [remove, removeState] = useRemoveDependencyMutation();
  const [adding, setAdding] = useState(false);
  const [choice, setChoice] = useState('');
  const [error, setError] = useState<string | null>(null);

  const waitingOn = (deps ?? []).filter((d) => d.blocked.id === task.id);
  const holdingUp = (deps ?? []).filter((d) => d.blocker.id === task.id);
  const openCount = waitingOn.filter((d) => d.blocker.status !== 'DONE').length;
  const editable = canEdit && task.status !== 'DONE';

  const options = useMemo(() => {
    if (!projectTasks || !deps) return [];
    const loops = downstream(deps, task.id);
    const already = new Set(waitingOn.map((d) => d.blocker.id));
    return projectTasks
      .filter((t) => t.id !== task.id)
      .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }))
      .map((t) => ({
        task: t,
        disabled: already.has(t.id) ? 'already a blocker' : loops.has(t.id) ? 'would create a loop' : null,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectTasks, deps, task.id]);

  const submit = async () => {
    if (!choice) return;
    setError(null);
    try {
      await add({ projectId: task.projectId, blockedTaskId: task.id, blockerTaskId: Number(choice) }).unwrap();
      toast.success('Dependency added');
      setChoice('');
      setAdding(false);
    } catch (e) {
      setError(getFieldErrors(e).blockerTaskId ?? getErrorMessage(e));
    }
  };

  const [dropping, setDropping] = useState<Dependency | null>(null);
  const drop = (d: Dependency) => setDropping(d);
  const confirmDrop = async () => {
    if (!dropping) return;
    await remove({ id: dropping.id, projectId: task.projectId, blockedTaskId: dropping.blocked.id })
      .unwrap()
      .then(() => {
        setDropping(null);
        toast.success('Dependency removed');
      })
      .catch((e: unknown) => toast.error(getErrorMessage(e)));
  };

  return (
    <Card>
      <CardHeader
        title="Dependencies"
        description={
          waitingOn.length === 0
            ? 'Nothing has to finish before this task.'
            : openCount === 0
              ? `All ${waitingOn.length} blocking ${waitingOn.length === 1 ? 'task is' : 'tasks are'} done.`
              : `Waiting on ${openCount} unfinished ${openCount === 1 ? 'task' : 'tasks'}.`
        }
        action={
          <Link to={`/projects/${task.projectId}/map?focus=${task.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
            <GitFork className="size-3.5" aria-hidden="true" /> Map
          </Link>
        }
      />
      <CardBody className="space-y-5">
        {isLoading ? (
          <Skeleton className="h-16" />
        ) : (
          <>
            <section aria-labelledby={`waiting-${task.id}`}>
              <h3 id={`waiting-${task.id}`} className="caps mb-1 text-[11px] text-muted">
                Waiting on
              </h3>
              {waitingOn.length ? (
                <ul className="divide-y divide-line">
                  {waitingOn.map((d) => (
                    <Row key={d.id} dep={d} side="blocker" canEdit={editable} busy={removeState.isLoading} onRemove={() => drop(d)} />
                  ))}
                </ul>
              ) : (
                <p className="py-1 text-[13px] text-muted">No blockers.</p>
              )}
            </section>

            <section aria-labelledby={`holding-${task.id}`}>
              <h3 id={`holding-${task.id}`} className="caps mb-1 text-[11px] text-muted">
                Holding up
              </h3>
              {holdingUp.length ? (
                <ul className="divide-y divide-line">
                  {holdingUp.map((d) => (
                    <Row key={d.id} dep={d} side="blocked" canEdit={false} busy={false} onRemove={() => undefined} />
                  ))}
                </ul>
              ) : (
                <p className="py-1 text-[13px] text-muted">No other task waits on this one.</p>
              )}
            </section>

            {editable &&
              (adding ? (
                <div className="space-y-2 border-t border-line pt-4">
                  <label htmlFor={`dep-${task.id}`} className="block text-[13px] font-medium text-ink-2">
                    This task can’t finish until…
                  </label>
                  <div className="flex gap-2">
                    <Select id={`dep-${task.id}`} value={choice} onChange={(e) => setChoice(e.target.value)} aria-invalid={!!error}>
                      <option value="">Choose a task in this project</option>
                      {options.map(({ task: t, disabled }) => (
                        <option key={t.id} value={t.id} disabled={!!disabled}>
                          {t.key}: {t.title}
                          {disabled ? ` (${disabled})` : ''}
                        </option>
                      ))}
                    </Select>
                    <Button onClick={() => void submit()} loading={addState.isLoading} disabled={!choice}>
                      Add
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setAdding(false);
                        setError(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                  {error && (
                    <p className="text-xs font-medium text-danger" role="alert">
                      {error}
                    </p>
                  )}
                </div>
              ) : (
                <Button variant="ghost" size="sm" leftIcon={<Plus />} onClick={() => setAdding(true)}>
                  Add a blocker
                </Button>
              ))}
          </>
        )}
      </CardBody>
      <ConfirmDialog
        open={dropping !== null}
        onOpenChange={(o) => !o && setDropping(null)}
        title="Remove this dependency?"
        description={dropping ? `${dropping.blocked.key} will no longer wait on ${dropping.blocker.key}. The schedule and forecast are recalculated.` : ''}
        confirmLabel="Remove"
        onConfirm={confirmDrop}
      />
    </Card>
  );
}
