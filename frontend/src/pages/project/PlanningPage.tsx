import { AlertTriangle, ArrowRight, CalendarClock, CalendarOff, Hourglass, Lock, Plus, RotateCcw, Trash2, UserRound, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useApplyPlanMutation, useBoardTasksQuery, useDependenciesQuery } from '@/api/endpoints';
import { getErrorMessage, isEditConflict } from '@/api/errors';
import type { PlanChange, Task } from '@/api/types';
import { StatusBadge } from '@/components/domain';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { FormError, Input, Select } from '@/components/ui/Form';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Spinner';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { useProjectContext } from '@/features/projects/projectContext';
import { cn } from '@/lib/cn';
import { formatDate, todayIso } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import { atLeast } from '@/lib/permissions';
import { applyTweaks, compareOutcomes, schedule, workingDaysBetween, type PlanInput, type ScheduledTask, type Tweak } from '@/lib/scheduler';
import { ConfirmDialog } from '@/components/ui/Dialog';

const storageKey = (projectId: number) => `projectflow.plan.${projectId}`;
const optionsKey = (projectId: number) => `projectflow.plan.options.${projectId}`;

const OPTIONS = ['A', 'B', 'C'] as const;
type OptionName = (typeof OPTIONS)[number];
interface PlanOptions {
  active: OptionName;
  options: Record<OptionName, Tweak[]>;
}

/** The scenarios kept in this browser: three options to compare (an older single scenario becomes option A). */
function loadPlan(projectId: number): PlanOptions {
  const empty: PlanOptions = { active: 'A', options: { A: [], B: [], C: [] } };
  try {
    const raw = localStorage.getItem(optionsKey(projectId));
    if (raw) {
      const p = JSON.parse(raw) as PlanOptions;
      if (p && OPTIONS.includes(p.active) && p.options) return { active: p.active, options: { A: p.options.A ?? [], B: p.options.B ?? [], C: p.options.C ?? [] } };
    }
    const legacy = localStorage.getItem(storageKey(projectId));
    return legacy ? { ...empty, options: { ...empty.options, A: JSON.parse(legacy) as Tweak[] } } : empty;
  } catch {
    return empty;
  }
}

function savePlan(projectId: number, plan: PlanOptions) {
  try {
    localStorage.setItem(optionsKey(projectId), JSON.stringify(plan));
    localStorage.removeItem(storageKey(projectId));
  } catch {
    /* storage unavailable: the options simply aren't remembered */
  }
}

const short = (iso: string | null) => (iso ? formatDate(iso, 'EEE d MMM') : '—');

function Slip({ s }: { s: ScheduledTask | undefined }) {
  if (!s || s.slipDays === null) return <span className="text-xs text-subtle">no due date</span>;
  if (s.slipDays > 0) return <span className="text-xs font-medium text-danger tabular">{s.slipDays}d late</span>;
  if (s.slipDays === 0) return <span className="text-xs text-warning tabular">on the day</span>;
  return <span className="text-xs text-success tabular">{-s.slipDays}d spare</span>;
}

/**
 * What-if planning. Projects start and finish dates from estimates, assignees and
 * dependencies (see lib/scheduler.ts), lets you try changes without touching real data,
 * and — for managers — applies the chosen changes in one server transaction that is
 * rejected if any task changed since the scenario was calculated.
 */
export function PlanningPage() {
  const { project } = useProjectContext();
  useDocumentTitle(`${project.name} · Plan`);
  const canApply = atLeast(project.myRole, 'MANAGER') && project.status !== 'ARCHIVED';
  const { data: tasks, isLoading, isError, error, refetch } = useBoardTasksQuery(project.id);
  const { data: deps, refetch: refetchDeps } = useDependenciesQuery(project.id);
  const [applyPlan, applyState] = useApplyPlanMutation();
  const [confirmApply, setConfirmApply] = useState(false);
  const [plan, setPlan] = useState<PlanOptions>(() => loadPlan(project.id));
  const tweaks = plan.options[plan.active];
  const setTweaks = (next: Tweak[] | ((ts: Tweak[]) => Tweak[])) =>
    setPlan((p) => ({ ...p, options: { ...p.options, [p.active]: typeof next === 'function' ? next(p.options[p.active]) : next } }));
  const [adoptDates, setAdoptDates] = useState(true);
  const [note, setNote] = useState('');
  const [applyError, setApplyError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const today = todayIso();

  useEffect(() => savePlan(project.id, plan), [project.id, plan]);

  const people = project.members.filter((m) => m.role !== 'VIEWER');
  const nameOf = (id: number | null) => (id === null ? 'Unassigned' : (people.find((m) => m.user.id === id)?.user.name ?? 'Former member'));
  const userOf = (id: number | null) => (id === null ? null : (people.find((m) => m.user.id === id)?.user ?? null));

  const base = useMemo<PlanInput | null>(() => {
    if (!tasks) return null;
    return {
      today,
      tasks: tasks.map((t) => ({
        id: t.id,
        key: t.key,
        title: t.title,
        status: t.status,
        priority: t.priority,
        assigneeId: t.assignee?.id ?? null,
        dueDate: t.dueDate,
        estimateDays: t.estimateDays,
        startedOn: t.startedAt ? todayIso(new Date(t.startedAt)) : null,
        milestoneId: t.milestoneId,
      })),
      dependencies: (deps ?? []).map((d) => ({ blockerId: d.blocker.id, blockedId: d.blocked.id })),
    };
  }, [tasks, deps, today]);

  // Tweaks for tasks that no longer exist or are done are ignored (and listed as such).
  const openIds = useMemo(() => new Set((tasks ?? []).filter((t) => t.status !== 'DONE').map((t) => t.id)), [tasks]);
  const liveTweaks = useMemo(() => tweaks.filter((t) => t.kind === 'timeOff' || openIds.has(t.taskId)), [tweaks, openIds]);
  const baseline = useMemo(() => (base ? schedule(base) : null), [base]);
  const scenarioInput = useMemo(() => (base ? applyTweaks(base, liveTweaks) : null), [base, liveTweaks]);
  const scenario = useMemo(() => (scenarioInput ? schedule(scenarioInput) : null), [scenarioInput]);
  const diff = useMemo(() => (baseline && scenario ? compareOutcomes(baseline, scenario) : null), [baseline, scenario]);

  // Every option with changes, projected the same way, to compare side by side.
  const compared = useMemo(() => {
    if (!base || !baseline) return [];
    return OPTIONS.filter((n) => plan.options[n].length > 0).map((name) => {
      const live = plan.options[name].filter((t) => t.kind === 'timeOff' || openIds.has(t.taskId));
      const outcome = schedule(applyTweaks(base, live));
      return { name, changes: live.length, outcome, diff: compareOutcomes(baseline, outcome) };
    });
  }, [base, baseline, plan.options, openIds]);


  const taskById = useMemo(() => new Map((tasks ?? []).map((t) => [t.id, t])), [tasks]);
  const scenarioTask = (id: number) => scenarioInput?.tasks.find((t) => t.id === id);
  const rows = useMemo(() => {
    if (!scenario) return [];
    return [...scenario.scheduled.values()].sort((a, b) => a.start.localeCompare(b.start) || a.finish.localeCompare(b.finish) || a.taskId - b.taskId);
  }, [scenario]);

  // Changes the apply would send.
  const changes = useMemo<PlanChange[]>(() => {
    if (!scenario || !tasks) return [];
    const out = new Map<number, PlanChange>();
    const get = (t: Task) => out.get(t.id) ?? { taskId: t.id, version: t.version };
    for (const tw of liveTweaks) {
      if (tw.kind === 'timeOff') continue;
      const t = taskById.get(tw.taskId);
      if (!t) continue;
      const c = get(t);
      if (tw.kind === 'reassign') {
        if ((t.assignee?.id ?? null) === tw.assigneeId) continue;
        if (tw.assigneeId === null) c.unassign = true;
        else c.assigneeId = tw.assigneeId;
      } else if (tw.days !== t.estimateDays) {
        c.estimateDays = tw.days;
      } else continue;
      out.set(t.id, c);
    }
    if (adoptDates) {
      for (const id of scenario.late) {
        const t = taskById.get(id);
        const s = scenario.scheduled.get(id);
        if (!t || !s) continue;
        out.set(id, { ...get(t), dueDate: s.finish });
      }
    }
    return [...out.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, tasks, liveTweaks, adoptDates]);

  // Refetch the current tasks and dependencies, then allow applying again.
  const recalculate = async () => {
    await Promise.all([refetch(), refetchDeps()]);
    setStale(false);
    setApplyError(null);
  };

  const apply = async () => {
    setConfirmApply(false);
    setApplyError(null);
    try {
      const basis = {
        tasks: (tasks ?? []).filter((t) => t.status !== 'DONE').map((t) => ({ taskId: t.id, version: t.version })),
        dependencyIds: (deps ?? []).map((d) => d.id),
      };
      const res = await applyPlan({ projectId: project.id, changes, basis, note: note.trim() || null }).unwrap();
      toast.success(res.changedTasks ? `Plan applied to ${res.changedTasks} ${res.changedTasks === 1 ? 'task' : 'tasks'}` : 'Nothing needed to change');
      setTweaks((ts) => ts.filter((t) => t.kind === 'timeOff'));
      setNote('');
    } catch (e) {
      if (isEditConflict(e)) setStale(true);
      setApplyError(getErrorMessage(e));
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-6 sm:px-6 lg:px-10">
        <Skeleton className="h-24" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (isError || !tasks || !baseline || !scenario || !diff) {
    return (
      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-10">
        <ErrorState error={error} onRetry={refetch} />
      </div>
    );
  }

  const deadline = project.deadline;
  const vsDeadline = (finish: string | null) => (finish && deadline ? workingDaysBetween(deadline, finish) : null);
  const baseVs = vsDeadline(baseline.finish);
  const scenVs = vsDeadline(scenario.finish);
  const hasTweaks = liveTweaks.length > 0;

  return (
    <div className="mx-auto max-w-[1600px] space-y-8 px-4 py-6 sm:px-6 lg:px-10">
      <div>
        <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.015em] text-ink">What if…</h2>
        <p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-muted">
          Try a change and see when the work would finish. Projections use the estimates in working days (Mon–Fri), one task at a time per person, and the dependencies. A task
          without an estimate counts as 1 day and is flagged. Nothing changes until a manager applies it.
        </p>
      </div>

      {/* Summary ---------------------------------------------------------------------- */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line shadow-card lg:grid-cols-4">
        <div className="bg-surface p-5">
          <dt className="text-[13px] font-medium text-muted">Projected finish now</dt>
          <dd className="reading mt-3 text-[32px] text-ink">{baseline.finish ? formatDate(baseline.finish, 'd MMM') : '—'}</dd>
          <dd className="mt-2 text-xs text-muted">{baseVs === null ? (deadline ? 'Nothing open' : 'No project deadline') : baseVs > 0 ? `${baseVs} working days after the deadline` : baseVs === 0 ? 'On the deadline' : `${-baseVs} working days before the deadline`}</dd>
        </div>
        <div className={cn('p-5', hasTweaks ? 'bg-[color-mix(in_srgb,var(--accent)_6%,var(--surface))]' : 'bg-surface')}>
          <dt className="text-[13px] font-medium text-muted">With this scenario</dt>
          <dd className="reading mt-3 text-[32px] text-ink">{scenario.finish ? formatDate(scenario.finish, 'd MMM') : '—'}</dd>
          <dd className="mt-2 text-xs text-muted">
            {!hasTweaks ? 'Add a change below to compare' : diff.finishDelta === null || diff.finishDelta === 0 ? 'Same finish date' : diff.finishDelta > 0 ? `${diff.finishDelta} working days later` : `${-diff.finishDelta} working days earlier`}
            {hasTweaks && scenVs !== null && `, ${scenVs > 0 ? `${scenVs} days past` : `${-scenVs} days before`} the deadline`}
          </dd>
        </div>
        <div className="bg-surface p-5">
          <dt className="text-[13px] font-medium text-muted">Projected late</dt>
          <dd className={cn('reading mt-3 text-[32px]', scenario.late.length ? 'text-danger' : 'text-ink')}>
            {baseline.late.length}
            {hasTweaks && baseline.late.length !== scenario.late.length && <span className="text-muted"> → {scenario.late.length}</span>}
          </dd>
          <dd className="mt-2 text-xs text-muted">Open tasks projected to finish after their due date</dd>
        </div>
        <div className="bg-surface p-5">
          <dt className="text-[13px] font-medium text-muted">Assumed estimates</dt>
          <dd className={cn('reading mt-3 text-[32px]', scenario.assumed.length ? 'text-warning' : 'text-ink')}>{scenario.assumed.length}</dd>
          <dd className="mt-2 text-xs text-muted">{scenario.assumed.length ? 'Tasks with no estimate (1 day assumed). Estimate them for a better projection.' : 'Every open task has an estimate'}</dd>
        </div>
      </dl>

      {compared.length > 0 && (
        <section aria-labelledby="compare-options" className="overflow-hidden rounded-xl border border-line bg-surface" data-plan-compare="">
          <h3 id="compare-options" className="border-b border-line px-5 py-3 text-[14px] font-semibold text-ink">
            Options compared
          </h3>
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[12px] text-muted">
                  <th scope="col" className="px-5 py-2 font-medium">Option</th>
                  <th scope="col" className="px-3 py-2 font-medium">Projected finish</th>
                  <th scope="col" className="px-3 py-2 font-medium">Against now</th>
                  <th scope="col" className="px-3 py-2 font-medium">Deadline</th>
                  <th scope="col" className="px-3 py-2 font-medium">Late tasks</th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    <span className="sr-only">Show</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line text-muted">
                  <td className="px-5 py-2">The current plan</td>
                  <td className="px-3 py-2 tabular-nums">{short(baseline.finish)}</td>
                  <td className="px-3 py-2">—</td>
                  <td className="px-3 py-2 tabular-nums">{baseVs === null ? '—' : baseVs > 0 ? `${baseVs} days past` : baseVs === 0 ? 'on the day' : `${-baseVs} days before`}</td>
                  <td className="px-3 py-2 tabular-nums">{baseline.late.length}</td>
                  <td />
                </tr>
                {compared.map((c) => {
                  const vs = vsDeadline(c.outcome.finish);
                  const d = c.diff.finishDelta;
                  return (
                    <tr key={c.name} className={cn('border-b border-line last:border-b-0', c.name === plan.active && 'bg-[color-mix(in_srgb,var(--accent)_6%,var(--surface))]')} data-plan-option={c.name}>
                      <td className="px-5 py-2">
                        <span className="font-semibold text-ink">Option {c.name}</span>
                        <span className="block text-[12px] text-muted">
                          {c.changes} {c.changes === 1 ? 'change' : 'changes'}
                        </span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{short(c.outcome.finish)}</td>
                      <td className={cn('px-3 py-2 tabular-nums', d !== null && d < 0 ? 'text-success' : d !== null && d > 0 ? 'text-warning' : 'text-muted')}>
                        {d === null || d === 0 ? 'same' : `${Math.abs(d)} working ${Math.abs(d) === 1 ? 'day' : 'days'} ${d > 0 ? 'later' : 'earlier'}`}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{vs === null ? '—' : vs > 0 ? `${vs} days past` : vs === 0 ? 'on the day' : `${-vs} days before`}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {c.outcome.late.length}
                        {c.diff.newlyLate.length > 0 && <span className="text-danger"> (+{c.diff.newlyLate.length} newly)</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button variant="ghost" size="xs" disabled={c.name === plan.active} onClick={() => setPlan((p) => ({ ...p, active: c.name }))}>
                          {c.name === plan.active ? 'Showing' : 'Show'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-5 py-2.5 text-[12px] text-muted">Each option is projected the same way from the same records. Applying saves the option you’re showing, after you confirm.</p>
        </section>
      )}

      <div className="grid gap-8 2xl:grid-cols-[360px_minmax(0,1fr)]">
        {/* Scenario builder: a row of three cards, or a column beside the table on wide screens. */}
        <div className="grid content-start gap-6 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-1">
          <ScenarioBuilder
            tasks={tasks.filter((t) => t.status !== 'DONE')}
            people={people.map((m) => ({ id: m.user.id, name: m.user.name }))}
            onAdd={(t) => setTweaks((ts) => [...ts.filter((x) => !(x.kind !== 'timeOff' && t.kind !== 'timeOff' && t.kind === x.kind && x.taskId === t.taskId)), t])}
          />
          <Card>
            <CardHeader
              title={`Option ${plan.active}`}
              description={hasTweaks ? `${liveTweaks.length} change${liveTweaks.length === 1 ? '' : 's'}, only in this browser until applied.` : 'No changes yet: the table shows the current plan.'}
              action={
                tweaks.length > 0 ? (
                  <Button variant="ghost" size="xs" leftIcon={<RotateCcw />} onClick={() => setTweaks([])}>
                    Reset
                  </Button>
                ) : null
              }
            />
            <div className="px-5 pt-1" data-plan-options="">
              <Segmented
                label="Option"
                value={plan.active}
                onChange={(v) => setPlan((p) => ({ ...p, active: v }))}
                options={OPTIONS.map((n) => ({ value: n, label: `Option ${n}`, count: plan.options[n].length || undefined }))}
              />
              <p className="mt-1.5 text-[12px] text-muted">Build up to three options, compare them above, then apply the one you choose.</p>
            </div>
            <CardBody className="py-2">
              {tweaks.length === 0 ? (
                <p className="py-3 text-[13px] text-muted">Try moving work to someone else, changing an estimate or adding time off.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {tweaks.map((tw, i) => {
                    const t = tw.kind === 'timeOff' ? null : taskById.get(tw.taskId);
                    const ignored = tw.kind !== 'timeOff' && !openIds.has(tw.taskId);
                    return (
                      <li key={i} className={cn('flex items-start gap-3 py-2.5 text-[13px]', ignored && 'opacity-50')}>
                        {tw.kind === 'reassign' ? <Users className="mt-0.5 size-4 text-muted" aria-hidden="true" /> : tw.kind === 'estimate' ? <Hourglass className="mt-0.5 size-4 text-muted" aria-hidden="true" /> : <CalendarOff className="mt-0.5 size-4 text-muted" aria-hidden="true" />}
                        <span className="min-w-0 flex-1 text-ink-2">
                          {tw.kind === 'reassign' && (
                            <>
                              <span className="font-mono text-xs text-muted">{t?.key ?? 'Deleted task'}</span> → {nameOf(tw.assigneeId)}
                            </>
                          )}
                          {tw.kind === 'estimate' && (
                            <>
                              <span className="font-mono text-xs text-muted">{t?.key ?? 'Deleted task'}</span> estimate {tw.days} working {tw.days === 1 ? 'day' : 'days'}
                            </>
                          )}
                          {tw.kind === 'timeOff' && (
                            <>
                              {nameOf(tw.userId)} off {short(tw.from)} – {short(tw.to)} <span className="text-xs text-muted">(simulation only)</span>
                            </>
                          )}
                          {ignored && <span className="block text-xs text-muted">Ignored: the task is done or no longer exists.</span>}
                        </span>
                        <button type="button" onClick={() => setTweaks((ts) => ts.filter((_, j) => j !== i))} className="text-muted hover:text-danger" aria-label="Remove change">
                          <Trash2 className="size-4" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* Apply ------------------------------------------------------------------------ */}
          <Card>
            <CardHeader title="Apply" description={canApply ? 'Saves the changes below in one step. If anyone changed these tasks since, nothing is saved.' : 'Only owners and managers can apply a plan. You can still explore scenarios.'} />
            <CardBody className="space-y-4">
              <label className="flex items-start gap-2 text-[13px] text-ink-2">
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--brand)]" checked={adoptDates} onChange={(e) => setAdoptDates(e.target.checked)} />
                <span>
                  Move the due dates of the {scenario.late.length} task{scenario.late.length === 1 ? '' : 's'} projected late to their projected finish
                </span>
              </label>
              {changes.length > 0 ? (
                <ul className="max-h-60 space-y-1 overflow-y-auto text-xs text-ink-2">
                  {changes.map((c) => {
                    const t = taskById.get(c.taskId)!;
                    return (
                      <li key={c.taskId} className="flex flex-wrap gap-x-2">
                        <span className="font-mono text-muted">{t.key}</span>
                        {c.dueDate && (
                          <span>
                            due {short(t.dueDate)} → <strong className="font-medium text-ink">{short(c.dueDate)}</strong>
                          </span>
                        )}
                        {c.assigneeId !== undefined && c.assigneeId !== null && <span>→ {nameOf(c.assigneeId)}</span>}
                        {c.unassign && <span>→ unassigned</span>}
                        {c.estimateDays && <span>estimate {c.estimateDays}d</span>}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-[13px] text-muted">No changes to save.</p>
              )}
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Why? (sent to people whose dates move)" aria-label="Reason for the change" disabled={!canApply} />
              <FormError message={applyError} />
              {stale && (
                <Button variant="secondary" size="sm" leftIcon={<RotateCcw />} onClick={() => void recalculate()}>
                  Recalculate with the latest data
                </Button>
              )}
              <Button className="w-full" leftIcon={<CalendarClock />} onClick={() => setConfirmApply(true)} disabled={!canApply || changes.length === 0 || stale} loading={applyState.isLoading}>
                Apply {changes.length || ''} change{changes.length === 1 ? '' : 's'}
              </Button>
              <ConfirmDialog
                open={confirmApply}
                onOpenChange={setConfirmApply}
                title={`Apply ${changes.length} ${changes.length === 1 ? 'change' : 'changes'} to the project?`}
                description={
                  <>
                    Assignees, estimates and due dates change for real, and everyone whose work moves is notified
                    {note.trim() ? ' with your reason' : ''}. Each task’s history keeps the old values.
                  </>
                }
                confirmLabel="Apply changes"
                tone="primary"
                loading={applyState.isLoading}
                onConfirm={apply}
              />
            </CardBody>
          </Card>
        </div>

        {/* Projection table -------------------------------------------------------------- */}
        <div className="min-w-0">
          {rows.length === 0 ? (
            <EmptyState icon={CalendarClock} title="Nothing open to plan" description="Every task in this project is done." />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
              <table className="w-full min-w-[860px] text-left text-[13px]">
                <thead className="border-b border-line">
                  <tr className="text-[12px] font-medium text-muted">
                    <th className="px-4 py-3 font-semibold">Task</th>
                    <th className="px-3 py-3 font-semibold">Assignee</th>
                    <th className="px-3 py-3 font-semibold">Estimate</th>
                    <th className="px-3 py-3 font-semibold">Projected</th>
                    <th className="px-3 py-3 font-semibold">Due</th>
                    <th className="px-3 py-3 font-semibold">Slip</th>
                    <th className="px-4 py-3 font-semibold">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((s) => {
                    const t = taskById.get(s.taskId)!;
                    const st = scenarioTask(s.taskId)!;
                    const b = baseline.scheduled.get(s.taskId);
                    const moved = hasTweaks && b && b.finish !== s.finish;
                    const reassigned = (t.assignee?.id ?? null) !== st.assigneeId;
                    return (
                      <tr key={s.taskId} className={cn('align-top', moved && 'bg-accent/5')}>
                        <td className="px-4 py-3">
                          <Link to={`/projects/${project.id}/tasks/${t.id}`} className="group block">
                            <span className="mr-2 font-mono text-xs text-muted">{t.key}</span>
                            <span className="text-ink group-hover:text-accent">{t.title}</span>
                          </Link>
                          <span className="mt-1 inline-block">
                            <StatusBadge status={t.status} />
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className={cn('inline-flex items-center gap-1.5', reassigned && 'font-medium text-accent')}>
                            <Avatar user={userOf(st.assigneeId)} size="sm" />
                            {nameOf(st.assigneeId).split(' ')[0]}
                          </span>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap tabular">
                          {st.estimateDays !== null ? (
                            <span className={cn(st.estimateDays !== t.estimateDays && 'font-medium text-accent')}>{st.estimateDays}d est.</span>
                          ) : (
                            <span className="text-warning">1d assumed</span>
                          )}
                          {t.status === 'IN_PROGRESS' && <span className="block text-[12px] text-muted">{s.remainingDays}d left</span>}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap tabular">
                          {short(s.start)} <ArrowRight className="inline size-3 text-muted" aria-label="to" /> <strong className="font-medium text-ink">{short(s.finish)}</strong>
                          {moved && b && <span className="block text-[12px] text-muted line-through">{short(b.finish)}</span>}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap tabular">{short(t.dueDate)}</td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <Slip s={s} />
                        </td>
                        <td className="px-4 py-3 text-xs text-muted">
                          <ul className="space-y-0.5">
                            {s.flags.includes('WAITING_ON_BLOCKER') && s.drivenBy !== null && (
                              <li className="flex items-center gap-1">
                                <Lock className="size-3" aria-hidden="true" /> starts after {taskById.get(s.drivenBy)?.key}
                              </li>
                            )}
                            {s.flags.includes('UNASSIGNED') && (
                              <li className="flex items-center gap-1">
                                <UserRound className="size-3" aria-hidden="true" /> unassigned, so nobody’s time is booked
                              </li>
                            )}
                            {s.flags.includes('AWAITING_REVIEW') && <li>awaiting review</li>}
                            {s.flags.includes('NO_ESTIMATE') && (
                              <li className="flex items-center gap-1 text-warning">
                                <AlertTriangle className="size-3" aria-hidden="true" /> no estimate
                              </li>
                            )}
                          </ul>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScenarioBuilder({ tasks, people, onAdd }: { tasks: Task[]; people: { id: number; name: string }[]; onAdd: (t: Tweak) => void }) {
  const [kind, setKind] = useState<Tweak['kind']>('reassign');
  const [taskId, setTaskId] = useState('');
  const [person, setPerson] = useState('');
  const [days, setDays] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const sorted = [...tasks].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  const valid =
    kind === 'reassign' ? !!taskId : kind === 'estimate' ? !!taskId && /^\d+$/.test(days) && Number(days) >= 1 && Number(days) <= 250 : !!person && !!from && !!to;

  const add = () => {
    if (!valid) return;
    if (kind === 'reassign') onAdd({ kind, taskId: Number(taskId), assigneeId: person ? Number(person) : null });
    else if (kind === 'estimate') onAdd({ kind, taskId: Number(taskId), days: Number(days) });
    else onAdd({ kind, userId: Number(person), from, to });
    setTaskId('');
    setDays('');
  };

  return (
    <Card>
      <CardHeader title="Try a change" />
      <CardBody className="space-y-3">
        <Select aria-label="Kind of change" value={kind} onChange={(e) => setKind(e.target.value as Tweak['kind'])}>
          <option value="reassign">Give a task to someone else</option>
          <option value="estimate">Change an estimate</option>
          <option value="timeOff">Add time off (simulation only)</option>
        </Select>
        {kind !== 'timeOff' && (
          <Select aria-label="Task" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">Choose a task</option>
            {sorted.map((t) => (
              <option key={t.id} value={t.id}>
                {t.key}: {t.title}
                {t.estimateDays ? ` (${t.estimateDays}d est.)` : ' (no estimate)'}
              </option>
            ))}
          </Select>
        )}
        {kind !== 'estimate' && (
          <Select aria-label="Person" value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">{kind === 'reassign' ? 'Unassigned' : 'Choose a person'}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
        {kind === 'estimate' && <Input type="number" min={1} max={250} value={days} onChange={(e) => setDays(e.target.value)} placeholder="Working days" aria-label="New estimate in working days" />}
        {kind === 'timeOff' && (
          <div className="grid grid-cols-2 gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="First day off" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Last day off" />
          </div>
        )}
        <Button variant="secondary" className="w-full" leftIcon={<Plus />} onClick={add} disabled={!valid}>
          Add to scenario
        </Button>
      </CardBody>
    </Card>
  );
}

