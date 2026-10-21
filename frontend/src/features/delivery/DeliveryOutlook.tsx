import { AlertTriangle, Check, ExternalLink, GitCompareArrows, Info, Table2, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useUpdateTaskMutation } from '@/api/endpoints';
import { getErrorMessage } from '@/api/errors';
import type { Dependency, Milestone, ProjectDetail, Task, TaskRequest } from '@/api/types';
import { useAppSelector } from '@/app/store';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { buttonClass } from '@/components/ui/buttonStyles';
import { Dialog } from '@/components/ui/Dialog';
import { Skeleton } from '@/components/ui/Spinner';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { clearFlurryCue, currentFlurryCue, flurryMoment, showFlurryCue } from '@/features/flurry/flurryCues';
import { FlurryFigure } from '@/features/flurry/FlurryFigure';
import { useDeliveryForecast } from '@/features/forecast/useDeliveryForecast';
import { cn } from '@/lib/cn';
import { STATUS_LABEL } from '@/lib/constants';
import { parseLocalDate, todayIso } from '@/lib/dates';
import { chanceText, dayText } from '@/lib/forecastText';
import { useMediaQuery, useUrlState } from '@/lib/hooks';
import { can } from '@/lib/permissions';
import { dataQuality, forecastProgress, type ProgressForecast, type Range } from '@/lib/progressForecast';
import { dayToIso } from '@/three/projectModel';
import { milestoneAtRisk, milestoneBlocker, placeLabels, routeY, timeScale, type MilestoneBlocker, type PlacedLabel } from './deliveryPath';
import { WhyTheDateMoved } from './WhyTheDateMoved';
import { ForecastTrialSection } from './ForecastTrial';
import { BlockerEvidence, costWords, impactSentence, RecoveryPanel, useBlockerImpact, useJourneyStep, useSubmitter } from './BlockerJourney';
import type { BlockerImpact } from './recovery';

const DAY_MS = 86_400_000;
const STATUS_TONE = { TODO: 'neutral', IN_PROGRESS: 'info', IN_REVIEW: 'warning', DONE: 'success' } as const;
const SHARES = [1, 0.8, 0.5] as const;
const CUTS = [1, 0.75, 0.5] as const;

type View = 'path' | 'chart';

interface Scenario {
  /** New estimates (working days), by task id. */
  estimates: Record<number, number>;
  /** Share of a person's time from now on, by user id. */
  shares: Record<number, number>;
}
const NO_SCENARIO: Scenario = { estimates: {}, shares: {} };

/** Width of an element, kept up to date. */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/**
 * The delivery outlook: when the project is likely to be delivered against its target, shown two
 * ways from the same forecast snapshot (a Path along a quiet route, and a Chart with exact axes and a
 * table), with what holds each milestone up in an inspector beside it, and a scenario you can
 * preview against the baseline without changing anything. Selecting a milestone asks Flurry to go
 * beside it, point at its blocker and say what it is, in one sentence, from the same records.
 *
 * Honest by construction: the terrain is decoration and the route's height means nothing; only
 * left-to-right is time, on one scale shared by both views. The range is the forecast's own 10–90%
 * spread; the 85% date is a probability threshold, not a milestone.
 */
export function DeliveryOutlook({ project }: { project: ProjectDetail }) {
  const data = useDeliveryForecast(project);
  const userId = useAppSelector((s) => s.auth.user?.id ?? 0);
  const phone = !useMediaQuery('(min-width: 768px)');
  const [ui, setUi] = useUrlState({ view: '', milestone: '', from: '', ways: '' });
  const view: View = ui.view === 'path' || ui.view === 'chart' ? ui.view : phone ? 'chart' : 'path';
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [scenario, setScenario] = useState<Scenario>(NO_SCENARIO);
  /** Scenarios kept to compare side by side (up to three), in this visit only. */
  const [kept, setKept] = useState<{ name: string; scenario: Scenario }[]>([]);
  const [applying, setApplying] = useState(false);
  const [asTable, setAsTable] = useState(false);
  const [waysOpen, setWaysOpen] = useState(false);
  const journey = useJourneyStep(project.id);
  const askedFlurry = useRef(false);
  const flurryTimer = useRef(0);

  const f = data.forecast;
  const model = data.model;
  const tasks = data.tasks;
  const deps = data.dependencies;
  const milestones = useMemo(() => [...(data.milestones ?? [])].sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [data.milestones]);
  const originMs = model?.originMs ?? 0;
  const today = todayIso();
  const dayOf = (iso: string) => (parseLocalDate(iso).getTime() - originMs) / DAY_MS;
  const d = (day: number) => dayText(originMs, day);

  const changed = Object.keys(scenario.estimates).length + Object.keys(scenario.shares).length > 0;
  const sf = useMemo(
    () => (changed && model && tasks?.length ? forecastProgress({ model, tasks, members: project.members, estimates: scenario.estimates, shares: scenario.shares }) : null),
    [changed, model, tasks, project.members, scenario],
  );

  /** A kept option's forecast: the same records and draws, with its scope and time changes. */
  const forecastOf = useCallback(
    (sc: Scenario) => (model && tasks?.length ? forecastProgress({ model, tasks, members: project.members, estimates: sc.estimates, shares: sc.shares }) : null),
    [model, tasks, project.members],
  );

  // Where each milestone sits: when it was completed, or when its open work is likely all approved.
  const milestoneDay = (m: Milestone, fc: ProgressForecast | null = f): number => {
    if (m.completed) return m.completedAt ? (new Date(m.completedAt).getTime() - originMs) / DAY_MS : dayOf(m.dueDate);
    return fc?.milestones[m.id]?.p50 ?? dayOf(m.dueDate);
  };

  const selected = useMemo(() => {
    const byUrl = milestones.find((m) => String(m.id) === ui.milestone);
    if (byUrl) return byUrl;
    return f ? milestoneAtRisk(milestones, (id) => f.milestones[id]?.p50 ?? null, dayOf) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [milestones, ui.milestone, f]);

  const blocker = useMemo(
    () =>
      selected && tasks && deps && f
        ? milestoneBlocker(selected, tasks, deps, { today, likely: (id) => (f.tasks[id] ? d(f.tasks[id].p50) : null), likelyDay: (id) => f.tasks[id]?.p50 ?? null })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, tasks, deps, f, today],
  );

  const taskLink = (t: Task) => (t.status === 'IN_REVIEW' && can.review(project.myRole) ? `/projects/${project.id}/tasks/${t.id}/review` : `/projects/${project.id}/tasks/${t.id}`);

  // The blocker journey: its cost to the deadline, when it went to review, and who submitted it.
  const impact = useBlockerImpact(model, tasks, project, f, blocker);
  const reviewSinceDay = (id: number) => {
    const b = model?.blocks.find((x) => x.id === id);
    const seg = b ? [...b.segments].reverse().find((sg) => sg.status === 'IN_REVIEW') : undefined;
    return seg ? seg.from : null;
  };
  const blockerReviewDay = blocker && blocker.task.status === 'IN_REVIEW' ? reviewSinceDay(blocker.task.id) : null;
  const reviewSince = blockerReviewDay !== null && model ? dayToIso(model.originMs, blockerReviewDay) : null;
  const submitterId = useSubmitter(blocker && blocker.task.status === 'IN_REVIEW' ? blocker.task.id : null);
  useEffect(() => {
    if (blocker && blocker.kind !== 'last') journey('shown', blocker.kind, null, `${blocker.task.id}:${blocker.kind}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker?.task.id, blocker?.kind]);
  useEffect(() => setWaysOpen(false), [blocker?.task.id]);
  // Arriving from Flurry's blocker review (?ways=1): open the ways forward for the blocker at risk.
  useEffect(() => {
    if (ui.ways === '1' && blocker && blocker.kind !== 'last') {
      setWaysOpen(true);
      setUi({ ways: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.ways, blocker?.task.id]);
  const openWays = () => {
    setWaysOpen(true);
    window.setTimeout(() => document.querySelector('[data-ways-forward]')?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }), 60);
  };

  // Flurry: only when you ask (selecting a milestone, or arriving from Flurry's menu), it goes beside
  // the milestone, points at its blocker and says what it is.
  const ask = (m: Milestone | null) => {
    if (!m || !tasks || !deps || !f) return;
    const b = milestoneBlocker(m, tasks, deps, { today, likely: (id) => (f.tasks[id] ? d(f.tasks[id].p50) : null), likelyDay: (id) => f.tasks[id]?.p50 ?? null });
    // Beside the milestone's label on the path (so it doesn't cover it), or its button elsewhere.
    const anchor = () => document.querySelector(`[data-delivery-milestone-label="${m.id}"]`) ?? document.querySelector(`[data-delivery-milestone="${m.id}"]`);
    // On the chart the milestones are a row of buttons: Flurry stands under the selected one, so its note doesn't cover the others.
    const stand = document.querySelector('[data-delivery-chart]') ? ('below' as const) : ('beside' as const);
    if (!b) {
      showFlurryCue({ id: `delivery:${project.id}`, by: 'person', title: m.name, text: `Everything in ${m.name} is approved.`, anchor, stand, target: anchor, actions: [{ label: 'OK' }] });
      return;
    }
    const cost = b.task.id === blocker?.task.id ? costWords(impact) : '';
    showFlurryCue({
      id: `delivery:${project.id}`,
      by: 'person',
      tone: b.kind === 'review' || b.kind === 'late' ? 'attention' : 'neutral',
      title: b.title,
      text: cost && b.kind !== 'last' ? b.sentence.replace(/ Open it\?$/, ` It’s ${cost} on the likely finish. See the ways forward?`) : b.sentence,
      anchor,
      stand,
      // The blocker on the path; on the chart, its card in the inspector.
      target: () => document.querySelector('[data-delivery-blocker]') ?? document.querySelector('[data-delivery-blocker-card]'),
      actions:
        b.kind !== 'last'
          ? [
              { label: 'Ways forward', onSelect: openWays, primary: true },
              { label: b.task.status === 'IN_REVIEW' && can.review(project.myRole) ? 'Open the review' : 'Open it', to: taskLink(b.task) },
            ]
          : [{ label: b.task.status === 'IN_REVIEW' && can.review(project.myRole) ? 'Open the review' : 'Open it', to: taskLink(b.task), primary: true }],
    });
  };
  useEffect(() => () => clearFlurryCue(`delivery:${project.id}`), [project.id]);
  // Arriving from Flurry's "Delivery outlook": that was asking. With a milestone held up, Flurry
  // points at its blocker; otherwise it says how delivery looks, in one sentence.
  useEffect(() => {
    if (ui.from !== 'flurry' || askedFlurry.current || !f || !tasks || !deps) return;
    askedFlurry.current = true;
    setUi({ from: '' });
    // Once, a moment after the page is drawn (so Flurry has the milestone to stand beside); only
    // leaving the page cancels it.
    flurryTimer.current = window.setTimeout(() => {
      if (selected && blocker) return ask(selected);
      const r = f.project.finish;
      showFlurryCue({
        id: `delivery:${project.id}`,
        by: 'person',
        title: project.name,
        text: r
          ? `Nothing holds a milestone up right now. Likely finish ${d(r.p50)}${r.p85 !== undefined ? `, 85% likely by ${d(r.p85)}` : ''}${f.project.pDeadline !== null ? `; ${chanceText(f.project.pDeadline)} chance of making the target` : ''}.`
          : 'Everything in this project is approved.',
        actions: [{ label: 'OK' }],
      });
    }, 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.from, f, tasks, deps, selected, blocker]);
  useEffect(() => () => window.clearTimeout(flurryTimer.current), []);
  // Switching between the path and the chart while Flurry is pointing something out: it follows to
  // the same milestone in the other view (its note was asked for; it isn't new).
  const shownView = useRef(view);
  useEffect(() => {
    if (shownView.current === view) return;
    shownView.current = view;
    if (!selected || currentFlurryCue()?.id !== `delivery:${project.id}`) return;
    const t = window.setTimeout(() => ask(selected), 80);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const select = (m: Milestone) => {
    setUi({ milestone: String(m.id) });
    ask(m);
  };

  // ------------------------------------------------------------------ states

  const loading = !model || !tasks || !deps || !data.milestones;
  if (data.error) return <ErrorState error={data.error} onRetry={data.refetch} className="min-h-[50vh]" />;
  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-[380px] w-full rounded-xl" />
      </div>
    );
  }
  if (!tasks.length || !f) {
    return <EmptyState icon={Info} title="Nothing to forecast yet" description="Add tasks with estimates and the delivery outlook will appear here." />;
  }

  const finish = f.project.finish;
  const sFinish = sf?.project.finish ?? null;
  const allDone = !finish;
  // The view starts a little before the last completed milestone (or two weeks back), so the
  // future, where the decisions are, gets most of the width.
  const lastDone = Math.max(-Infinity, ...milestones.filter((m) => m.completed).map((m) => milestoneDay(m)));
  const from = Math.max(f.startDay, Math.min(f.todayDay - 14, Number.isFinite(lastDone) ? lastDone - 4 : f.todayDay - 14));
  const to = Math.max(f.todayDay + 3, (finish?.p90 ?? f.todayDay) + 3, (f.deadlineDay ?? 0) + 3, (sFinish?.p90 ?? 0) + 3, ...milestones.map((m) => Math.max(milestoneDay(m), dayOf(m.dueDate)) + 2));
  const quality = dataQuality(f.learnedFrom);

  return (
    <div className="space-y-5" data-delivery-outlook="" data-delivery-view={view}>
      <Readouts f={f} sf={sf} d={d} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-muted" aria-label="Legend">
          <span className="flex items-center gap-2">
            <span className="h-0.5 w-6 rounded bg-accent" aria-hidden="true" /> Actual
          </span>
          <span className="flex items-center gap-2">
            <span className="w-6 border-t-2 border-dashed border-accent" aria-hidden="true" /> Forecast
          </span>
          <span className="flex items-center gap-2">
            <span className="h-2.5 w-6 rounded-full bg-[var(--frost)]/60" aria-hidden="true" /> Likely finish (10–90%)
          </span>
          {sf && (
            <span className="flex items-center gap-2">
              <span className="w-6 border-t-2 border-dashed border-[var(--model-review)]" aria-hidden="true" /> Scenario
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-line bg-surface-2 p-0.5" role="group" aria-label="View">
            {(['path', 'chart'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setUi({ view: v })}
                className={cn('h-8 rounded-[5px] px-3 text-[13px] font-medium transition-colors', view === v ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink')}
                data-delivery-view-button={v}
              >
                {v === 'path' ? 'Path' : 'Chart'}
              </button>
            ))}
          </div>
          <Button variant={scenarioOpen ? 'secondary' : 'outline'} size="sm" leftIcon={<GitCompareArrows />} onClick={() => setScenarioOpen((o) => !o)} aria-expanded={scenarioOpen} data-delivery-compare="">
            Compare scenario
          </Button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          {view === 'path' ? (
            <PathView f={f} sf={sf} milestones={milestones} from={from} to={to} d={d} milestoneDay={milestoneDay} dayOf={dayOf} selected={selected} blocker={blocker} onSelect={select} />
          ) : asTable ? (
            <MilestoneTable f={f} sf={sf} milestones={milestones} d={d} milestoneDay={milestoneDay} dayOf={dayOf} selected={selected} onSelect={select} tasks={tasks} deps={deps} today={today} />
          ) : (
            <ChartView f={f} sf={sf} milestones={milestones} from={from} to={to} d={d} milestoneDay={milestoneDay} dayOf={dayOf} selected={selected} onSelect={select} />
          )}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="max-w-2xl text-[12px] leading-relaxed text-muted" data-delivery-snapshot="">
              One forecast snapshot for both views: {f.runs} simulated runs of the open work from the records ({quality.label.replace(/\.$/, '')}). A planning estimate, not a commitment. The terrain is
              decoration; only left to right means anything (time).
            </p>
            {view === 'chart' && (
              <Button variant="ghost" size="sm" leftIcon={<Table2 />} onClick={() => setAsTable((t) => !t)} aria-pressed={asTable} data-delivery-table-toggle="">
                {asTable ? 'Show the chart' : 'Show as a table'}
              </Button>
            )}
          </div>
          {waysOpen && blocker && blocker.kind !== 'last' && tasks && (
            <RecoveryPanel
              project={project}
              model={model}
              tasks={tasks}
              f={f}
              blocker={blocker}
              impact={impact}
              submitterId={submitterId}
              reviewSince={reviewSince}
              onClose={() => setWaysOpen(false)}
            />
          )}
          {scenarioOpen && (
            <ScenarioPanel
              project={project}
              userId={userId}
              f={f}
              sf={sf}
              d={d}
              tasks={tasks}
              milestone={selected}
              blocker={blocker}
              scenario={scenario}
              setScenario={setScenario}
              kept={kept}
              setKept={setKept}
              forecastOf={forecastOf}
              onClose={() => {
                setScenario(NO_SCENARIO);
                setScenarioOpen(false);
              }}
              onApply={() => setApplying(true)}
            />
          )}
        </div>
        <Inspector
          project={project}
          f={f}
          d={d}
          dayOf={dayOf}
          deps={deps ?? []}
          impactText={blocker && impact && model ? impactSentence(model, f, impact, blocker) : null}
          impact={impact}
          reviewSince={reviewSince}
          onEvidence={() => blocker && journey('evidence', blocker.kind, null, `${blocker.task.id}`)}
          onWays={openWays}
          waysOpen={waysOpen}
          reviewDay={(id) => {
            const b = model.blocks.find((x) => x.id === id);
            const seg = b ? [...b.segments].reverse().find((sg) => sg.status === 'IN_REVIEW') : undefined;
            return seg ? seg.from : null;
          }}
          milestone={selected}
          blocker={blocker}
          allDone={allDone}
          taskLink={taskLink}
          onScenario={() => setScenarioOpen(true)}
          milestoneDay={milestoneDay}
        />
      </div>

      <WhyTheDateMoved project={project} data={data} />

      <ForecastTrialSection project={project} />

      {applying && (
        <ApplyDialog
          project={project}
          tasks={tasks}
          scenario={scenario}
          userId={userId}
          onClose={(saved) => {
            setApplying(false);
            if (saved) {
              setScenario(NO_SCENARIO);
              setScenarioOpen(false);
            }
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the readouts

function Readouts({ f, sf, d }: { f: ProgressForecast; sf: ProgressForecast | null; d: (day: number) => string }) {
  const r = f.project.finish;
  const s = sf?.project.finish ?? null;
  const delta = (a: number | undefined, b: number | undefined) => {
    if (a === undefined || b === undefined) return null;
    const n = Math.round(b - a);
    return n === 0 ? 'no change' : `${n > 0 ? '+' : '−'}${Math.abs(n)} ${Math.abs(n) === 1 ? 'day' : 'days'}`;
  };
  const items: { label: string; value: string; note?: string; scenario?: string | null; tone?: string; data: string }[] = [
    { label: 'Target', value: f.deadlineDay !== null ? d(f.deadlineDay) : 'No target', note: f.deadlineDay !== null ? 'the project’s deadline' : 'set a deadline in Settings', data: 'target' },
    { label: 'Median finish', value: r ? d(r.p50) : 'Done', note: r ? 'half the runs finish by then' : 'everything is approved', scenario: s ? `${d(s.p50)} (${delta(r?.p50, s.p50)})` : null, data: 'median' },
    { label: '85% finish by', value: r?.p85 !== undefined ? d(r.p85) : '–', note: 'a probability threshold, not a milestone', scenario: s?.p85 !== undefined ? `${d(s.p85)} (${delta(r?.p85, s.p85)})` : null, data: 'p85' },
    {
      label: 'On-time estimate',
      value: f.project.pDeadline !== null ? chanceText(f.project.pDeadline) : '–',
      note: f.project.pDeadline !== null ? 'runs that finish by the target' : 'needs a target',
      scenario: sf && sf.project.pDeadline !== null ? chanceText(sf.project.pDeadline) : null,
      tone: f.project.pDeadline !== null && f.project.pDeadline < 0.5 ? 'text-warning' : 'text-ink',
      data: 'on-time',
    },
  ];
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-surface lg:grid-cols-4" data-delivery-readouts="">
      {items.map((x, i) => (
        <div key={x.label} className={cn('px-4 py-3.5', i % 2 === 1 && 'border-l border-line', i >= 2 && 'border-t border-line lg:border-t-0', i === 2 && 'lg:border-l')} data-delivery-readout={x.data}>
          <dt className="text-[13px] font-medium text-muted">{x.label}</dt>
          <dd className={cn('reading mt-2 text-[24px]', x.tone ?? 'text-ink')}>{x.value}</dd>
          {x.scenario && (
            <dd className="mt-0.5 text-[12.5px] font-medium text-[var(--model-review)] tabular-nums" data-delivery-scenario-value="">
              Scenario: {x.scenario}
            </dd>
          )}
          {x.note && <dd className="mt-0.5 text-[12px] text-muted">{x.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

// ------------------------------------------------------------------ the path

interface ViewProps {
  f: ProgressForecast;
  sf: ProgressForecast | null;
  milestones: Milestone[];
  from: number;
  to: number;
  d: (day: number) => string;
  milestoneDay: (m: Milestone, fc?: ProgressForecast | null) => number;
  /** A local date's model day (midnight). */
  dayOf: (iso: string) => number;
  selected: Milestone | null;
  onSelect: (m: Milestone) => void;
}

/** Decorative low-relief contours: the same every time for the same size, meaning nothing. */
function Contours({ w, h }: { w: number; h: number }) {
  const lines = useMemo(() => {
    const out: string[] = [];
    for (let k = 0; k < 11; k++) {
      const base = (h / 11) * (k + 0.5);
      let dd = '';
      for (let x = -10; x <= w + 10; x += 14) {
        const t = x / Math.max(1, w);
        const y = base + Math.sin(t * 5.1 + k * 0.9) * 10 + Math.sin(t * 13.3 + k * 2.1) * 4 + Math.cos(t * 2.2 + k) * 8;
        dd += `${x < 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      out.push(dd);
    }
    return out;
  }, [w, h]);
  return (
    <g aria-hidden="true">
      {lines.map((dd, i) => (
        <path key={i} d={dd} fill="none" stroke="var(--line)" strokeWidth={i % 3 === 0 ? 1.1 : 0.7} opacity={i % 3 === 0 ? 0.9 : 0.6} />
      ))}
    </g>
  );
}

function routePath(x0: number, x1: number, w: number, h: number): string {
  if (x1 <= x0) return '';
  let dd = '';
  const step = 6;
  for (let x = x0; x < x1; x += step) dd += `${dd ? 'L' : 'M'}${x.toFixed(1)} ${routeY(x, w, h).toFixed(1)}`;
  return `${dd}L${x1.toFixed(1)} ${routeY(x1, w, h).toFixed(1)}`;
}

type Mark = { key: string; x: number; label: ReactNode; sub?: string; kind: 'milestone' | 'today' | 'target' | 'median' | 'p85' | 'blocker' | 'scenario'; m?: Milestone; done?: boolean };

function PathView({ f, sf, milestones, from, to, d, milestoneDay, dayOf, selected, onSelect, blocker }: ViewProps & { blocker: MilestoneBlocker | null }) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const w = Math.max(720, measured);
  const h = 430;
  const s = timeScale(from, to, w, 70);
  const finish = f.project.finish;
  const sFinish = sf?.project.finish ?? null;
  const at = (day: number) => ({ x: s.x(day), y: routeY(s.x(day), w, h) });
  const todayX = s.x(f.todayDay);
  const endX = s.x(finish?.p90 ?? f.todayDay);
  const blockerDay = blocker ? (f.tasks[blocker.task.id]?.p50 ?? f.todayDay) : null;

  const marks: Mark[] = [
    ...milestones.filter((m) => milestoneDay(m) >= from - 0.5).map<Mark>((m) => ({
      key: `m${m.id}`,
      x: s.x(milestoneDay(m)),
      label: m.name,
      sub: m.completed ? `approved ${d(milestoneDay(m))}` : f.milestones[m.id] ? `likely ${d(milestoneDay(m))}, due ${d(dayOf(m.dueDate))}` : `due ${d(dayOf(m.dueDate))}`,
      kind: 'milestone',
      m,
      done: m.completed,
    })),
    { key: 'today', x: todayX, label: 'Today', sub: d(f.todayDay), kind: 'today' as const },
    ...(f.deadlineDay !== null ? [{ key: 'target', x: s.x(f.deadlineDay), label: 'Target', sub: d(f.deadlineDay), kind: 'target' as const }] : []),
    ...(finish ? [{ key: 'median', x: s.x(finish.p50), label: 'Median finish', sub: d(finish.p50), kind: 'median' as const }] : []),
    ...(finish?.p85 !== undefined ? [{ key: 'p85', x: s.x(finish.p85), label: '85% finish by', sub: d(finish.p85), kind: 'p85' as const }] : []),
    ...(sFinish ? [{ key: 'scenario', x: s.x(sFinish.p50), label: 'Scenario median', sub: d(sFinish.p50), kind: 'scenario' as const }] : []),
    ...(blocker && blockerDay !== null ? [{ key: 'blocker', x: s.x(Math.max(f.todayDay, blockerDay)), label: blocker.task.key, sub: blocker.kind === 'review' ? 'review pending' : blocker.lateDays > 0 ? `${blocker.lateDays} ${blocker.lateDays === 1 ? 'day' : 'days'} late` : STATUS_LABEL[blocker.task.status].toLowerCase(), kind: 'blocker' as const }] : []),
  ].sort((a, b) => a.x - b.x);
  // Labels: the closest free row above or below the route, most important first.
  const PRIORITY: Record<Mark['kind'], number> = { today: 0, blocker: 1, milestone: 2, target: 3, median: 4, p85: 5, scenario: 6 };
  const textW = (mk: Mark) => Math.max(String(mk.label).length * 7.1, (mk.sub?.length ?? 0) * 6.4) + 20;
  const placed = placeLabels(
    marks.map((mk) => ({ x: mk.x, width: Math.min(178, textW(mk)), priority: PRIORITY[mk.kind] - (mk.m && selected?.id === mk.m.id ? 1.5 : 0) })),
    w,
  );
  const LABEL_H = 36;
  const ROW = 46;
  // Each label clears the route (and every mark on it) across its whole width, not only at its own
  // mark: where the route climbs steeply, a label set by its mark alone would sit on its neighbour.
  const labelTop = marks.map((mk, i) => {
    const p = placed[i];
    const width = Math.min(178, textW(mk));
    let lo = Infinity;
    let hi = -Infinity;
    for (let x = p.left - 6; x <= p.left + width + 6; x += 4) {
      const yy = routeY(Math.min(w, Math.max(0, x)), w, h);
      lo = Math.min(lo, yy);
      hi = Math.max(hi, yy);
    }
    return p.side === 'above' ? lo - 14 - p.level * ROW - LABEL_H : hi + 14 + p.level * ROW;
  });

  return (
    <div ref={ref} className="scrollbar-thin overflow-x-auto rounded-xl border border-line bg-surface" data-delivery-path="">
      <div className="relative" style={{ width: w, height: h }}>
        <svg className="absolute inset-0" width={w} height={h} aria-hidden="true">
          <Contours w={w} h={h} />
          {/* The likely finish range, along the route (10–90% of the runs). */}
          {finish && <path d={routePath(s.x(finish.p10), s.x(finish.p90), w, h)} fill="none" stroke="var(--frost)" strokeOpacity={sf ? 0.35 : 0.55} strokeWidth={20} strokeLinecap="round" />}
          {sFinish && <path d={routePath(s.x(sFinish.p10), s.x(sFinish.p90), w, h)} fill="none" stroke="var(--model-review)" strokeOpacity={0.22} strokeWidth={12} strokeLinecap="round" />}
          {/* Done so far (solid) and the forecast (dashed). */}
          <path d={routePath(s.x(from), todayX, w, h)} fill="none" stroke="var(--accent)" strokeWidth={3} strokeLinecap="round" />
          <path d={routePath(todayX, endX, w, h)} fill="none" stroke={sf ? 'var(--line-strong)' : 'var(--accent)'} strokeWidth={2.5} strokeDasharray="7 6" strokeLinecap="round" />
          {sFinish && <path d={routePath(todayX, s.x(sFinish.p90), w, h)} fill="none" stroke="var(--model-review)" strokeWidth={2.5} strokeDasharray="7 6" strokeLinecap="round" transform="translate(0 6)" />}
          {/* The target: a line across the whole view, not a point in time on the route only. */}
          {f.deadlineDay !== null && <line x1={s.x(f.deadlineDay)} x2={s.x(f.deadlineDay)} y1={18} y2={h - 30} stroke="var(--warning)" strokeWidth={1.5} strokeDasharray="4 5" />}
          {/* From the blocker to the selected milestone: what it holds up. */}
          {blocker && blockerDay !== null && selected && (() => {
            const a = at(Math.max(f.todayDay, blockerDay));
            const b = at(milestoneDay(selected));
            return <path d={`M${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${Math.min(a.y, b.y) - 50} ${b.x} ${b.y}`} fill="none" stroke="var(--warning)" strokeWidth={1.4} strokeDasharray="2 4" />;
          })()}
          {/* Leader lines to labels set further out. */}
          {marks.map((mk, i) => {
            const p = placed[i];
            const y = routeY(mk.x, w, h);
            const edge = p.side === 'above' ? labelTop[i] + LABEL_H : labelTop[i];
            if (Math.abs(edge - y) < 18) return null;
            return <line key={mk.key} x1={mk.x} x2={mk.x} y1={p.side === 'above' ? y - 12 : y + 12} y2={edge} stroke="var(--line-strong)" strokeWidth={1} />;
          })}
          {/* The time ruler. */}
          <Ruler s={s} from={from} to={to} y={h - 22} w={w} d={d} />
        </svg>

        {marks.map((mk, i) => {
          const y = routeY(mk.x, w, h);
          const p = placed[i];
          const isSel = !!mk.m && selected?.id === mk.m.id;
          const top = labelTop[i];
          const label = (
            <span
              key={`${mk.key}-label`}
              className={cn(
                'pointer-events-none absolute w-max max-w-[178px] rounded-md border px-2 py-1 text-left shadow-card',
                mk.kind === 'today' ? 'border-accent bg-brand text-white dark:text-canvas' : mk.kind === 'blocker' ? 'border-warning/50 bg-warning-soft text-ink' : mk.kind === 'scenario' ? 'border-[var(--model-review)]/50 bg-surface text-ink' : mk.kind === 'target' ? 'border-warning/40 bg-surface text-ink' : 'border-line bg-surface text-ink',
                isSel && 'border-accent ring-2 ring-accent/30',
              )}
              style={{ left: p.left, top, height: LABEL_H }}
              data-delivery-label={mk.kind}
              {...(mk.m ? { 'data-delivery-milestone-label': mk.m.id } : {})}
            >
              <span className="block truncate text-[12px] leading-tight font-semibold">{mk.label}</span>
              {mk.sub && <span className={cn('block truncate text-[11px] leading-tight tabular', mk.kind === 'today' ? 'text-white/85 dark:text-canvas/80' : 'text-muted')}>{mk.sub}</span>}
            </span>
          );
          const pos = { left: mk.x, top: y };
          if (mk.kind === 'milestone' && mk.m) {
            const m = mk.m;
            return [
              <button
                key={mk.key}
                type="button"
                className={cn('absolute z-[1] flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 transition-transform hover:scale-110', mk.done ? 'border-accent bg-accent text-white dark:text-canvas' : 'border-accent bg-surface', isSel && 'ring-4 ring-accent/25')}
                style={pos}
                aria-pressed={isSel}
                aria-label={`${m.name}: ${mk.sub}. Show what holds it up`}
                onClick={() => onSelect(m)}
                data-delivery-milestone={m.id}
              >
                {mk.done ? <Check className="size-3.5" aria-hidden="true" /> : <span className="size-2 rounded-full bg-accent" aria-hidden="true" />}
              </button>,
              label,
            ];
          }
          return [
            <span key={mk.key} className="absolute z-[1] -translate-x-1/2 -translate-y-1/2" style={pos} data-delivery-mark={mk.kind} {...(mk.kind === 'blocker' ? { 'data-delivery-blocker': '' } : {})}>
              {mk.kind === 'blocker' ? (
                <span className="flex size-6 items-center justify-center rounded-full border-2 border-warning bg-warning-soft text-warning">
                  <AlertTriangle className="size-3.5" aria-hidden="true" />
                </span>
              ) : mk.kind === 'today' ? (
                <span className="block size-4 rounded-full border-[3px] border-surface bg-accent shadow-[0_0_0_2px_var(--accent)]" />
              ) : mk.kind === 'target' ? (
                <span className="block size-3 rotate-45 border-2 border-surface bg-warning" />
              ) : (
                <span className={cn('block size-3 rounded-full border-2 bg-surface', mk.kind === 'scenario' ? 'border-[var(--model-review)]' : 'border-accent')} />
              )}
            </span>,
            label,
          ];
        })}
      </div>
    </div>
  );
}

function Ruler({ s, from, to, y, w, d }: { s: ReturnType<typeof timeScale>; from: number; to: number; y: number; w: number; d: (day: number) => string }) {
  // A tick a week, or every two or four weeks: whichever leaves room for each date (about 64 px).
  const perDay = Math.abs(s.x(from + 1) - s.x(from)) || 1;
  const step = [7, 14, 28, 56].find((k) => k * perDay >= 64) ?? 56;
  const ticks: number[] = [];
  for (let day = Math.ceil(from / step) * step; day <= to; day += step) ticks.push(day);
  return (
    <g>
      <line x1={s.x(from)} x2={s.x(to)} y1={y} y2={y} stroke="var(--line-strong)" />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={s.x(t)} x2={s.x(t)} y1={y - 4} y2={y + 4} stroke="var(--line-strong)" />
          {s.x(t) > 30 && s.x(t) < w - 30 && (
            <text x={s.x(t)} y={y + 16} textAnchor="middle" fontSize={11} fill="var(--muted)" fontFamily="var(--font-sans)">
              {d(t)}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

// ------------------------------------------------------------------ the chart

function ChartView({ f, sf, milestones, from, to, d, milestoneDay, selected, onSelect }: ViewProps) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const w = Math.max(300, measured);
  const s = timeScale(from, to, w, 46);
  const total = Math.max(1, f.totalTasks);
  const y = (n: number) => bottom - (n / total) * (bottom - top);
  const history = f.projectHistory.map((n, day) => ({ day, n })).filter((p) => p.day >= Math.floor(from));
  const line = (pts: { day: number; n: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${s.x(p.day).toFixed(1)} ${y(p.n).toFixed(1)}`).join('');
  const band = (series: ProgressForecast['projectSeries']) =>
    series.length ? `${series.map((p, i) => `${i ? 'L' : 'M'}${s.x(p.day).toFixed(1)} ${y(p.p10).toFixed(1)}`).join('')}${[...series].reverse().map((p) => `L${s.x(p.day).toFixed(1)} ${y(p.p90).toFixed(1)}`).join('')}Z` : '';
  const finish = f.project.finish;
  const sFinish = sf?.project.finish ?? null;
  const vlines: { day: number; label: string; color: string; dash?: string }[] = [
    { day: f.todayDay, label: `Today ${d(f.todayDay)}`, color: 'var(--accent)' },
    ...(f.deadlineDay !== null ? [{ day: f.deadlineDay, label: `Target ${d(f.deadlineDay)}`, color: 'var(--warning)', dash: '4 4' }] : []),
    ...(finish ? [{ day: finish.p50, label: `Median ${d(finish.p50)}`, color: sf ? 'var(--line-strong)' : 'var(--accent)', dash: '2 3' }] : []),
    ...(finish?.p85 !== undefined ? [{ day: finish.p85, label: `85% ${d(finish.p85)}`, color: sf ? 'var(--line-strong)' : 'var(--ink-2)', dash: '2 3' }] : []),
    ...(sFinish ? [{ day: sFinish.p50, label: `Scenario ${d(sFinish.p50)}`, color: 'var(--model-review)', dash: '2 3' }] : []),
  ];
  // The markers' labels sit in rows above the plot, so close dates (target, median, 85%) never overlap
  // on a narrow screen; a label further up keeps a line down to its marker.
  const ROW = 15;
  const placed = placeLabels(
    vlines.map((v, i) => ({ x: s.x(v.day), width: v.label.length * 6.8 + 8, priority: i })),
    w,
    6,
    3,
  );
  const rowOf = (p: PlacedLabel) => p.level * 2 + (p.side === 'below' ? 1 : 0);
  const rows = Math.max(1, ...placed.map((p) => rowOf(p) + 1));
  const top = 18 + rows * ROW;
  // The milestones under the chart, in rows when they're close together (on a phone, say).
  const CHIP_MAX = 150;
  const chips = placeLabels(
    milestones.map((m, i) => ({ x: s.x(milestoneDay(m)), width: Math.min(CHIP_MAX, m.name.length * 6.6 + 44), priority: i })),
    w,
    6,
    2,
  );
  const chipRows = Math.max(1, ...chips.map((c) => rowOf(c) + 1));
  const bottom = top + 260;
  const h = bottom + 46;
  return (
    <div ref={ref} className="rounded-xl border border-line bg-surface" data-delivery-chart="">
      <p className="px-[46px] pt-3 text-[12.5px] font-medium text-muted">Tasks approved, of {total}</p>
      <svg width={w} height={h} role="img" aria-label={`Approved tasks over time: ${f.projectHistory[f.projectHistory.length - 1] ?? 0} of ${total} approved today${finish ? `, all likely approved by ${d(finish.p50)} (10–90%: ${d(finish.p10)} to ${d(finish.p90)})` : ''}.`}>
        {/* Gridlines: 0, half and all of the tasks. */}
        {[0, 0.5, 1].map((k) => (
          <g key={k}>
            <line x1={s.x(from)} x2={s.x(to)} y1={y(total * k)} y2={y(total * k)} stroke="var(--line)" />
            <text x={s.x(from) - 8} y={y(total * k) + 4} textAnchor="end" fontSize={11} fill="var(--muted)" fontFamily="var(--font-sans)">
              {Math.round(total * k)}
            </text>
          </g>
        ))}
        <path d={band(f.projectSeries)} fill="var(--frost)" opacity={sf ? 0.25 : 0.45} />
        {sf && <path d={band(sf.projectSeries)} fill="var(--model-review)" opacity={0.16} />}
        <path d={line(history)} fill="none" stroke="var(--accent)" strokeWidth={2.5} />
        <path d={line(f.projectSeries.map((p) => ({ day: p.day, n: p.p50 })))} fill="none" stroke={sf ? 'var(--line-strong)' : 'var(--accent)'} strokeWidth={2} strokeDasharray="6 5" />
        {sf && <path d={line(sf.projectSeries.map((p) => ({ day: p.day, n: p.p50 })))} fill="none" stroke="var(--model-review)" strokeWidth={2} strokeDasharray="6 5" />}
        {/* Lines first, then every label over them (with a halo), so no line runs through a label. */}
        {vlines.map((v, i) => (
          <line key={`l-${v.label}`} x1={s.x(v.day)} x2={s.x(v.day)} y1={top - 5 - rowOf(placed[i]) * ROW} y2={bottom} stroke={v.color} strokeDasharray={v.dash} strokeWidth={1.4} />
        ))}
        {vlines.map((v, i) => (
          <text key={`t-${v.label}`} x={placed[i].left + 4} y={top - 9 - rowOf(placed[i]) * ROW} fontSize={11} fill="var(--ink-2)" fontFamily="var(--font-sans)" stroke="var(--surface)" strokeWidth={4} paintOrder="stroke" strokeLinejoin="round">
            {v.label}
          </text>
        ))}
        <Ruler s={s} from={from} to={to} y={bottom} w={w} d={d} />
      </svg>
      {/* Milestones on the same time scale: buttons, so selecting one here keeps it selected in the Path. */}
      <div className="relative mx-0 mb-3" style={{ width: w, height: chipRows * 32 + 6 }}>
        {milestones.map((m, i) => {
          const isSel = selected?.id === m.id;
          const chip = chips[i];
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onSelect(m)}
              aria-pressed={isSel}
              className={cn('absolute flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium whitespace-nowrap', isSel ? 'border-accent bg-brand-soft text-brand-ink' : 'border-line bg-surface text-ink-2 hover:border-line-strong')}
              style={{ left: chip.left, top: 4 + rowOf(chip) * 32, maxWidth: CHIP_MAX }}
              data-delivery-milestone={m.id}
            >
              {m.completed ? <Check className="size-3.5 text-success" aria-hidden="true" /> : <span className="size-2 rotate-45 bg-accent" aria-hidden="true" />}
              <span className="truncate">{m.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MilestoneTable({ f, sf, milestones, d, milestoneDay, dayOf, selected, onSelect, tasks, deps, today }: Omit<ViewProps, 'from' | 'to'> & { tasks: Task[]; deps: NonNullable<ReturnType<typeof useDeliveryForecast>['dependencies']>; today: string }) {
  return (
    <div className="relative overflow-x-auto rounded-xl border border-line bg-surface" data-delivery-table="">
      <table className="w-full min-w-[640px] text-left text-[13px]">
        <caption className="sr-only">Milestones with their forecast dates and what holds them up</caption>
        <thead className="border-b border-line text-[12.5px] text-muted">
          <tr>
            <th className="px-4 py-2.5 font-medium">Milestone</th>
            <th className="px-3 py-2.5 font-medium">Due</th>
            <th className="px-3 py-2.5 font-medium">Likely</th>
            <th className="px-3 py-2.5 font-medium">85% by</th>
            {sf && <th className="px-3 py-2.5 font-medium">Scenario</th>}
            <th className="px-3 py-2.5 font-medium">What holds it up</th>
          </tr>
        </thead>
        <tbody>
          {milestones.map((m) => {
            const r: Range | undefined = f.milestones[m.id];
            const b = m.completed ? null : milestoneBlocker(m, tasks, deps, { today, likelyDay: (id) => f.tasks[id]?.p50 ?? null });
            return (
              <tr key={m.id} className={cn('border-b border-line last:border-0', selected?.id === m.id && 'bg-brand-soft/60')}>
                <td className="px-4 py-2.5">
                  <button type="button" className="font-medium text-ink underline-offset-4 hover:underline" onClick={() => onSelect(m)} data-delivery-milestone={m.id} aria-pressed={selected?.id === m.id}>
                    {m.name}
                  </button>
                </td>
                <td className="px-3 py-2.5 tabular-nums text-ink-2">{d(dayOf(m.dueDate))}</td>
                <td className="px-3 py-2.5 tabular-nums text-ink-2">{m.completed ? `Approved ${d(milestoneDay(m))}` : r ? d(r.p50) : '—'}</td>
                <td className="px-3 py-2.5 tabular-nums text-ink-2">{!m.completed && r?.p85 !== undefined ? d(r.p85) : '—'}</td>
                {sf && <td className="px-3 py-2.5 tabular-nums text-[var(--model-review)]">{!m.completed && sf.milestones[m.id] ? d(sf.milestones[m.id].p50) : '—'}</td>}
                <td className="px-3 py-2.5 text-ink-2">{m.completed ? 'Complete' : b ? <span>{b.title}</span> : 'Nothing open'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ the inspector

function Inspector({
  project,
  f,
  d,
  dayOf,
  deps,
  impactText,
  impact,
  reviewSince,
  onEvidence,
  onWays,
  waysOpen,
  reviewDay,
  milestone,
  blocker,
  allDone,
  taskLink,
  onScenario,
  milestoneDay,
}: {
  project: ProjectDetail;
  f: ProgressForecast;
  d: (day: number) => string;
  dayOf: (iso: string) => number;
  deps: readonly Dependency[];
  impactText: string | null;
  impact: BlockerImpact | null;
  reviewSince: string | null;
  onEvidence: () => void;
  onWays: () => void;
  waysOpen: boolean;
  reviewDay: (taskId: number) => number | null;
  milestone: Milestone | null;
  blocker: MilestoneBlocker | null;
  allDone: boolean;
  taskLink: (t: Task) => string;
  onScenario: () => void;
  milestoneDay: (m: Milestone) => number;
}) {
  const heading = !blocker ? (milestone?.completed || allDone ? 'All approved' : 'Choose a milestone') : blocker.kind === 'review' ? 'Awaiting a decision' : blocker.kind === 'late' ? 'Running late' : blocker.kind === 'last' ? 'Last to finish' : 'Holding up delivery';
  const t = blocker?.task;
  const r = milestone ? f.milestones[milestone.id] : undefined;
  const review = t?.status === 'IN_REVIEW';
  return (
    <aside className="h-fit rounded-xl border border-line bg-surface xl:sticky xl:top-20" aria-label="What holds it up" data-delivery-inspector="">
      <div className="border-b border-line px-4 py-3">
        <p className="text-[13px] font-semibold text-ink-2">{milestone ? milestone.name : 'Milestone'}</p>
        {milestone && (
          <p className="mt-0.5 text-[12.5px] text-muted tabular-nums">
            {milestone.completed ? `Approved ${d(milestoneDay(milestone))}` : `Due ${d(dayOf(milestone.dueDate))}${r ? `, likely ${d(r.p50)} (10–90%: ${d(r.p10)}–${d(r.p90)})` : ''}`}
          </p>
        )}
        <h2 className="mt-2 text-[19px] leading-tight font-semibold text-ink">{heading}</h2>
      </div>
      {t && blocker ? (
        <div className="space-y-3 px-4 py-4" data-delivery-blocker-card={t.key}>
          <div>
            <p className="text-[12.5px] font-medium text-muted tabular">{t.key}</p>
            <h3 className="mt-0.5 text-[16px] leading-snug font-semibold text-ink">{t.title}</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={STATUS_TONE[t.status]}>{review ? 'Awaiting review' : STATUS_LABEL[t.status]}</Badge>
              {blocker.lateDays > 0 && <Badge tone="danger">{blocker.lateDays} {blocker.lateDays === 1 ? 'day' : 'days'} late</Badge>}
              {!blocker.inMilestone && <Badge tone="neutral">From another milestone</Badge>}
            </div>
          </div>
          <dl className="divide-y divide-line rounded-lg border border-line text-[13px]">
            <Row label="Assignee">
              {t.assignee ? (
                <span className="flex items-center gap-2">
                  <Avatar user={t.assignee} size="xs" />
                  {t.assignee.name}
                </span>
              ) : (
                <span className="text-warning">Nobody yet</span>
              )}
            </Row>
            <Row label="Holds up">{blocker.holdsUp.length ? <span className="tabular">{blocker.holdsUp.map((x) => x.key).join(', ')}</span> : 'Nothing else'}</Row>
            <Row label={review ? 'In review since' : 'Due'}>
              <span className="tabular-nums">{review ? (reviewDay(t.id) !== null ? d(reviewDay(t.id)!) : '—') : t.dueDate ? d(dayOf(t.dueDate)) : 'No due date'}</span>
            </Row>
            <Row label="Likely approved">
              <span className="tabular-nums">{f.tasks[t.id] ? `${d(f.tasks[t.id].p50)} (${d(f.tasks[t.id].p10)}–${d(f.tasks[t.id].p90)})` : '—'}</span>
            </Row>
          </dl>
          <BlockerEvidence project={project} blocker={blocker} deps={deps} reviewSince={reviewSince} usualReview={f.reviewLag} onOpen={onEvidence} />
          {blocker.kind !== 'last' && (
            <div className="rounded-lg bg-surface-2 px-3 py-2.5" data-blocker-cost={impact ? impact.costDays : ''}>
              <p className="text-[12.5px] font-medium text-muted">What it costs</p>
              <p className="mt-0.5 text-[13px] leading-snug text-ink">{impactText ?? 'Working it out from the forecast…'}</p>
            </div>
          )}
          <div className="grid gap-2">
            {blocker.kind !== 'last' && (
              <Button onClick={onWays} disabled={waysOpen} className="w-full" data-delivery-ways="">
                {waysOpen ? 'Ways forward are open' : 'Ways forward'}
              </Button>
            )}
            <Link to={taskLink(t)} className={buttonClass(blocker.kind === 'last' ? 'primary' : 'secondary', 'md', 'w-full')} data-delivery-open-task="">
              {review && can.review(project.myRole) ? 'Open the review' : 'Open task'}
              <ExternalLink aria-hidden="true" />
            </Link>
          </div>
        </div>
      ) : (
        <p className="px-4 py-4 text-[13px] text-muted">{milestone?.completed || allDone ? 'Everything in it is approved. Nothing holds it up.' : 'Select a milestone on the path or the chart to see what holds it up.'}</p>
      )}
      {!allDone && (
        <div className="flex items-start gap-3 border-t border-line px-4 py-3.5">
          <FlurryFigure className="size-10 shrink-0" glow={false} mini mood="idle" />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold text-ink">Flurry</p>
            <p className="text-[12.5px] leading-snug text-muted">Explore the impact of a smaller scope or less time, against the baseline. Nothing changes until you apply it.</p>
            <Button variant="secondary" size="sm" className="mt-2" leftIcon={<GitCompareArrows />} onClick={onScenario} data-delivery-preview-scenario="">
              Preview scenario
            </Button>
          </div>
        </div>
      )}
    </aside>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}

// ------------------------------------------------------------------ the scenario

function ScenarioPanel({
  project,
  userId,
  f,
  sf,
  d,
  tasks,
  milestone,
  blocker,
  scenario,
  setScenario,
  kept,
  setKept,
  forecastOf,
  onClose,
  onApply,
}: {
  project: ProjectDetail;
  userId: number;
  f: ProgressForecast;
  sf: ProgressForecast | null;
  d: (day: number) => string;
  tasks: Task[];
  milestone: Milestone | null;
  blocker: MilestoneBlocker | null;
  scenario: Scenario;
  setScenario: (s: Scenario) => void;
  kept: { name: string; scenario: Scenario }[];
  setKept: (k: { name: string; scenario: Scenario }[]) => void;
  forecastOf: (s: Scenario) => ProgressForecast | null;
  onClose: () => void;
  onApply: () => void;
}) {
  // Scope: the selected milestone's open work that hasn't been submitted (and the blocker, wherever it is), with an estimate to cut.
  const scope = tasks
    .filter((t) => (t.status === 'TODO' || t.status === 'IN_PROGRESS') && (t.estimateDays ?? 0) >= 2 && (t.milestoneId === milestone?.id || t.id === blocker?.task.id))
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  const people = f.people.filter((p) => p.userId !== null && p.open > 0);
  const estimateChanges = Object.entries(scenario.estimates).map(([id, days]) => ({ task: tasks.find((t) => t.id === Number(id))!, days })).filter((x) => x.task);
  const shareChanges = Object.entries(scenario.shares).map(([id, share]) => ({ person: f.people.find((p) => p.userId === Number(id))!, share })).filter((x) => x.person);
  const setCut = (t: Task, k: number) => {
    const next = { ...scenario.estimates };
    if (k === 1) delete next[t.id];
    else next[t.id] = Math.max(1, Math.round((t.estimateDays ?? 1) * k));
    setScenario({ ...scenario, estimates: next });
  };
  const setShare = (uid: number, k: number) => {
    const next = { ...scenario.shares };
    if (k === 1) delete next[uid];
    else next[uid] = k;
    setScenario({ ...scenario, shares: next });
  };
  const blocked = estimateChanges.filter((x) => !can.editTask(project.myRole, { status: x.task.status, assigneeId: x.task.assignee?.id ?? null, reporterId: x.task.reporter.id }, userId));
  const base = f.project.finish;
  const alt = sf?.project.finish ?? null;
  return (
    <section className="rounded-xl border border-[var(--model-review)]/40 bg-surface" aria-labelledby="scenario-title" data-delivery-scenario="">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <p className="text-[12.5px] font-semibold text-[var(--model-review)]">Scenario, not applied</p>
          <h2 id="scenario-title" className="mt-0.5 text-[16px] font-semibold text-ink">
            What if{milestone ? ` ${milestone.name}` : ''} had a smaller scope, or less time?
          </h2>
          <p className="text-[12.5px] text-muted">The baseline stays in grey. Same records, same random draws: only what you change moves.</p>
        </div>
        <Button variant="ghost" size="sm" leftIcon={<X />} onClick={onClose} data-delivery-discard="">
          Discard
        </Button>
      </div>
      <div className="grid gap-5 px-4 py-4 lg:grid-cols-2">
        <fieldset>
          <legend className="text-[13px] font-semibold text-ink">Smaller scope (estimates)</legend>
          {scope.length ? (
            <ul className="mt-2 space-y-2">
              {scope.map((t) => {
                const cur = scenario.estimates[t.id];
                return (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                    <span className="min-w-0">
                      <span className="font-mono text-[12px] text-muted">{t.key}</span> <span className="text-[13px] text-ink">{t.title}</span>
                    </span>
                    <span className="inline-flex rounded-md border border-line p-0.5" role="group" aria-label={`Scope of ${t.key}`}>
                      {CUTS.map((k) => {
                        const days = Math.max(1, Math.round((t.estimateDays ?? 1) * k));
                        const on = k === 1 ? cur === undefined : cur === days;
                        return (
                          <button key={k} type="button" aria-pressed={on} onClick={() => setCut(t, k)} className={cn('h-7 rounded-[5px] px-2 text-[12px] tabular-nums', on ? 'bg-brand-soft font-semibold text-brand-ink' : 'text-muted hover:text-ink')} data-scope-cut={`${t.key}:${k}`}>
                            {k === 1 ? `${t.estimateDays} d` : `${days} d`}
                          </button>
                        );
                      })}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-[12.5px] text-muted">No open work here with an estimate of two days or more to cut.</p>
          )}
        </fieldset>
        <fieldset>
          <legend className="text-[13px] font-semibold text-ink">Less time (an assumption)</legend>
          <ul className="mt-2 space-y-2">
            {people.map((p) => {
              const cur = scenario.shares[p.userId!] ?? 1;
              return (
                <li key={p.userId} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                  <span className="text-[13px] text-ink">{p.name}</span>
                  <span className="inline-flex rounded-md border border-line p-0.5" role="group" aria-label={`${p.name}’s time`}>
                    {SHARES.map((k) => (
                      <button key={k} type="button" aria-pressed={cur === k} onClick={() => setShare(p.userId!, k)} className={cn('h-7 rounded-[5px] px-2 text-[12px] tabular-nums', cur === k ? 'bg-brand-soft font-semibold text-brand-ink' : 'text-muted hover:text-ink')}>
                        {k === 1 ? 'As now' : `${Math.round(k * 100)}%`}
                      </button>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[12px] text-muted">Never more than their recorded time: adding people rarely speeds work up as much as it seems.</p>
        </fieldset>
      </div>
      <div className="border-t border-line px-4 py-3.5" aria-live="polite" data-delivery-compare-result="">
        {alt && base ? (
          <p className="text-[13.5px] text-ink">
            Median finish <span className="text-muted line-through decoration-muted/60">{d(base.p50)}</span> → <strong className="text-[var(--model-review)]">{d(alt.p50)}</strong>; 85% by{' '}
            <span className="text-muted line-through decoration-muted/60">{base.p85 !== undefined ? d(base.p85) : '—'}</span> → <strong className="text-[var(--model-review)]">{alt.p85 !== undefined ? d(alt.p85) : '—'}</strong>
            {f.project.pDeadline !== null && sf?.project.pDeadline !== null && sf && (
              <>
                {' '}
                ; on time {chanceText(f.project.pDeadline)} → <strong className="text-[var(--model-review)]">{chanceText(sf.project.pDeadline!)}</strong>
              </>
            )}
          </p>
        ) : (
          <p className="text-[13px] text-muted">Change a scope or someone’s time to compare with the baseline.</p>
        )}
        {(estimateChanges.length > 0 || shareChanges.length > 0) && (
          <ul className="mt-2 space-y-0.5 text-[12.5px] text-ink-2" data-delivery-changes="">
            {estimateChanges.map((x) => (
              <li key={x.task.id}>
                <span className="font-mono">{x.task.key}</span> estimate {x.task.estimateDays} → {x.days} working days (smaller scope)
              </li>
            ))}
            {shareChanges.map((x) => (
              <li key={x.person.userId}>
                {x.person.name} at {Math.round(x.share * 100)}% of their recorded time (assumption only)
              </li>
            ))}
          </ul>
        )}
        <KeptOptions f={f} d={d} tasks={tasks} people={f.people} scenario={scenario} kept={kept} setKept={setKept} setScenario={setScenario} forecastOf={forecastOf} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!estimateChanges.length || blocked.length > 0} onClick={onApply} data-delivery-apply="">
            {estimateChanges.length ? `Apply ${estimateChanges.length} estimate ${estimateChanges.length === 1 ? 'change' : 'changes'}…` : 'Apply scope changes…'}
          </Button>
          <span className="text-[12px] text-muted">
            {blocked.length
              ? `You can’t change the estimate of ${blocked.map((x) => x.task.key).join(', ')}: only managers, or a task’s assignee or creator, can.`
              : shareChanges.length
                ? 'Time is an assumption, so there’s nothing to apply for it.'
                : 'You’ll see the exact changes before anything is saved.'}
          </span>
        </div>
      </div>
    </section>
  );
}

const OPTION_NAMES = ['A', 'B', 'C'] as const;
const sameScenario = (a: Scenario, b: Scenario) => JSON.stringify(a) === JSON.stringify(b);

/** Scenarios kept as options A, B and C, compared side by side with the baseline; one can be loaded to apply. */
function KeptOptions({
  f,
  d,
  tasks,
  people,
  scenario,
  kept,
  setKept,
  setScenario,
  forecastOf,
}: {
  f: ProgressForecast;
  d: (day: number) => string;
  tasks: Task[];
  people: ProgressForecast['people'];
  scenario: Scenario;
  kept: { name: string; scenario: Scenario }[];
  setKept: (k: { name: string; scenario: Scenario }[]) => void;
  setScenario: (s: Scenario) => void;
  forecastOf: (s: Scenario) => ProgressForecast | null;
}) {
  const changed = Object.keys(scenario.estimates).length + Object.keys(scenario.shares).length > 0;
  const already = kept.find((k) => sameScenario(k.scenario, scenario));
  const free = OPTION_NAMES.find((n) => !kept.some((k) => k.name === n));
  const rows = useMemo(() => kept.map((k) => ({ ...k, fc: forecastOf(k.scenario) })), [kept, forecastOf]);
  const describe = (s: Scenario) =>
    [
      ...Object.entries(s.estimates).map(([id, days]) => `${tasks.find((t) => t.id === Number(id))?.key ?? '?'} to ${days} d`),
      ...Object.entries(s.shares).map(([id, share]) => `${people.find((p) => p.userId === Number(id))?.name ?? 'someone'} at ${Math.round(share * 100)}%`),
    ].join(', ');
  const base = f.project.finish;
  const delta = (fc: ProgressForecast | null) => {
    if (!fc?.project.finish || !base) return '—';
    const n = Math.round(fc.project.finish.p50 - base.p50);
    return n === 0 ? 'no change' : `${n > 0 ? '+' : '−'}${Math.abs(n)} ${Math.abs(n) === 1 ? 'day' : 'days'}`;
  };
  return (
    <div className="mt-3 space-y-2" data-delivery-options="">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="xs"
          disabled={!changed || !!already || !free}
          onClick={() => free && setKept([...kept, { name: free, scenario }])}
          data-delivery-keep-option=""
        >
          {already ? `Kept as option ${already.name}` : free ? `Keep as option ${free}` : 'Three options kept'}
        </Button>
        <span className="text-[12px] text-muted">Keep up to three, then compare them side by side before applying one.</span>
      </div>
      {rows.length > 0 && (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[12.5px]" data-delivery-options-table="">
            <caption className="sr-only">Kept options compared with the baseline</caption>
            <thead>
              <tr className="border-b border-line text-muted">
                <th scope="col" className="py-1.5 pr-3 font-medium">Option</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Median finish</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">85% by</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">On time</th>
                <th scope="col" className="py-1.5 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-line text-muted">
                <td className="py-1.5 pr-3">Baseline</td>
                <td className="py-1.5 pr-3 tabular-nums">{base ? d(base.p50) : 'Done'}</td>
                <td className="py-1.5 pr-3 tabular-nums">{base?.p85 !== undefined ? d(base.p85) : '—'}</td>
                <td className="py-1.5 pr-3 tabular-nums">{f.project.pDeadline !== null ? chanceText(f.project.pDeadline) : '–'}</td>
                <td />
              </tr>
              {rows.map((r) => {
                const fin = r.fc?.project.finish;
                const current = sameScenario(r.scenario, scenario);
                return (
                  <tr key={r.name} className={cn('border-b border-line last:border-b-0', current && 'bg-brand-soft/40')} data-delivery-option={r.name}>
                    <td className="py-1.5 pr-3">
                      <span className="font-semibold text-ink">Option {r.name}</span>
                      <span className="block text-[12px] text-muted">{describe(r.scenario)}</span>
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {fin ? d(fin.p50) : 'Done'} <span className="text-muted">({delta(r.fc)})</span>
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">{fin?.p85 !== undefined ? d(fin.p85) : '—'}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{r.fc && r.fc.project.pDeadline !== null ? chanceText(r.fc.project.pDeadline) : '–'}</td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      <Button variant="ghost" size="xs" disabled={current} onClick={() => setScenario(r.scenario)} data-delivery-load-option={r.name}>
                        {current ? 'Showing' : 'Show'}
                      </Button>
                      <Button variant="ghost" size="xs" onClick={() => setKept(kept.filter((k) => k.name !== r.name))} aria-label={`Remove option ${r.name}`}>
                        <X aria-hidden="true" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ApplyDialog({ project, tasks, scenario, userId, onClose }: { project: ProjectDetail; tasks: Task[]; scenario: Scenario; userId: number; onClose: (saved: boolean) => void }) {
  const [update] = useUpdateTaskMutation();
  const [busy, setBusy] = useState(false);
  const changes = Object.entries(scenario.estimates)
    .map(([id, days]) => ({ task: tasks.find((t) => t.id === Number(id))!, days }))
    .filter((x) => x.task);
  void userId;
  const body = (t: Task, estimateDays: number | null): TaskRequest => ({
    title: t.title,
    description: t.description,
    priority: t.priority,
    assigneeId: t.assignee?.id ?? null,
    dueDate: t.dueDate,
    milestoneId: t.milestoneId,
    estimateDays,
    version: t.version,
  });
  const apply = async () => {
    setBusy(true);
    const saved: { before: Task; after: Task }[] = [];
    const failed: string[] = [];
    for (const x of changes) {
      try {
        const after = await update({ id: x.task.id, projectId: project.id, body: body(x.task, x.days) }).unwrap();
        saved.push({ before: x.task, after });
      } catch (e) {
        failed.push(`${x.task.key}: ${getErrorMessage(e)}`);
      }
    }
    setBusy(false);
    if (saved.length) {
      flurryMoment({ kind: 'happy' });
      toast.success(`${saved.length} ${saved.length === 1 ? 'estimate' : 'estimates'} saved. The forecast has been recalculated.`, {
        action: {
          label: 'Undo',
          onClick: () =>
            void Promise.all(saved.map((s) => update({ id: s.after.id, projectId: project.id, body: { ...body(s.after, s.before.estimateDays), version: s.after.version } }).unwrap())).then(
              () => toast.success('Estimates put back.'),
              (e) => toast.error(`Couldn’t put every estimate back: ${getErrorMessage(e)}`),
            ),
        },
      });
    }
    if (failed.length) toast.error(`Not saved: ${failed.join('; ')}`);
    onClose(saved.length > 0 && !failed.length);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onClose(false)}
      title="Apply these scope changes?"
      description="These are the exact changes. The forecast will use them from now on; you can undo them right after."
      footer={
        <>
          <Button variant="secondary" onClick={() => onClose(false)} disabled={busy}>
            Keep the plan
          </Button>
          <Button onClick={() => void apply()} loading={busy} data-delivery-apply-confirm="">
            Apply {changes.length} {changes.length === 1 ? 'change' : 'changes'}
          </Button>
        </>
      }
    >
      <ul className="space-y-2" data-delivery-apply-list="">
        {changes.map((x) => (
          <li key={x.task.id} className="rounded-lg border border-line px-3 py-2 text-[13px]">
            <span className="font-mono text-[12px] text-muted">{x.task.key}</span> <span className="text-ink">{x.task.title}</span>
            <span className="mt-0.5 block text-ink-2">
              Estimate: {x.task.estimateDays} → <strong>{x.days}</strong> working days
            </span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
