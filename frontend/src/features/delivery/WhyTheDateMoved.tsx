import { Hourglass, Info } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useProjectChangesQuery, useProjectHistoryQuery } from '@/api/endpoints';
import { getErrorMessage } from '@/api/errors';
import type { Dependency, Milestone, ProjectDetail, Task } from '@/api/types';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Spinner';
import { TaskRef } from '@/features/refs/TaskRef';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/dates';
import { chanceText } from '@/lib/forecastText';
import { changeHeadline, daysAgo, explainForecastChange, STEP_LABEL, type ChangeFact, type ChangeStep, type ForecastChange } from '@/lib/forecastChanges';

export const PERIODS = { '7': 'A week ago', '14': 'Two weeks ago', '30': 'A month ago' } as const;
export type Period = keyof typeof PERIODS;

const dateText = (iso: string) => formatDate(iso, 'EEE d MMM');

/**
 * The replayed explanation for one period. The change log is fetched once per period and day; the
 * replay (a handful of forecasts) runs after the page has drawn, so it never holds up the outlook.
 */
export function useForecastChange(
  project: ProjectDetail,
  data: { tasks?: readonly Task[]; dependencies?: readonly Dependency[]; milestones?: readonly Milestone[] },
  days: number,
): { change: ForecastChange | null; loading: boolean; error: string | null } {
  const since = useMemo(() => daysAgo(days).toISOString(), [days]);
  const log = useProjectChangesQuery({ projectId: project.id, since });
  const history = useProjectHistoryQuery(project.id);
  const [change, setChange] = useState<ForecastChange | null>(null);
  const ready = !!(log.currentData && history.currentData && data.tasks && data.dependencies && data.milestones);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      const c = explainForecastChange({
        now: new Date(),
        since: new Date(since),
        project: { startDate: project.startDate, deadline: project.deadline },
        tasks: data.tasks!,
        dependencies: data.dependencies!,
        milestones: data.milestones!,
        history: history.currentData!,
        members: project.members,
        log: log.currentData!,
      });
      if (!cancelled) setChange(c);
    }, 30);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [ready, since, log.currentData, history.currentData, data.tasks, data.dependencies, data.milestones, project.startDate, project.deadline, project.members]);

  const error = log.error ?? history.error;
  return { change: ready ? change : null, loading: !error && (!ready || change === null), error: error ? getErrorMessage(error) : null };
}

/** A fact's sentence with its task keys as links. */
export function FactText({ fact }: { fact: Pick<ChangeFact, 'text' | 'keys'> }) {
  if (!fact.keys.length) return <>{fact.text}</>;
  const keys = [...new Set(fact.keys)].sort((a, b) => b.length - a.length);
  const re = new RegExp(`\\b(${keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g');
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of fact.text.matchAll(re)) {
    if (m.index! > last) parts.push(fact.text.slice(last, m.index));
    parts.push(<TaskRef key={`${m.index}-${m[0]}`} taskKey={m[0]} />);
    last = m.index! + m[0].length;
  }
  parts.push(fact.text.slice(last));
  return <>{parts}</>;
}

function stepValue(s: ChangeStep): string {
  if (s.days === null) return 'can’t be measured';
  if (s.days === 0) return s.facts.length ? 'no change to the date' : 'nothing recorded';
  return `${Math.abs(s.days)} working ${Math.abs(s.days) === 1 ? 'day' : 'days'} ${s.days > 0 ? 'later' : 'earlier'}`;
}

/**
 * "Why the date moved": the likely finish now against the forecast as it stood a week (or two, or
 * a month) ago, with the move split into scope, blocked work, owners and progress, each measured by
 * replaying the records, and the review waits behind it.
 */
export function WhyTheDateMoved({ project, data }: { project: ProjectDetail; data: { tasks?: readonly Task[]; dependencies?: readonly Dependency[]; milestones?: readonly Milestone[] } }) {
  const [period, setPeriod] = useState<Period>('7');
  const { change, loading, error } = useForecastChange(project, data, Number(period));
  const max = change ? Math.max(1, ...change.steps.map((s) => Math.abs(s.days ?? 0))) : 1;

  return (
    <section className="rounded-xl border border-line bg-surface" aria-labelledby="date-moved-title" data-date-moved="">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 id="date-moved-title" className="text-[16px] font-semibold text-ink">
            Why the date moved
          </h2>
          <p className="mt-0.5 max-w-2xl text-[12.5px] text-muted">The forecast replayed as the records stood then, with each kind of recorded change brought forward in turn.</p>
        </div>
        <Segmented label="Compare with" value={period} onChange={setPeriod} options={(Object.keys(PERIODS) as Period[]).map((p) => ({ value: p, label: PERIODS[p] }))} />
      </header>
      <div className="px-5 py-4" aria-live="polite" aria-busy={loading}>
        {error ? (
          <p className="text-[13px] text-danger">The changes couldn’t be loaded ({error}), so the move can’t be explained right now.</p>
        ) : loading || !change ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-[14px] leading-relaxed text-ink" data-date-moved-headline="">
              {changeHeadline(change, dateText)}
            </p>
            {change.then && change.now && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12.5px] sm:max-w-md">
                <dt className="text-muted">Likely finish then</dt>
                <dd className="text-ink tabular-nums">
                  {dateText(change.then.likely)}
                  {change.then.pDeadline !== null && <span className="text-muted">, {chanceText(change.then.pDeadline)} on time</span>}
                </dd>
                <dt className="text-muted">Likely finish now</dt>
                <dd className="text-ink tabular-nums">
                  {dateText(change.now.likely)}
                  {change.now.pDeadline !== null && <span className="text-muted">, {chanceText(change.now.pDeadline)} on time</span>}
                </dd>
              </dl>
            )}
            <ol className="divide-y divide-line rounded-lg border border-line" data-date-moved-steps="">
              {change.steps.map((s) => (
                <li key={s.kind} className="grid gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[180px_minmax(0,1fr)]" data-date-moved-step={s.kind} data-days={s.days ?? ''}>
                  <div>
                    <p className="text-[13px] font-medium text-ink">{STEP_LABEL[s.kind]}</p>
                    <p className={cn('text-[12.5px] tabular-nums', s.days && s.days > 0 ? 'text-warning' : s.days && s.days < 0 ? 'text-success' : 'text-muted')}>{stepValue(s)}</p>
                    {s.days !== null && s.days !== 0 && (
                      <span className="mt-1.5 block h-1.5 rounded-full bg-surface-3" aria-hidden="true">
                        <span className={cn('block h-1.5 rounded-full', s.days > 0 ? 'bg-warning' : 'bg-success')} style={{ width: `${Math.max(6, (Math.abs(s.days) / max) * 100)}%` }} />
                      </span>
                    )}
                  </div>
                  {s.facts.length ? (
                    <ul className="space-y-1.5 text-[13px] leading-normal text-ink-2">
                      {s.facts.map((f, i) => (
                        <li key={i} className={cn('flex gap-1.5', f.review && 'text-ink')} data-review-wait={f.review ? '' : undefined}>
                          {f.review ? <Hourglass className="mt-0.5 size-3.5 shrink-0 text-warning" aria-label="Waiting for review" /> : <span className="mt-[7px] size-1 shrink-0 rounded-full bg-line-strong" aria-hidden="true" />}
                          <span>
                            <FactText fact={f} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[13px] text-muted">Nothing of this kind was recorded since then.</p>
                  )}
                </li>
              ))}
            </ol>
            <div className="space-y-1 text-[12px] leading-relaxed text-muted">
              {change.notes.map((n) => (
                <p key={n} className="flex gap-1.5">
                  <Info className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                  {n}
                </p>
              ))}
              <p>
                Each step is measured by forecasting the project with that kind of change and everything before it. The order matters a little, so the split is a fair account rather than the only one, and moves of a
                day are within the forecast’s spread. Changes nobody recorded, such as time off, aren’t in it.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
