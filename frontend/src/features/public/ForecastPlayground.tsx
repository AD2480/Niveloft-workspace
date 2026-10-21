import { RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { dateRange, dayText, deadlineWords } from '@/lib/forecastText';
import { NO_CHANGES, sampleForecastShared, type SampleAssumptions } from './sampleForecast';

const CHOICES: { key: keyof SampleAssumptions; title: string; text: string }[] = [
  { key: 'ananyaTakesOnb10', title: 'Ananya takes ONB-10 from Rohan', text: 'Her own work is nearly done; Rohan has three tasks in a row.' },
  { key: 'priyaHalfTime', title: 'Priya has half her time for this project', text: 'She runs the beta test, the last step before launch.' },
  { key: 'addLocalisation', title: 'Add localisation to the beta', text: 'Three more days of work for Ananya, and the beta waits for it.' },
];

const TONE = { success: 'text-success', warning: 'text-warning', danger: 'text-danger', neutral: 'text-muted' } as const;

/**
 * "Change an assumption. Watch the forecast move." The sample project's delivery forecast, computed
 * in the visitor's browser with the app's own engine, with three what-ifs to try. The window, the
 * chance of the deadline and the blocker all respond; the baseline stays visible for comparison.
 */
export function ForecastPlayground({ className }: { className?: string }) {
  const [a, setA] = useState<SampleAssumptions>(NO_CHANGES);
  const base = useMemo(() => sampleForecastShared(NO_CHANGES), []);
  const now = useMemo(() => sampleForecastShared(a), [a]);
  const f = now.forecast;
  const b = base.forecast;
  const origin = now.model.originMs;
  const finish = f.project.finish!;
  const baseFinish = b.project.finish!;
  const shift = Math.round(finish.p50 - baseFinish.p50);
  const dw = deadlineWords(f.project.pDeadline);
  const changed = Object.values(a).some(Boolean);

  // A shared axis for the two windows: from today to a little past the latest date shown.
  const start = f.todayDay;
  const end = Math.max(finish.p90, baseFinish.p90, f.deadlineDay ?? 0) + 2;
  const x = (d: number) => `${Math.min(100, Math.max(0, ((d - start) / (end - start)) * 100))}%`;

  return (
    <div className={cn('grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]', className)} data-forecast-playground="">
      <fieldset className="space-y-3">
        <legend className="mb-3 text-[15px] font-semibold text-ink">Try a change</legend>
        {CHOICES.map((c) => (
          <label
            key={c.key}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border bg-surface p-4 transition-colors hover:border-line-strong',
              a[c.key] ? 'border-accent bg-brand-soft' : 'border-line',
            )}
          >
            <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={a[c.key]} onChange={(e) => setA({ ...a, [c.key]: e.target.checked })} data-assumption={c.key} />
            <span>
              <span className="block text-[14.5px] font-medium text-ink">{c.title}</span>
              <span className="block text-[13px] text-muted">{c.text}</span>
            </span>
          </label>
        ))}
        <button
          type="button"
          onClick={() => setA(NO_CHANGES)}
          disabled={!changed}
          className="inline-flex h-11 items-center gap-2 rounded-md px-3 text-[13.5px] font-medium text-muted hover:text-ink disabled:opacity-50"
          data-playground-reset=""
        >
          <RotateCcw className="size-4" aria-hidden="true" /> Back to the sample as it is
        </button>
      </fieldset>

      <div className="rounded-lg border border-line bg-surface p-5 sm:p-6" aria-live="polite" data-playground-result="">
        <p className="text-[13px] text-muted">Likely to finish</p>
        <p className="mt-0.5 text-[32px] leading-tight font-semibold tracking-[-0.02em] text-ink" data-playground-window="">
          {dateRange(origin, finish)}
        </p>
        <p className="mt-1 text-[14px] text-ink-2">
          Most likely around {dayText(origin, finish.p50)}. <span className={cn('font-medium', TONE[dw.tone])}>{dw.text}</span> ({dayText(origin, f.deadlineDay!)}).
        </p>
        <p className="mt-1 text-[13.5px] text-muted" data-playground-shift="">
          {!changed ? 'This is the sample as it is. Try a change on the left.' : shift === 0 ? 'About the same as the sample as it is.' : `About ${Math.abs(shift)} ${Math.abs(shift) === 1 ? 'day' : 'days'} ${shift < 0 ? 'earlier' : 'later'} than the sample as it is.`}
        </p>

        {/* Today, the window before and after the change, and the deadline. */}
        <div className="mt-5" aria-hidden="true">
          <div className="relative h-12">
            <div className="absolute inset-x-0 top-6 h-px bg-line-strong" />
            {changed && <div className="absolute top-1 h-3 rounded-full border border-dashed border-line-strong" style={{ left: x(baseFinish.p10), width: `calc(${x(baseFinish.p90)} - ${x(baseFinish.p10)})` }} />}
            <div className="absolute top-4 h-4 rounded-full bg-brand-soft ring-1 ring-accent/50 transition-all duration-300" style={{ left: x(finish.p10), width: `calc(${x(finish.p90)} - ${x(finish.p10)})` }} />
            <div className="absolute top-3 h-6 w-0.5 rounded-full bg-accent transition-all duration-300" style={{ left: x(finish.p50) }} />
            <div className="absolute top-0 h-12 w-px bg-ink" style={{ left: 0 }} />
            {f.deadlineDay !== null && <div className="absolute top-0 h-12 w-px bg-danger" style={{ left: x(f.deadlineDay) }} />}
          </div>
          <div className="relative mt-1 h-4 text-[12px] text-muted">
            <span className="absolute left-0">Today</span>
            {f.deadlineDay !== null && (
              <span className="absolute -translate-x-1/2 text-danger" style={{ left: x(f.deadlineDay) }}>
                Deadline
              </span>
            )}
          </div>
          {changed && <p className="mt-2 text-[12px] text-muted">Dashed: before your change.</p>}
        </div>

        <dl className="mt-5 grid gap-3 border-t border-line pt-4 text-[13.5px] sm:grid-cols-2">
          <div>
            <dt className="text-muted">What holds it up</dt>
            <dd className="mt-0.5 text-ink" data-playground-blocker="">
              {now.blocker ? `${now.blocker.key}${now.blocker.owner ? ` (${now.blocker.owner.split(' ')[0]})` : ''}: ${now.blocker.waiting.map((w) => w.name.split(' ')[0]).join(', ')} ${now.blocker.waiting.length === 1 ? 'waits' : 'wait'} on it.` : 'Nobody’s work waits on anyone else’s.'}
            </dd>
          </div>
          <div>
            <dt className="text-muted">What it assumes</dt>
            <dd className="mt-0.5 text-ink-2">
              Tasks take about {f.paceRatio.toFixed(1)}× their estimates, as the finished ones did; reviews take about {Math.max(1, Math.round(f.reviewLag))}{' '}
              {Math.round(f.reviewLag) > 1 ? 'days' : 'day'}; weekends off{f.unownedKeys.length ? `; the ${f.unownedKeys.length} tasks nobody owns yet start today` : ''}.
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-[12.5px] text-muted">
          Worked out in your browser by the same forecast the app uses: {f.runs} simulations of the sample’s open work, dependencies first. A planning estimate with a range, not a
          promise.
        </p>
      </div>
    </div>
  );
}
