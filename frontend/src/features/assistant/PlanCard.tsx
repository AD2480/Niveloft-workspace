import { Check, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAddDependencyMutation, useCreateTaskMutation, useDeleteTaskMutation } from '@/api/endpoints';
import { getErrorMessage } from '@/api/errors';
import type { Priority, ProjectDetail, Task } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { useCurrentUserId } from '@/features/projects/projectContext';
import { cn } from '@/lib/cn';
import { PRIORITY_LABEL } from '@/lib/constants';
import { formatDate } from '@/lib/dates';
import { can } from '@/lib/permissions';
import type { DraftTask } from '@/lib/planDraft';
import { useAssistant } from './assistantContext';

export interface PlanView {
  /** Drafted by an AI model, or from the brief's own lines without AI. */
  source: 'ai' | 'local';
  model?: string;
  tasks: DraftTask[];
  /** What the brief leaves open (AI questions, or the local drafter's gaps). */
  open: string[];
  skipped: string[];
  limits: string[];
  /** Why the AI wasn't used, when it was asked but couldn't help. */
  fallback?: string;
}

type Phase = { kind: 'review' } | { kind: 'creating'; done: number } | { kind: 'created'; tasks: Task[]; notes: string[] } | { kind: 'undone'; count: number; notes: string[] };

/**
 * Flurry's draft plan, shown before anything changes: every task can be switched off or renamed,
 * owners are only filled in where the brief names someone who may take the task, and nothing is
 * created until the person presses the button. Afterwards it says what was created and offers
 * Undo (deleting exactly those tasks, with the person's own permissions).
 */
export function PlanCard({ project, plan }: { project: ProjectDetail; plan: PlanView }) {
  const a = useAssistant();
  const me = useCurrentUserId();
  const [chosen, setChosen] = useState<boolean[]>(() => plan.tasks.map(() => true));
  const [titles, setTitles] = useState<string[]>(() => plan.tasks.map((t) => t.title));
  const [phase, setPhase] = useState<Phase>({ kind: 'review' });
  const [error, setError] = useState<string | null>(null);
  const [createTask] = useCreateTaskMutation();
  const [deleteTask] = useDeleteTaskMutation();
  const [addDependency] = useAddDependencyMutation();
  const role = project.myRole;
  const allowed = can.createTask(role);
  const count = chosen.filter(Boolean).length;

  /** Who a name means, if they may hold tasks and this person may assign them. */
  const owner = (name: string | null): { id: number | null; note: string | null } => {
    if (!name) return { id: null, note: null };
    const n = name.trim().toLowerCase();
    const assignable = project.members.filter((m) => m.role !== 'VIEWER');
    const matches = n === 'me' || n === 'myself' ? assignable.filter((m) => m.user.id === me) : assignable.filter((m) => m.user.name.toLowerCase() === n || m.user.name.toLowerCase().split(' ')[0] === n.split(' ')[0]);
    if (matches.length !== 1) return { id: null, note: matches.length > 1 ? `more than one “${name}”; left unassigned` : `no one called “${name}” can take tasks here; left unassigned` };
    const m = matches[0];
    if (!can.assignTask(role, { assigneeId: null, reporterId: me, status: 'TODO' }, me, m.user.id)) return { id: null, note: `as a member you can only assign yourself; left for a manager` };
    return { id: m.user.id, note: null };
  };

  const create = async () => {
    setError(null);
    const picked = plan.tasks.map((t, i) => ({ t, i })).filter(({ i }) => chosen[i]);
    const created: { index: number; task: Task }[] = [];
    const notes: string[] = [];
    a.signal('busy');
    setPhase({ kind: 'creating', done: 0 });
    for (const { t, i } of picked) {
      const who = owner(t.assigneeName);
      try {
        const task = await createTask({
          projectId: project.id,
          body: {
            title: (titles[i] ?? t.title).trim() || t.title,
            description: t.description,
            priority: (t.priority ?? 'MEDIUM') as Priority,
            assigneeId: who.id,
            dueDate: t.dueDate,
            milestoneId: null,
            estimateDays: t.estimateDays,
          },
        }).unwrap();
        created.push({ index: i, task });
        setPhase({ kind: 'creating', done: created.length });
      } catch (e) {
        setError(`Stopped after ${created.length} of ${picked.length}: ${getErrorMessage(e)}`);
        break;
      }
    }
    // Dependencies between the new tasks, where the plan says one waits on another.
    const byIndex = new Map(created.map((c) => [c.index, c.task]));
    for (const { index, task } of created) {
      for (const d of plan.tasks[index].dependsOn) {
        const blocker = byIndex.get(d);
        if (!blocker) continue;
        try {
          await addDependency({ projectId: project.id, blockedTaskId: task.id, blockerTaskId: blocker.id }).unwrap();
        } catch (e) {
          notes.push(`${task.key} should wait on ${blocker.key}, but that link couldn’t be added (${getErrorMessage(e)}).`);
        }
      }
    }
    if (created.length) {
      setPhase({ kind: 'created', tasks: created.map((c) => c.task), notes });
      a.signal('success');
    } else {
      setPhase({ kind: 'review' });
      a.signal('error');
    }
  };

  const undo = async () => {
    if (phase.kind !== 'created') return;
    const notes: string[] = [];
    let removed = 0;
    for (const t of phase.tasks) {
      if (!can.deleteTask(role, { assigneeId: t.assignee?.id ?? null, reporterId: t.reporter.id, status: t.status }, me)) {
        notes.push(`${t.key} has moved on since, so it wasn’t removed.`);
        continue;
      }
      try {
        await deleteTask({ id: t.id, projectId: project.id }).unwrap();
        removed++;
      } catch (e) {
        notes.push(`${t.key} couldn’t be removed (${getErrorMessage(e)}).`);
      }
    }
    setPhase({ kind: 'undone', count: removed, notes });
  };

  const label = plan.source === 'ai' ? `Draft plan by AI${plan.model ? ` (${plan.model})` : ''}` : 'Draft plan from your brief’s own lines (no AI)';

  return (
    <div className={cn('overflow-hidden rounded-lg border bg-surface', phase.kind === 'review' ? 'border-accent/40' : 'border-line')} data-plan-card="">
      <p className={cn('border-b px-3 py-1.5 text-[12px] font-medium', phase.kind === 'review' ? 'border-accent/25 bg-brand-soft text-brand-ink' : 'border-line text-muted')}>{label}</p>
      {plan.fallback && <p className="border-b border-line bg-surface-2 px-3 py-2 text-[12px] text-ink-2">{plan.fallback}</p>}

      {phase.kind === 'review' || phase.kind === 'creating' ? (
        <div className="px-3 py-2.5">
          <p className="text-[12.5px] text-ink-2">
            {plan.tasks.length === 1 ? 'One task' : `${plan.tasks.length} tasks`} for {project.name}. Untick any you don’t want, and fix a title if it’s wrong. Nothing is created until you press the button.
          </p>
          <ol className="mt-2 divide-y divide-line rounded-md border border-line">
            {plan.tasks.map((t, i) => {
              const who = owner(t.assigneeName);
              const meta = [
                t.priority ? PRIORITY_LABEL[t.priority] : null,
                t.dueDate ? `due ${formatDate(t.dueDate, 'd MMM')}` : null,
                who.id ? `owner ${t.assigneeName}` : null,
                t.estimateDays ? `${t.estimateDays} ${t.estimateDays === 1 ? 'day' : 'days'}` : null,
                t.dependsOn.length ? `after ${t.dependsOn.map((d) => `#${d + 1}`).join(', ')}` : null,
              ].filter(Boolean);
              return (
                <li key={i} className={cn('flex items-start gap-2.5 px-2.5 py-2', !chosen[i] && 'opacity-55')}>
                  <input
                    type="checkbox"
                    className="mt-1.5 size-4 shrink-0 accent-[var(--accent)]"
                    checked={chosen[i]}
                    disabled={phase.kind === 'creating'}
                    onChange={(e) => setChosen((c) => c.map((v, j) => (j === i ? e.target.checked : v)))}
                    aria-label={`Include task ${i + 1}`}
                  />
                  <div className="min-w-0 flex-1">
                    <label className="sr-only" htmlFor={`plan-title-${i}`}>
                      Title of task {i + 1}
                    </label>
                    <input
                      id={`plan-title-${i}`}
                      value={titles[i]}
                      maxLength={200}
                      disabled={phase.kind === 'creating' || !chosen[i]}
                      onChange={(e) => setTitles((ts) => ts.map((v, j) => (j === i ? e.target.value : v)))}
                      className="w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-[13px] text-ink hover:border-line focus:border-line-strong focus:bg-surface focus:outline-none"
                    />
                    {(meta.length > 0 || who.note || t.description) && (
                      <p className="px-1 text-[12px] leading-relaxed text-muted">
                        <span className="font-mono text-[11.5px] text-subtle">#{i + 1}</span> {meta.join(', ')}
                        {who.note && <span className="text-warning">. {who.note}</span>}
                        {t.description && <span className="block text-ink-2">{t.description}</span>}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {plan.open.length > 0 && (
            <div className="mt-2.5 rounded-md bg-surface-2 px-3 py-2 text-[12px] text-ink-2">
              <p className="text-[12px] font-semibold text-muted">Not in the brief, so for you to decide</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {plan.open.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          )}
          {plan.skipped.length > 0 && (
            <details className="mt-2 text-[12px] text-muted">
              <summary className="cursor-pointer hover:text-ink">{plan.skipped.length === 1 ? 'One line' : `${plan.skipped.length} lines`} didn’t read like work to do</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {plan.skipped.slice(0, 8).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </details>
          )}
          {error && (
            <p className="mt-2 text-[12px] text-danger" role="alert">
              {error}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {allowed ? (
              <Button size="sm" onClick={() => void create()} disabled={count === 0} loading={phase.kind === 'creating'}>
                {phase.kind === 'creating' ? `Creating ${phase.done + 1} of ${count}…` : `Create ${count === 1 ? '1 task' : `${count} tasks`}`}
              </Button>
            ) : (
              <p className="text-[12px] text-muted">Viewers can’t create tasks. Share the draft with a member or manager instead.</p>
            )}
            <span className="text-[12px] text-muted">in {project.name}</span>
          </div>
          <ul className="mt-2 space-y-0.5 text-[12px] text-muted">
            {plan.limits.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      ) : phase.kind === 'created' ? (
        <div className="px-3 py-2.5" role="status">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
            <Check className="size-4 text-success" aria-hidden="true" /> Created {phase.tasks.length === 1 ? '1 task' : `${phase.tasks.length} tasks`} in {project.name}
          </p>
          <ul className="mt-1.5 space-y-0.5 text-[12.5px]">
            {phase.tasks.map((t) => (
              <li key={t.id}>
                <Link to={`/projects/${project.id}/tasks/${t.id}`} className="text-ink hover:text-accent">
                  <span className="font-mono text-[12px] text-muted">{t.key}</span> {t.title}
                </Link>
              </li>
            ))}
          </ul>
          {phase.notes.map((n) => (
            <p key={n} className="mt-1 text-[12px] text-warning">
              {n}
            </p>
          ))}
          <p className="mt-2 text-[12px] text-muted">They’re in To do with no acceptance criteria yet; add those before the work starts.</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => void undo()}>
            <Undo2 aria-hidden="true" /> Undo: remove these tasks
          </Button>
        </div>
      ) : (
        <div className="px-3 py-2.5" role="status">
          <p className="text-[13px] text-ink">Removed {phase.count === 1 ? 'the task' : `${phase.count} tasks`} I created.</p>
          {phase.notes.map((n) => (
            <p key={n} className="mt-1 text-[12px] text-warning">
              {n}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
