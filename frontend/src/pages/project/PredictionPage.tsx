import { CalendarClock, Gauge, LineChart, ListTodo, Target } from 'lucide-react';
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Role } from '@/api/types';
import { useBoardTasksQuery } from '@/api/endpoints';
import { PrintButton } from '@/components/PrintHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { LastUpdated } from '@/components/ui/LastUpdated';
import { ProgressBar } from '@/components/ui/Progress';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Spinner';
import { StatGrid, StatTile } from '@/components/ui/StatTile';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { useProjectModel } from '@/features/model/useProjectModel';
import { chancePct, formatDay, paceWords, pct, ROLE_LABEL_ONE } from '@/features/predictions/format';
import { useProjectContext } from '@/features/projects/projectContext';
import { cn } from '@/lib/cn';
import { effortText } from '@/lib/forecastText';
import { checkRanges, forecastProgress, type GroupForecast, type PersonForecast } from '@/lib/progressForecast';
import { learn, predict } from '@/lib/projectLearner';

// three.js loads only on this page.
const ProgressChartCanvas = lazy(() => import('@/features/predictions/ProgressChartCanvas'));

type Filter = 'ALL' | Role | 'NONE';
/** One row of equal cards, however many kinds of member there are. */
const XL_COLS = ['', 'xl:grid-cols-1', 'xl:grid-cols-2', 'xl:grid-cols-3', 'xl:grid-cols-4', 'xl:grid-cols-5'];

/** Swatch colours for each role (the 3D chart reads the same CSS variables). */
const ROLE_SWATCH: Record<Role | 'NONE', string> = {
  OWNER: 'bg-[var(--role-owner)]',
  MANAGER: 'bg-[var(--role-manager)]',
  MEMBER: 'bg-[var(--role-member)]',
  VIEWER: 'bg-[var(--role-viewer)]',
  NONE: 'bg-[var(--role-none)]',
};
const ROLE_FOCUS: Record<Role | 'NONE', string> = {
  OWNER: 'Owners set the dates and the team, and approve work.',
  MANAGER: 'Managers plan, assign and review others’ work.',
  MEMBER: 'Members do assigned work and submit it with evidence.',
  VIEWER: 'Viewers follow along; no work is assigned to them.',
  NONE: 'Open tasks nobody is assigned to, forecast as if someone started them today.',
};

/**
 * Prediction model: each person's approved work over time, recorded and then predicted, in 3D and
 * as tables, for everyone or one kind of member at a time. Every number is computed in the browser
 * from this project's records; predictions are labelled as estimates with a range.
 */
export function PredictionPage() {
  const { project } = useProjectContext();
  const pm = useProjectModel(project);
  const tasks = useBoardTasksQuery(project.id);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [highlight, setHighlight] = useState<string | null>(null);

  const forecast = useMemo(
    () => (pm.model && tasks.currentData?.length ? forecastProgress({ model: pm.model, tasks: tasks.currentData, members: project.members }) : null),
    [pm.model, tasks.currentData, project.members],
  );

  const rangeCheck = useMemo(() => (pm.model && tasks.currentData ? checkRanges(tasks.currentData, pm.model) : null), [pm.model, tasks.currentData]);

  // The built-in lateness model: each person's riskiest open task.
  const risks = useMemo(() => {
    const out = new Map<string, { key: string; id: number; p: number }>();
    if (!pm.model || !tasks.currentData?.length) return out;
    const learned = learn(tasks.currentData, pm.model);
    if (!learned.risk) return out;
    const blocks = new Map(pm.model.blocks.map((b) => [b.id, b]));
    for (const t of tasks.currentData) {
      const b = blocks.get(t.id);
      if (!b || t.status === 'DONE' || !t.assignee) continue;
      const p = predict(learned, t, b, pm.model.todayDay).pLate;
      if (p === null) continue;
      const cur = out.get(t.assignee.name);
      if (!cur || p > cur.p) out.set(t.assignee.name, { key: t.key, id: t.id, p });
    }
    return out;
  }, [pm.model, tasks.currentData]);

  const error = pm.error ?? tasks.error;
  if (error) {
    return (
      <Shell>
        <ErrorState error={error} title="Couldn’t load this project’s records" onRetry={() => (pm.refetch(), void tasks.refetch())} />
      </Shell>
    );
  }
  if (pm.loading || tasks.isLoading || !pm.model) return <LoadingView />;
  if (!forecast) {
    return (
      <Shell>
        <Card>
          <EmptyState
            icon={LineChart}
            title="Nothing to predict yet"
            description="Predictions are built from this project’s tasks: who has them, their estimates and how long finished ones took. Add tasks to see them."
            action={
              <Link to="../board" relative="path" className="text-[13px] font-medium text-accent hover:underline">
                Go to the board
              </Link>
            }
          />
        </Card>
      </Shell>
    );
  }

  const originMs = pm.model.originMs;
  const groups = forecast.roles;
  const group: GroupForecast = filter === 'ALL' ? forecast.project : (groups.find((g) => g.key === filter) ?? forecast.project);
  const people = forecast.people.filter((p) => filter === 'ALL' || (p.role ?? 'NONE') === filter);
  const noHistory = forecast.learnedFrom === 0;

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-ink">Progress, recorded and predicted</h2>
          <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-muted">
            Each person’s approved tasks over time. Up to today it’s the record; after today it’s an estimate from {forecast.runs} simulated runs of the open work, with
            dependencies and reviews. It predicts each person’s own work and never ranks people. Choose a kind of member to focus on.
          </p>
        </div>
        <div className="flex max-w-full min-w-0 flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap items-center gap-2" data-print="hide">
            <LastUpdated at={tasks.fulfilledTimeStamp} onRefresh={() => void tasks.refetch()} refreshing={tasks.isFetching} className="mr-1" />
            <PrintButton variant="ghost" size="sm" />
          </div>
          <div className="scrollbar-thin max-w-full overflow-x-auto">
            <Segmented<Filter>
              label="Show"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'ALL', label: 'Everyone', count: forecast.people.filter((p) => p.userId).length },
                // "Not assigned" counts open tasks; the roles count people.
                ...groups.map((g) => ({ value: g.key as Filter, label: g.label, count: g.key === 'NONE' ? g.open : g.people })),
              ]}
            />
          </div>
        </div>
      </div>

      {noHistory && (
        <p className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-2.5 text-[13px] text-warning" role="status">
          No finished task has an estimate yet, so everyone is assumed to work on estimate with a wide range. Predictions sharpen as estimated tasks are approved.
        </p>
      )}

      <StatGrid cols={4}>
        <StatTile
          label="Likely finish"
          icon={CalendarClock}
          value={group.finish ? formatDay(originMs, group.finish.p50) : '–'}
          hint={group.finish ? `Range ${formatDay(originMs, group.finish.p10)} – ${formatDay(originMs, group.finish.p90)}` : 'Nothing open'}
        />
        <StatTile
          label="Chance by deadline"
          icon={Target}
          tone={group.pDeadline === null ? 'neutral' : group.pDeadline >= 0.8 ? 'success' : group.pDeadline >= 0.5 ? 'warning' : 'danger'}
          value={group.pDeadline === null ? '–' : chancePct(group.pDeadline)}
          hint={forecast.deadlineDay === null ? 'This project has no deadline' : `Deadline ${formatDay(originMs, forecast.deadlineDay)}`}
        />
        <StatTile label="Open tasks" icon={ListTodo} value={group.open} hint={`${group.approved} of ${group.total} approved`} />
        {/* Calibration: do about 80% of real outcomes fall inside the 80% ranges? */}
        <StatTile
          label="How good are the ranges?"
          icon={Gauge}
          value={rangeCheck?.coverage != null ? pct(rangeCheck.coverage) : '–'}
          hint={
            !rangeCheck || rangeCheck.coverage === null
              ? `Too few finished tasks to check yet (${rangeCheck?.n ?? 0}; needs 5)`
              : `of ${rangeCheck.n} finished tasks took a time inside the 80% range predicted for them from the others (about 80% is right). Typical error ${rangeCheck.medianErrorDays!.toFixed(1)} working days.`
          }
        />
      </StatGrid>

      <Card>
        <CardHeader
          title="Each person’s work, recorded and predicted"
          description="One lane per person, grouped by role. Height is the share of their tasks approved, up to the dashed line at 100%. Solid is recorded; after today, the translucent shape is the typical prediction and the pale band runs from optimistic to cautious. Drag to turn it."
        />
        <p data-print="canvas-note" className="border-b border-line px-5 py-4 text-[12px] text-muted">
          The 3D chart isn’t printed. The table “By person” below has the same numbers.
        </p>
        <div className="bg-plate h-[440px] border-y border-line sm:h-[540px]" data-print="hide">
          {people.length ? (
            <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
              <ProgressChartCanvas forecast={forecast} people={people} originMs={originMs} highlight={highlight} />
            </Suspense>
          ) : (
            <EmptyState icon={LineChart} title="No one here" description="Nobody in this project has this role." compact className="h-full" />
          )}
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-2 px-5 py-3 text-[12px] text-muted">
          {groups.map((g) => (
            <li key={g.key} className="flex items-center gap-1.5">
              <span className={cn('size-2.5 rounded-sm', ROLE_SWATCH[g.key as Role | 'NONE'])} aria-hidden="true" /> {g.label}
            </li>
          ))}
        </ul>
      </Card>

      <section aria-labelledby="by-role">
        <h2 id="by-role" className="caps mb-3 text-ink">
          By kind of member
        </h2>
        <div className={cn('grid gap-4 sm:grid-cols-2', XL_COLS[Math.min(5, filter === 'ALL' ? groups.length : 1)])}>
          {groups
            .filter((g) => filter === 'ALL' || g.key === filter)
            .map((g) => (
              <RoleCard key={g.key} g={g} originMs={originMs} onPick={() => setFilter(g.key as Filter)} active={filter === g.key} />
            ))}
        </div>
      </section>

      <Card>
        <CardHeader
          title="By person"
          description="Each person’s own forecast: this isn’t a ranking, and the numbers don’t compare people doing different work. Point at a row to find the person in the chart. Risk is the built-in model’s chance their riskiest open task finishes late."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-[13px]">
            <thead className="border-b border-line bg-surface-2 text-xs text-muted">
              <tr>
                <th className="px-5 py-2.5 font-medium">Person</th>
                <th className="px-3 py-2.5 font-medium">Role</th>
                <th className="px-3 py-2.5 text-right font-medium">Approved</th>
                <th className="px-3 py-2.5 text-right font-medium">Open</th>
                <th className="px-3 py-2.5 font-medium">Effort left</th>
                <th className="px-3 py-2.5 font-medium">Waiting</th>
                <th className="px-3 py-2.5 font-medium">All approved (typical, then the range)</th>
                <th className="px-3 py-2.5 text-right font-medium">By deadline</th>
                <th className="px-5 py-2.5 font-medium">Riskiest open task</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {people.map((p) => (
                <PersonRow key={p.name} p={p} originMs={originMs} risk={risks.get(p.name)} projectId={project.id} onHover={setHighlight} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <details>
          <summary className="cursor-pointer px-5 py-3.5 text-[13px] font-medium text-ink hover:bg-surface-2">How these predictions are made</summary>
          <CardBody className="space-y-2 border-t border-line text-[13px] leading-relaxed text-ink-2">
            <p>
              <strong className="font-medium text-ink">Recorded:</strong> each person’s approved tasks by day, replayed from the status changes.
            </p>
            <p>
              <strong className="font-medium text-ink">Pace:</strong> for each person, the time their finished tasks took compared with their estimates, pulled towards the
              project’s average when they’ve finished few ({forecast.learnedFrom} finished tasks with estimates so far). How much that ratio varies sets how wide their range is.
            </p>
            <p>
              <strong className="font-medium text-ink">Simulation:</strong> {forecast.runs} runs. In each, every person does one task at a time. A task starts only when
              everything it waits on is approved; while one task waits, the person picks up another that can start (in progress first, then by due date and priority). Tasks
              without an estimate count as the project’s typical estimate. Each submitted task then waits about {forecast.reviewLag.toFixed(1)} days in review, which is how long
              approved tasks usually waited here.
            </p>
            <p>
              <strong className="font-medium text-ink">Effort and delivery are different:</strong> “Effort left” is the work itself (estimates times pace). The finish dates also
              include waiting for other people’s work and for reviews, which is why someone with a few days of work can still finish late.
            </p>
            <p>
              <strong className="font-medium text-ink">Range:</strong> typical is the middle run. The range runs from the optimistic (10th percentile) to the cautious
              (90th). The chance by the deadline is the share of runs finished by then.
            </p>
            <p className="text-muted">
              Not included: holidays and time off (see Schedule → What if), new tasks that haven’t been created yet, and people sharing work.
              {forecast.unassignedOpen > 0 && ` ${forecast.unassignedOpen} open ${forecast.unassignedOpen === 1 ? 'task has' : 'tasks have'} nobody assigned; the forecast assumes someone starts ${forecast.unassignedOpen === 1 ? 'it' : 'them'} today.`}{' '}
              It’s an estimate from the records, not a commitment.
            </p>
          </CardBody>
        </details>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6 lg:px-10">{children}</div>;
}

function LoadingView() {
  return (
    <Shell>
      <div role="status" aria-label="Loading the prediction model" className="space-y-6">
        <Skeleton className="h-16 w-full max-w-2xl" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-[520px]" />
        <Skeleton className="h-64" />
      </div>
    </Shell>
  );
}

function RoleCard({ g, originMs, onPick, active }: { g: GroupForecast; originMs: number; onPick: () => void; active: boolean }) {
  const key = g.key as Role | 'NONE';
  const progress = g.total ? Math.round((g.approved / g.total) * 100) : 0;
  return (
    <button type="button" onClick={onPick} aria-pressed={active} className={cn('flex h-full flex-col rounded-lg border bg-surface p-4 text-left shadow-card transition-colors hover:bg-surface-2', active ? 'border-accent' : 'border-line')}>
      <span className="flex items-center gap-2">
        <span className={cn('size-2.5 rounded-sm', ROLE_SWATCH[key])} aria-hidden="true" />
        <span className="text-[14px] font-semibold text-ink">{g.label}</span>
        <span className="ml-auto text-xs text-muted tabular">
          {g.people} {g.people === 1 ? 'person' : 'people'}
        </span>
      </span>
      <span className="mt-1 text-[12px] leading-snug text-muted">{ROLE_FOCUS[key]}</span>
      <span className="mt-3 flex items-baseline justify-between text-[12.5px] text-ink-2 tabular">
        <span>
          {g.approved}/{g.total} approved
        </span>
        <span>{g.open} open</span>
      </span>
      <ProgressBar value={progress} className="mt-1.5" label={`${g.label} progress`} />
      <span className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
        <span>
          <span className="block text-muted">All approved</span>
          <span className="font-medium text-ink">{g.finish ? formatDay(originMs, g.finish.p50) : g.total ? 'Done' : '–'}</span>
        </span>
        <span>
          <span className="block text-muted">By deadline</span>
          <span className="font-medium text-ink">{chancePct(g.pDeadline)}</span>
        </span>
      </span>
    </button>
  );
}

function PersonRow({ p, originMs, risk, projectId, onHover }: { p: PersonForecast; originMs: number; risk?: { key: string; id: number; p: number }; projectId: number; onHover: (name: string | null) => void }) {
  return (
    <tr onMouseEnter={() => onHover(p.name)} onMouseLeave={() => onHover(null)} className="hover:bg-surface-2/70">
      <td className="px-5 py-2.5">
        {p.userId ? (
          <Link to={`/projects/${projectId}/tasks?assignee=${p.userId}`} className="font-medium text-ink hover:text-accent" onFocus={() => onHover(p.name)} onBlur={() => onHover(null)}>
            {p.name}
          </Link>
        ) : (
          <span className="font-medium text-ink">{p.name}</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-muted">{p.role ? ROLE_LABEL_ONE[p.role] : '–'}</td>
      <td className="px-3 py-2.5 text-right tabular">
        {p.approved}/{p.total}
      </td>
      <td className="px-3 py-2.5 text-right tabular">{p.open}</td>
      <td className="px-3 py-2.5 text-ink-2" title={p.pace.n ? `Their tasks took ${paceWords(p.pace.ratio)} their estimates (${p.pace.n} finished)` : 'No finished tasks of theirs yet: the project’s average is used'}>
        {p.effort ? effortText(p.effort) : <span className="text-muted">–</span>}
      </td>
      <td className="px-3 py-2.5 text-ink-2">
        {p.mainDependency ? (
          <Link to={`/projects/${projectId}/tasks/${p.mainDependency.taskId}`} className="hover:underline">
            ~{Math.max(1, Math.round(p.waitingDays))} d on {p.mainDependency.key}
          </Link>
        ) : p.open ? (
          <span className="text-muted">None</span>
        ) : (
          <span className="text-muted">–</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-ink-2">
        {p.finish ? (
          <>
            <span className="font-medium text-ink">{formatDay(originMs, p.finish.p50)}</span>
            <span className="block text-[12.5px] text-muted">
              {formatDay(originMs, p.finish.p10)} – {formatDay(originMs, p.finish.p90)}
              {p.unpredictable && ' (if someone starts today)'}
            </span>
          </>
        ) : p.total ? (
          <span className="text-muted">All approved</span>
        ) : (
          <span className="text-muted">No tasks</span>
        )}
      </td>
      <td className={cn('px-3 py-2.5 text-right tabular', p.pDeadline !== null && p.pDeadline < 0.5 ? 'text-danger' : 'text-ink-2')}>{chancePct(p.pDeadline)}</td>
      <td className="px-5 py-2.5">
        {risk ? (
          <Link to={`/projects/${projectId}/tasks/${risk.id}`} className={cn('tabular hover:underline', risk.p >= 0.5 ? 'text-danger' : 'text-ink-2')}>
            <span className="font-medium">{risk.key}</span>, {chancePct(risk.p)} chance it’s late
          </Link>
        ) : (
          <span className="text-muted">–</span>
        )}
      </td>
    </tr>
  );
}
