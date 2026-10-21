import { Check, Undo2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useBoardTasksQuery, useChangeTaskStatusMutation, useDeleteTaskMutation } from '@/api/endpoints';
import { getErrorMessage } from '@/api/errors';
import type { Priority, ProjectDetail, Task } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { useCurrentUserId } from '@/features/projects/projectContext';
import { TaskFormDialog } from '@/features/tasks/TaskFormDialog';
import { cn } from '@/lib/cn';
import { PRIORITY_LABEL, STATUS_LABEL } from '@/lib/constants';
import { formatDate } from '@/lib/dates';
import { atLeast, can } from '@/lib/permissions';

/** An action the assistant prepared. Nothing happens until the person confirms it. */
export type ActionDraft =
  | { type: 'create'; title: string | null; description?: string | null; priority: Priority | null; due: string | null; assignee: string | null; estimate: number | null }
  | { type: 'start'; key: string };

/**
 * Finds who a name means among the people who can hold tasks (not viewers): "me"/"myself", a full
 * name, or an unambiguous first name.
 */
function findMember(project: ProjectDetail, name: string, me: number): { member: ProjectDetail['members'][number] | null; ambiguous: boolean } {
  const assignable = project.members.filter((m) => m.role !== 'VIEWER');
  const n = name.trim().toLowerCase();
  if (n === 'me' || n === 'myself') return { member: assignable.find((m) => m.user.id === me) ?? null, ambiguous: false };
  const full = assignable.filter((m) => m.user.name.toLowerCase() === n);
  if (full.length === 1) return { member: full[0], ambiguous: false };
  const first = assignable.filter((m) => m.user.name.toLowerCase().split(' ')[0] === n.split(' ')[0]);
  return first.length === 1 ? { member: first[0], ambiguous: false } : { member: null, ambiguous: first.length > 1 };
}

/** A date for display, or the raw text if it isn't a real date (never throws). */
function safeDate(iso: string): string {
  try {
    return formatDate(iso);
  } catch {
    return iso;
  }
}

/**
 * A prepared action shown for confirmation: a task draft that opens in the normal task form, or a
 * "start this task" button. Both go through the usual endpoints with the person's own permissions,
 * so the assistant can never do more than they could by hand.
 */
export function ProposalCard({ project, draft, origin, onDone }: { project: ProjectDetail; draft: ActionDraft; origin: 'command' | 'ai'; onDone?: (text: string) => void }) {
  return draft.type === 'create' ? (
    <CreateCard project={project} draft={draft} origin={origin} onDone={onDone} />
  ) : (
    <StartCard project={project} taskKey={draft.key} origin={origin} onDone={onDone} />
  );
}

function Frame({ label, children, done }: { label: string; children: ReactNode; done?: boolean }) {
  return (
    <div className={cn('overflow-hidden rounded-lg border bg-surface', done ? 'border-line' : 'border-accent/40')}>
      <p className={cn('border-b px-3 py-1.5 text-[12px] font-medium', done ? 'border-line text-muted' : 'border-accent/25 bg-brand-soft text-brand-ink')}>{label}</p>
      <div className="px-3 py-2.5">{children}</div>
    </div>
  );
}

function CreateCard({ project, draft, origin, onDone }: { project: ProjectDetail; draft: Extract<ActionDraft, { type: 'create' }>; origin: 'command' | 'ai'; onDone?: (text: string) => void }) {
  const me = useCurrentUserId();
  const [formOpen, setFormOpen] = useState(false);
  const [created, setCreated] = useState<Task | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [undone, setUndone] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [removeTask, removing] = useDeleteTaskMutation();
  const role = project.myRole;

  const notes: string[] = [];
  let assigneeId: number | undefined;
  if (draft.assignee) {
    const { member: m, ambiguous } = findMember(project, draft.assignee, me);
    if (!m)
      notes.push(
        ambiguous
          ? `More than one person in ${project.name} is called “${draft.assignee}”, so the form leaves it for you to choose.`
          : `No one who can take tasks in ${project.name} is called “${draft.assignee}”, so the form leaves it for you to choose.`,
      );
    else if (!atLeast(role, 'MANAGER') && m.user.id !== me) notes.push('As a member you can only assign tasks to yourself, so the form starts with you.');
    else assigneeId = m.user.id;
  }
  if (!draft.title) notes.push('No title was given; add one in the form.');

  if (!can.createTask(role)) {
    return (
      <Frame label="Can’t create a task" done>
        <p className="text-[12.5px] text-ink-2">Viewers can’t create tasks in {project.name}. A manager or the owner can change your role.</p>
      </Frame>
    );
  }
  if (undone) return <p className="text-[12px] text-muted">Undone: {undone} was removed.</p>;
  if (created) {
    const canUndo = can.deleteTask(role, { assigneeId: created.assignee?.id ?? null, reporterId: created.reporter.id, status: created.status }, me);
    return (
      <Frame label="Created" done>
        <p className="flex items-center gap-1.5 text-[13px] text-ink">
          <Check className="size-3.5 text-success" aria-hidden="true" />
          <Link to={`/projects/${project.id}/tasks/${created.id}`} className="font-mono text-[12px] text-accent hover:underline">
            {created.key}
          </Link>
          {created.title}
        </p>
        {canUndo && (
          <Button
            size="xs"
            variant="ghost"
            className="mt-1.5 -ml-2"
            loading={removing.isLoading}
            onClick={async () => {
              setUndoError(null);
              try {
                await removeTask({ id: created.id, projectId: project.id }).unwrap();
                setUndone(created.key);
              } catch (e) {
                setUndoError(getErrorMessage(e));
              }
            }}
          >
            <Undo2 aria-hidden="true" /> Undo
          </Button>
        )}
        {undoError && <p className="mt-1 text-[12px] text-danger">{undoError}</p>}
      </Frame>
    );
  }
  if (dismissed) return <p className="text-[12px] text-muted">Dismissed. Nothing was created.</p>;

  const row = (label: string, value: string | null | undefined) => (
    <div className="grid grid-cols-[72px_1fr] gap-2 py-0.5 text-[12.5px]">
      <dt className="text-muted">{label}</dt>
      <dd className={value ? 'text-ink' : 'text-subtle'}>{value || '—'}</dd>
    </div>
  );
  return (
    <Frame label={`${origin === 'ai' ? 'Suggested by AI' : 'Draft'}: a new task in ${project.key}`}>
      <dl>
        {row('Title', draft.title)}
        {row('Priority', draft.priority ? PRIORITY_LABEL[draft.priority] : null)}
        {row('Due', draft.due ? safeDate(draft.due) : null)}
        {row('Assignee', assigneeId !== undefined ? project.members.find((m) => m.user.id === assigneeId)?.user.name : draft.assignee ? `${draft.assignee} (not matched)` : null)}
        {row('Estimate', draft.estimate ? `${draft.estimate} working ${draft.estimate === 1 ? 'day' : 'days'}` : null)}
      </dl>
      {notes.length > 0 && (
        <ul className="mt-2 space-y-1 text-[12px] text-muted">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setFormOpen(true)}>
          Review and create
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
          Dismiss
        </Button>
      </div>
      <p className="mt-2 text-[12px] text-muted">Opens the usual task form, filled in. Nothing is saved until you press Create there.</p>
      <TaskFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        project={project}
        defaults={{
          title: draft.title ?? undefined,
          description: draft.description ?? undefined,
          priority: draft.priority ?? undefined,
          dueDate: draft.due ?? undefined,
          assigneeId,
          estimateDays: draft.estimate ?? undefined,
        }}
        onSaved={(t) => {
          setCreated(t);
          onDone?.(`Created ${t.key}.`);
        }}
      />
    </Frame>
  );
}

function StartCard({ project, taskKey, origin, onDone }: { project: ProjectDetail; taskKey: string; origin: 'command' | 'ai'; onDone?: (text: string) => void }) {
  const me = useCurrentUserId();
  const { data: tasks, isLoading } = useBoardTasksQuery(project.id);
  const [changeStatus, state] = useChangeTaskStatusMutation();
  const [result, setResult] = useState<'started' | 'dismissed' | 'undone' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const task = tasks?.find((t) => t.key.toUpperCase() === taskKey.toUpperCase());

  if (isLoading) return <p className="text-[12px] text-muted">Looking up {taskKey}…</p>;
  if (!task) {
    return (
      <Frame label={`Start ${taskKey}`} done>
        <p className="text-[12.5px] text-ink-2">
          {taskKey} isn’t a task in {project.name}.{' '}
          {taskKey.split('-')[0] !== project.key ? 'If it belongs to another project, choose that project at the top of the assistant.' : ''}
        </p>
      </Frame>
    );
  }
  const allowed = can.changeStatus(project.myRole, { status: task.status, assigneeId: task.assignee?.id ?? null, reporterId: task.reporter.id }, me, 'IN_PROGRESS');
  const link = (
    <Link to={`/projects/${project.id}/tasks/${task.id}`} className="font-mono text-[12px] text-accent hover:underline">
      {task.key}
    </Link>
  );
  if (result === 'started') {
    return (
      <Frame label="Started" done>
        <p className="flex items-center gap-1.5 text-[13px] text-ink">
          <Check className="size-3.5 text-success" aria-hidden="true" /> {link} is now In progress.
        </p>
        {task.status === 'IN_PROGRESS' && can.changeStatus(project.myRole, { status: 'IN_PROGRESS', assigneeId: task.assignee?.id ?? null, reporterId: task.reporter.id }, me, 'TODO') && (
          <Button
            size="xs"
            variant="ghost"
            className="mt-1.5 -ml-2"
            loading={state.isLoading}
            onClick={async () => {
              setError(null);
              try {
                await changeStatus({ id: task.id, projectId: project.id, status: 'TODO' }).unwrap();
                setResult('undone');
              } catch (e) {
                setError(getErrorMessage(e));
              }
            }}
          >
            <Undo2 aria-hidden="true" /> Undo: back to To do
          </Button>
        )}
        {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
      </Frame>
    );
  }
  if (result === 'undone') return <p className="text-[12px] text-muted">Undone: {task.key} is back in To do.</p>;
  if (result === 'dismissed') return <p className="text-[12px] text-muted">Dismissed. {task.key} wasn’t changed.</p>;
  if (task.status !== 'TODO') {
    return (
      <Frame label={`Start ${task.key}`} done>
        <p className="text-[12.5px] text-ink-2">
          {link} {task.title} is already {STATUS_LABEL[task.status]}.{task.status === 'IN_REVIEW' ? ' It moves on when a reviewer decides.' : ''}
        </p>
      </Frame>
    );
  }
  return (
    <Frame label={`${origin === 'ai' ? 'Suggested by AI' : 'Confirm'}: start a task`}>
      <p className="text-[13px] text-ink">
        {link} {task.title}
      </p>
      <p className="mt-0.5 text-[12px] text-muted">
        To do → In progress, {task.assignee ? `assigned to ${task.assignee.name}` : 'unassigned'}
      </p>
      {!allowed ? (
        <p className="mt-2 text-[12px] text-ink-2">Only the assignee or a manager can start this task.</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            loading={state.isLoading}
            onClick={async () => {
              setError(null);
              try {
                await changeStatus({ id: task.id, projectId: project.id, status: 'IN_PROGRESS' }).unwrap();
                setResult('started');
                onDone?.(`Started ${task.key}.`);
              } catch (e) {
                setError(getErrorMessage(e));
              }
            }}
          >
            Start {task.key}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setResult('dismissed')}>
            Dismiss
          </Button>
        </div>
      )}
      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
    </Frame>
  );
}
