import { Info } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { ProjectDetail } from '@/api/types';
import { useAppSelector } from '@/app/store';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/States';
import { reviewBlockers } from '@/features/assistant/flurryReports';
import { cn } from '@/lib/cn';
import { STATUS_LABEL } from '@/lib/constants';
import { formatDate, parseLocalDate, timeAgo, todayIso } from '@/lib/dates';
import { dataQuality, type PersonForecast, type ProgressForecast, type RangeCheck } from '@/lib/progressForecast';
import { dateRange, dayText, deadlineWords, effortText, forecastFor, projectBlocker } from '@/lib/forecastText';
import { useDeliveryForecast, type DeliveryForecastData } from './useDeliveryForecast';

const TONE_TEXT = { success: 'text-success', warning: 'text-warning', danger: 'text-danger', neutral: 'text-muted' } as const;

/** "Planning estimate · updated after CCP-9 moved to In review, 2 hours ago". */
function Freshness({ data }: { data: DeliveryForecastData }) {
  const c = data.lastChange;
  return (
    <p className="text-[12px] text-muted" data-forecast-updated="">
      Planning estimate from the records{c ? `, updated after ${c.key} moved to ${STATUS_LABEL[c.status]} ${timeAgo(c.at.toISOString())}` : ''}. Not a commitment.
    </p>
  );
}

/**
 * The plan (every task exactly on estimate) next to the forecast, with the reason they differ, so
 * the two numbers never look like a contradiction.
 */
function PlanNote({ f, originMs, planIso }: { f: ProgressForecast; originMs: number; planIso: string | null }) {
  if (!planIso || !f.project.finish) return null;
  const planDay = (parseLocalDate(planIso).getTime() - originMs) / 86_400_000;
  const gap = Math.round(f.project.finish.p50 - planDay);
  if (Math.abs(gap) < 2) return null;
  const reasons = [
    f.paceRatio >= 1.15 ? `finished tasks here took about ${f.paceRatio.toFixed(1)}× their estimates` : f.paceRatio <= 0.87 ? 'finished tasks here took less time than their estimates' : '',
    gap > 0 ? `each review takes about ${f.reviewLag.toFixed(1)} days` : '',
    gap > 0 && f.people.some((p) => p.waitingDays >= 1) ? 'some work waits on other work' : '',
  ].filter(Boolean);
  return (
    <p className="mt-1 text-[13px] leading-relaxed text-muted" data-forecast-plan="">
      The plan, if every task takes exactly its estimate: {formatDate(planIso, 'd MMM')}. The forecast is {Math.abs(gap)} days {gap > 0 ? 'later' : 'earlier'}
      {reasons.length ? ` because ${reasons.join(', ')}` : ''}.
    </p>
  );
}

/**
 * When the health badge and the forecast seem to disagree, say why: health looks at warning signs
 * today (overdue work, tasks approved against time gone), the forecast at everything still to do.
 */
function HealthNote({ project, pDeadline }: { project: ProjectDetail; pDeadline: number | null }) {
  if (project.status !== 'ACTIVE' || pDeadline === null) return null;
  const worried = project.health === 'AT_RISK' || project.health === 'OFF_TRACK';
  if (!(worried && pDeadline >= 0.8) && !(project.health === 'ON_TRACK' && pDeadline < 0.5)) return null;
  return (
    <p className="mt-1 text-[13px] leading-relaxed text-muted" data-forecast-health="">
      {worried
        ? `Health still says ${project.health === 'AT_RISK' ? 'At risk' : 'Off track'}: it flags warning signs today (${project.healthReasons.map((r) => r.replace(/\.$/, '').toLowerCase()).join('; ')}). The forecast looks at all the work left and how long work really takes, and expects the deadline to hold if nothing changes.`
        : 'Health says On track because nothing is overdue yet, but the forecast, which includes all the work left and how long work really takes, expects the deadline to slip.'}
    </p>
  );
}

/** A thin strip: today, the likely finish window (with its most likely day), and the deadline. */
function WindowStrip({ f, originMs }: { f: ProgressForecast; originMs: number }) {
  const r = f.project.finish;
  if (!r) return null;
  const start = f.todayDay;
  const end = Math.max(r.p90, f.deadlineDay ?? 0) + 2;
  const x = (day: number) => `${Math.min(100, Math.max(0, ((day - start) / Math.max(1, end - start)) * 100))}%`;
  return (
    <div className="mt-5" aria-hidden="true">
      <div className="relative h-8">
        <div className="absolute inset-x-0 top-3.5 h-px bg-line-strong" />
        <div className="absolute top-2 h-4 rounded-full bg-brand-soft ring-1 ring-accent/40" style={{ left: x(r.p10), width: `calc(${x(r.p90)} - ${x(r.p10)})` }} />
        <div className="absolute top-1 h-6 w-0.5 rounded-full bg-accent" style={{ left: x(r.p50) }} />
        <div className="absolute top-0 h-8 w-px bg-ink" style={{ left: 0 }} />
        {f.deadlineDay !== null && <div className="absolute top-0 h-8 w-px bg-danger" style={{ left: x(f.deadlineDay) }} />}
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-muted">
        <span className="absolute left-0">Today</span>
        {f.deadlineDay !== null && (
          <span className="absolute -translate-x-1/2 text-danger" style={{ left: x(f.deadlineDay) }}>
            Deadline {dayText(originMs, f.deadlineDay)}
          </span>
        )}
      </div>
    </div>
  );
}

function Assumptions({ f, check, extra }: { f: ProgressForecast; check: RangeCheck | null; extra?: ReactNode }) {
  const q = dataQuality(f.learnedFrom);
  return (
    <details className="group mt-4 border-t border-line pt-3 text-[13px]" data-forecast-assumptions="">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
        <Info className="size-3.5 text-muted" aria-hidden="true" />
        How this is worked out, and what it assumes
        <span className="text-muted group-open:hidden">(show)</span>
      </summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-2 marker:text-subtle">
        <li>
          {f.runs} simulations of the open work. Each person does one task at a time, on weekdays, and a task starts only when everything it waits on is approved. Each task takes its
          estimate times the pace of that person’s finished tasks, then waits about {f.reviewLag.toFixed(1)} days for review, as reviews here have.
        </li>
        <li>{q.label}</li>
        {f.unestimatedOpen > 0 && (
          <li>
            {f.unestimatedOpen} open {f.unestimatedOpen === 1 ? 'task has' : 'tasks have'} no estimate, so the project’s typical {f.typicalEstimate} working{' '}
            {f.typicalEstimate === 1 ? 'day was' : 'days were'} used.
          </li>
        )}
        {f.unownedKeys.length > 0 && (
          <li>
            Nobody owns {f.unownedKeys.slice(0, 4).join(', ')}
            {f.unownedKeys.length > 4 ? ` and ${f.unownedKeys.length - 4} more` : ''}. The forecast assumes someone starts {f.unownedKeys.length === 1 ? 'it' : 'them'} today.
          </li>
        )}
        {check && (
          <li data-range-check="">
            {check.coverage === null
              ? `How good are the ranges? Too few finished tasks to check yet (${check.n}).`
              : `How good are the ranges? Of ${check.n} finished tasks, ${check.inside} (${Math.round(check.coverage * 100)}%) took a time inside the 80% range predicted for them from the others${
                  check.coverage < 0.65 ? ', so these ranges are probably too narrow' : check.coverage > 0.95 ? ', so these ranges are probably wider than they need to be' : ''
                }. Typical error: ${check.medianErrorDays!.toFixed(1)} working days per task.`}
          </li>
        )}
        <li>Unknown future work, holidays and time off aren’t included. People are never compared: pace only predicts each person’s own work.</li>
        {extra}
      </ul>
    </details>
  );
}

/**
 * The project's delivery forecast, first on the Overview and Reports: the likely finish window
 * against the deadline, the one thing holding work up, and the next move. Everything is computed
 * from the records in the browser and labelled as a planning estimate.
 */
export function DeliveryForecastCard({ project, data: given, className }: { project: ProjectDetail; data?: DeliveryForecastData; className?: string }) {
  const own = useDeliveryForecast(given ? null : project);
  const data = given ?? own;
  const { forecast: f, model } = data;
  const blocker = useMemo(() => (f ? projectBlocker(f) : null), [f]);
  const findings = useMemo(
    () =>
      data.tasks
        ? reviewBlockers({ project, tasks: data.tasks, dependencies: data.dependencies ?? [], milestones: data.milestones ?? [], analysis: data.analysis, today: todayIso() })
        : [],
    [data.tasks, data.dependencies, data.milestones, data.analysis, project],
  );

  if (data.error) {
    return (
      <Card className={cn('p-6', className)}>
        <ErrorState error={data.error} title="Couldn’t load the records for the forecast" onRetry={data.refetch} />
      </Card>
    );
  }
  if (!model || data.loading) {
    return (
      <Card className={cn('space-y-3 p-6', className)} aria-busy="true">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-72 max-w-full" />
        <Skeleton className="h-8 w-full" />
      </Card>
    );
  }
  if (!f || !f.project.finish) {
    const done = project.taskCounts.total > 0 && project.taskCounts.done === project.taskCounts.total;
    return (
      <Card className={cn('p-6', className)} data-delivery-forecast="empty">
        <p className="text-[13px] font-medium text-muted">Delivery forecast</p>
        <p className="mt-1 text-[20px] font-semibold text-ink">{done ? 'Every task is approved.' : 'Nothing open to forecast yet.'}</p>
        <p className="mt-1 text-[13.5px] text-muted">{done ? 'There’s no open work left in this project.' : 'Add tasks with owners and estimates, and the forecast appears here.'}</p>
      </Card>
    );
  }
  const originMs = model.originMs;
  const finish = f.project.finish;
  const dw = deadlineWords(f.project.pDeadline);
  const next = findings[0];
  return (
    <Card className={cn('p-5 sm:p-6', className)} data-delivery-forecast="">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-[16px] font-semibold text-ink">Delivery forecast</h2>
        <Freshness data={data} />
      </div>
      <div className="mt-4 grid gap-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div>
          <p className="text-[13px] text-muted">Likely to finish</p>
          <p className="reading mt-2 text-[34px] text-ink sm:text-[40px]" data-forecast-window="">
            {dateRange(originMs, finish)}
          </p>
          <p className="mt-2.5 text-[13.5px] text-ink-2">
            Most likely around {dayText(originMs, finish.p50)}.{' '}
            {project.deadline ? (
              <span className={cn('font-medium', TONE_TEXT[dw.tone])} data-forecast-chance="">
                {dw.text} ({dayText(originMs, f.deadlineDay!)}).
              </span>
            ) : (
              <span className="text-muted">No deadline is set.</span>
            )}
          </p>
          <PlanNote f={f} originMs={originMs} planIso={data.analysis?.forecastFinish ?? null} />
          <HealthNote project={project} pDeadline={f.project.pDeadline} />
          <WindowStrip f={f} originMs={originMs} />
        </div>
        <div className="space-y-3 md:border-l md:border-line md:pl-5">
          <div data-forecast-blocker="">
            <p className="text-[13px] text-muted">What holds it up</p>
            {blocker ? (
              <p className="mt-0.5 text-[14px] text-ink">
                <Link to={`/projects/${project.id}/tasks/${blocker.taskId}`} className="font-medium text-accent hover:underline">
                  {blocker.key}
                </Link>
                {blocker.owner ? ` (${blocker.owner})` : ' (no owner)'}: {blocker.waiting.map((w) => w.name.split(' ')[0]).join(', ')}{' '}
                {blocker.waiting.length === 1 ? 'waits' : 'wait'} on it, about {Math.max(1, Math.round(blocker.days))} working {Math.round(blocker.days) === 1 ? 'day' : 'days'} in total.
              </p>
            ) : (
              <p className="mt-0.5 text-[14px] text-ink">Nobody’s work is waiting on anyone else’s in the forecast.</p>
            )}
          </div>
          <div data-forecast-next="">
            <p className="text-[13px] text-muted">Next move</p>
            <p className="mt-0.5 text-[14px] text-ink">{next ? next.suggestion : 'Nothing needs a decision right now. Keep the estimates up to date.'}</p>
            {next?.tasks[0] && (
              <Link to={`/projects/${project.id}/tasks/${next.tasks[0].id}`} className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
                Open {next.tasks[0].key}
              </Link>
            )}
          </div>
        </div>
      </div>
      <Assumptions f={f} check={data.rangeCheck} />
    </Card>
  );
}

/** Three supporting numbers under the forecast: work left, blocked work, and who has room. */
export function SupportingMetrics({ data, className }: { data: DeliveryForecastData; className?: string }) {
  const f = data.forecast;
  const model = data.model;
  if (!f || !model) return null;
  const open = data.tasks?.filter((t) => t.status !== 'DONE') ?? [];
  const openIds = new Set(open.map((t) => t.id));
  const blocked = model.blocks.filter((b) => openIds.has(b.id) && b.blockedBy.some((id) => openIds.has(id)));
  const projectP50 = f.project.finish?.p50 ?? f.todayDay;
  // Room: people who can take work, whose own work is likely done well before the project's.
  const room = f.people.filter((p) => p.userId !== null && p.role !== 'VIEWER' && (p.open === 0 || (p.finish && projectP50 - p.finish.p50 >= 5)));
  const items: { label: string; value: string; detail: string; tone?: 'danger' | 'warning'; key: string }[] = [
    {
      key: 'remaining',
      label: 'Remaining work',
      value: `${open.length} open ${open.length === 1 ? 'task' : 'tasks'}`,
      detail: f.effort ? `${effortText(f.effort)} of estimated work${f.unestimatedOpen ? `, ${f.unestimatedOpen} without an estimate` : ''}.` : 'Nothing open.',
    },
    {
      key: 'blocked',
      label: 'Blocked',
      value: `${blocked.length} ${blocked.length === 1 ? 'task' : 'tasks'}`,
      detail: blocked.length ? `Waiting on unfinished work: ${blocked.slice(0, 3).map((b) => b.key).join(', ')}${blocked.length > 3 ? '…' : ''}.` : 'Nothing is waiting on unfinished work.',
      tone: blocked.length ? 'warning' : undefined,
    },
    {
      key: 'capacity',
      label: 'Available capacity',
      value: room.length ? `${room.length} ${room.length === 1 ? 'person has' : 'people have'} room` : 'Nobody has obvious room',
      detail: room.length
        ? `${room.slice(0, 3).map((p) => p.name.split(' ')[0]).join(', ')}: ${room.length === 1 ? 'their' : 'their'} own work is likely done at least a week before the project’s.`
        : 'Everyone’s work runs close to the project’s finish.',
    },
  ];
  return (
    <div className={cn('grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3', className)} data-supporting-metrics="">
      {items.map((it) => (
        <div key={it.key} className="bg-surface px-5 py-4">
          <p className="text-[13px] text-muted">{it.label}</p>
          <p className={cn('mt-0.5 text-[18px] font-semibold text-ink', it.tone === 'warning' && 'text-warning')}>{it.value}</p>
          <p className="mt-1 text-[12.5px] leading-snug text-muted">{it.detail}</p>
        </div>
      ))}
    </div>
  );
}

const SHARES = [
  { value: 1, label: 'As in my work so far' },
  { value: 0.75, label: 'Three quarters of that' },
  { value: 0.5, label: 'Half of that' },
  { value: 0.25, label: 'A quarter of that' },
];

/**
 * One person's forecast in a project, with the three questions kept apart: how much work they
 * have left, when their work is likely approved (dependencies and reviews included), and when the
 * whole project is. They can try an availability assumption; only the dates move.
 */
export function MyForecastCard({ project, className }: { project: ProjectDetail; className?: string }) {
  const me = useAppSelector((s) => s.auth.user?.id ?? null);
  const [share, setShare] = useState(1);
  const data = useDeliveryForecast(project, me && share !== 1 ? { [me]: share } : undefined);
  const f = data.forecast;
  const mine: PersonForecast | null = f ? forecastFor(f, me) : null;
  if (!f || !data.model || !mine) return null;
  const originMs = data.model.originMs;
  const rows: { label: string; value: ReactNode; key: string }[] = [
    {
      key: 'effort',
      label: 'Your remaining effort',
      value: mine.effort ? (
        <>
          {effortText(mine.effort)} on {mine.open} open {mine.open === 1 ? 'task' : 'tasks'}
          <span className="block text-[12px] text-muted">Your estimates, adjusted by how long your finished tasks took against theirs.{mine.unestimated ? ` ${mine.unestimated} without an estimate.` : ''}</span>
        </>
      ) : (
        'Nothing open.'
      ),
    },
    {
      key: 'finish',
      label: 'Your work likely approved',
      value: mine.finish ? (
        <>
          {dateRange(originMs, mine.finish)}
          <span className="block text-[12px] text-muted">
            Includes waiting for other work and for reviews
            {mine.waitingDays >= 0.5 ? `; about ${Math.round(mine.waitingDays)} working ${Math.round(mine.waitingDays) === 1 ? 'day' : 'days'} of that is waiting` : ''}.
          </span>
        </>
      ) : (
        '–'
      ),
    },
    {
      key: 'dependency',
      label: 'Main dependency',
      value: mine.mainDependency ? (
        <>
          <Link to={`/projects/${project.id}/tasks/${mine.mainDependency.taskId}`} className="font-medium text-accent hover:underline">
            {mine.mainDependency.key}
          </Link>
          {mine.mainDependency.owner ? ` (${mine.mainDependency.owner})` : ' (no owner yet)'}
          <span className="block text-[12px] text-muted">Holds your work up in {Math.round(mine.mainDependency.share * 100)}% of the simulations.</span>
        </>
      ) : (
        'None: your work doesn’t wait on anyone else’s.'
      ),
    },
    { key: 'project', label: 'Whole project likely done', value: f.project.finish ? `${dateRange(originMs, f.project.finish)}, including everyone’s work and approvals` : '–' },
  ];
  return (
    <Card className={cn('p-5 sm:p-6', className)} data-my-forecast="">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-[16px] font-semibold text-ink">Your part of {project.name}</h2>
        <Freshness data={data} />
      </div>
      <dl className="mt-3 divide-y divide-line">
        {rows.map((r) => (
          <div key={r.key} className="grid gap-1 py-2.5 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4" data-my-forecast-row={r.key}>
            <dt className="text-[13px] text-muted">{r.label}</dt>
            <dd className="text-[14px] text-ink">{r.value}</dd>
          </div>
        ))}
        <div className="grid gap-1 py-2.5 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
          <dt className="text-[13px] text-muted">
            <label htmlFor={`share-${project.id}`}>Your time for this project</label>
          </dt>
          <dd>
            <select
              id={`share-${project.id}`}
              value={share}
              onChange={(e) => setShare(Number(e.target.value))}
              className="h-9 rounded-md border border-line-strong bg-surface px-2 text-[13.5px] text-ink focus:border-accent focus:outline-none"
              data-my-share=""
            >
              {SHARES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[12px] text-muted">A what-if, not saved: the effort stays the same, only the dates move.</span>
          </dd>
        </div>
      </dl>
      <Assumptions f={f} check={data.rangeCheck} />
    </Card>
  );
}
