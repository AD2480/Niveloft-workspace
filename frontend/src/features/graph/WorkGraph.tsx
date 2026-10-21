import { format } from 'date-fns';
import { List, RotateCcw, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router';
import type { ProjectDetail } from '@/api/types';
import { useAppSelector } from '@/app/store';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/States';
import type { DeliveryForecastData } from '@/features/forecast/useDeliveryForecast';
import { suggestNext } from '@/lib/assistantIntents';
import { cn } from '@/lib/cn';
import { PRIORITY_LABEL, STATUS_COLOR, STATUS_LABEL } from '@/lib/constants';
import { chanceText, dateRange, dayText, forecastFor, projectBlocker } from '@/lib/forecastText';
import { buildGraph, chainOf, defaultLens, LENS_LABEL, LENS_QUESTION, lensesFor, type GraphData, type GraphItem, type GraphLane, type Lens } from './workGraphData';

type Zoom = '2w' | '6w' | 'all';
const ZOOM_LABEL: Record<Zoom, string> = { '2w': '2 weeks', '6w': '6 weeks', all: 'Whole project' };
const ROW = 32;
const HEAD = 30;
const BLOCK = 20;
/** Milestone rows in the delivery view: two lines of label each. */
const DROW = 42;

const fill = (status: GraphItem['status']) => `color-mix(in srgb, ${STATUS_COLOR[status]} 26%, var(--surface))`;
const edge = (status: GraphItem['status']) => `color-mix(in srgb, ${STATUS_COLOR[status]} 75%, var(--ink))`;

/**
 * The work graph: people (or milestones) down the side, calendar time across. Recorded work is
 * solid, planned work (the forecast's typical schedule) is outlined, and a thin band shows the
 * forecast's range for when open work is approved. Selecting a task isolates it: its dependencies
 * appear as connectors and everything else fades. Each role opens on the view that answers its
 * question; all views are available as a plain list too, and nothing needs WebGL.
 */
export function WorkGraph({
  project,
  data,
  className,
  initialLens,
  heading,
  asUser,
  lensLocked = false,
  sample = false,
}: {
  project: ProjectDetail;
  data: DeliveryForecastData;
  className?: string;
  initialLens?: Lens;
  heading?: ReactNode;
  /** Show the graph as this person sees it (the front page's role views). */
  asUser?: number | null;
  /** The view is chosen outside (no view switcher). */
  lensLocked?: boolean;
  /** A sample on a public page: task keys aren't links. */
  sample?: boolean;
}) {
  const signedInAs = useAppSelector((s) => s.auth.user?.id ?? null);
  const me = asUser !== undefined ? asUser : signedInAs;
  const tasks = data.tasks;
  const hasOwnWork = !!tasks?.some((t) => t.assignee?.id === me);
  const available = lensesFor(project.myRole);
  const [lensChoice, setLensChoice] = useState<Lens | null>(initialLens ?? null);
  const lens: Lens = lensChoice ?? defaultLens(project.myRole, hasOwnWork);
  const [zoom, setZoom] = useState<Zoom>('6w');
  const [view, setView] = useState<'graph' | 'list'>('graph');
  const [selected, setSelected] = useState<number | null>(null);

  const graph = useMemo(
    () => (data.model && tasks ? buildGraph({ model: data.model, forecast: data.forecast, tasks, milestones: data.milestones ?? [], lens, me }) : null),
    [data.model, data.forecast, tasks, data.milestones, lens, me],
  );
  useEffect(() => setSelected(null), [lens]);

  if (data.error) return <ErrorState error={data.error} title="Couldn’t load the records for the graph" onRetry={data.refetch} />;
  if (!graph || !data.model) return <Skeleton className={cn('h-80 w-full', className)} />;

  const summary = lensSummary(lens, graph, data, me, project);
  return (
    <section className={cn('rounded-lg border border-line bg-surface', className)} aria-labelledby={`graph-${project.id}-title`} data-work-graph={lens}>
      <div className="flex flex-col gap-3 px-4 pt-4 sm:px-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 id={`graph-${project.id}-title`} className="text-[16px] font-semibold text-ink">
            {heading ?? 'Work over time'}
          </h2>
          <p className="mt-0.5 text-[13.5px] font-medium text-ink-2" data-graph-question="">
            {LENS_QUESTION[lens]}
          </p>
          {summary && (
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted" data-graph-summary="">
              {summary}
            </p>
          )}
        </div>
        {/* Compact toolbar: view, date range, graph or list, reset. */}
        <div className="flex flex-wrap items-center gap-2" data-print="hide">
          {available.length > 1 && !lensLocked && (
            <Segmented label="Graph view" value={lens} onChange={(v) => setLensChoice(v)} options={available.map((l) => ({ value: l, label: LENS_LABEL[l] }))} />
          )}
          <Segmented label="Date range" value={zoom} onChange={setZoom} options={(['2w', '6w', 'all'] as Zoom[]).map((z) => ({ value: z, label: ZOOM_LABEL[z] }))} />
          <button
            type="button"
            onClick={() => setView(view === 'graph' ? 'list' : 'graph')}
            aria-pressed={view === 'list'}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[13px] font-medium text-ink-2 hover:border-line-strong hover:text-ink"
            data-graph-list-toggle=""
          >
            <List className="size-3.5" aria-hidden="true" /> {view === 'graph' ? 'Show as a list' : 'Show the graph'}
          </button>
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setZoom('6w');
              setLensChoice(initialLens ?? null);
              setView('graph');
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-muted hover:text-ink"
            data-graph-reset=""
          >
            <RotateCcw className="size-3.5" aria-hidden="true" /> Reset
          </button>
        </div>
      </div>
      <Legend lens={lens} />
      <div className={cn('grid', selected !== null && 'xl:grid-cols-[minmax(0,1fr)_320px]')}>
        {view === 'graph' ? (
          <GraphCanvas graph={graph} originMs={data.model.originMs} zoom={zoom} selected={selected} onSelect={setSelected} data={data} />
        ) : (
          <GraphList graph={graph} originMs={data.model.originMs} projectId={project.id} data={data} sample={sample} />
        )}
        {selected !== null && (
          <Detail graph={graph} id={selected} originMs={data.model.originMs} projectId={project.id} data={data} sample={sample} onClose={() => setSelected(null)} />
        )}
      </div>
    </section>
  );
}

function Legend({ lens }: { lens: Lens }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-3 pb-2 text-[12px] text-muted sm:px-5" aria-label="How to read the graph">
      <li className="flex items-center gap-1.5">
        <span className="h-3 w-5 rounded-sm border" style={{ background: fill('IN_PROGRESS'), borderColor: edge('IN_PROGRESS') }} aria-hidden="true" /> Recorded work
      </li>
      <li className="flex items-center gap-1.5">
        <span className="h-3 w-5 rounded-sm border-[1.5px] border-dashed border-line-strong" aria-hidden="true" /> Planned (typical forecast)
      </li>
      <li className="flex items-center gap-1.5">
        <span className="relative h-3 w-6" aria-hidden="true">
          <span className="absolute top-1.5 h-0.5 w-6 rounded-full bg-accent/50" />
          <span className="absolute top-0.5 left-2.5 size-2 rounded-full bg-accent" />
        </span>
        Likely approved (range)
      </li>
      {lens !== 'delivery' &&
        (['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const).map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: STATUS_COLOR[s] }} aria-hidden="true" />
            {STATUS_LABEL[s]}
          </li>
        ))}
      <li className="flex items-center gap-1.5">
        <span className="h-3 w-px bg-ink" aria-hidden="true" /> Today
      </li>
    </ul>
  );
}

/** One sentence that answers the view's question, from the forecast. */
/** For "my work" when nothing is expected to hold you up: say so, but still name what you depend on. */
function dependsText(g: GraphData): string {
  const others = g.items.filter((it) => it.muted && it.status !== 'DONE');
  if (!others.length) return 'It doesn’t wait on anyone else’s work.';
  const names = others.slice(0, 2).map((it) => `${it.key}${it.owner ? ` (${it.owner})` : ''}`);
  return `It depends on ${names.join(' and ')}${others.length > 2 ? ` and ${others.length - 2} more` : ''}, likely approved before you need ${others.length === 1 ? 'it' : 'them'}.`;
}

function lensSummary(lens: Lens, g: GraphData, data: DeliveryForecastData, me: number | null, project: ProjectDetail): string | null {
  const f = data.forecast;
  const origin = data.model!.originMs;
  if (!f) return 'Nothing open to forecast.';
  if (lens === 'mine') {
    const mine = forecastFor(f, me);
    if (!mine || !mine.open) return 'Nothing open is assigned to you in this project.';
    const next = data.tasks ? suggestNext(data.tasks.filter((t) => t.assignee?.id === me && t.status !== 'DONE')) : [];
    return [
      mine.finish ? `Your work is likely approved ${dateRange(origin, mine.finish)}.` : '',
      mine.mainDependency ? `It waits on ${mine.mainDependency.key}${mine.mainDependency.owner ? ` (${mine.mainDependency.owner})` : ''}.` : dependsText(g),
      next[0] ? `Next: ${next[0].task.key}, ${next[0].reason.charAt(0).toLowerCase()}${next[0].reason.slice(1)}`.replace(/([^.!?])$/, '$1.') : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (lens === 'reviews') {
    const inReview = g.items.filter((it) => it.status === 'IN_REVIEW');
    if (!inReview.length) return 'Nothing is waiting for review, so no one is waiting on a reviewer.';
    const held = g.items.filter((it) => it.status !== 'DONE' && it.blockedBy.some((p) => inReview.some((r) => r.id === p)));
    const who = [...new Set(held.map((it) => it.owner ?? 'nobody yet'))];
    return `${inReview.length} ${inReview.length === 1 ? 'submission waits' : 'submissions wait'} for review${held.length ? `; ${held.length === 1 ? 'it holds up' : 'they hold up'} ${held.map((h) => h.key).join(', ')} (${who.join(', ')})` : '; nothing else waits on them'}. Reviewing ${inReview[0].key} first helps most.`;
  }
  if (lens === 'team') {
    const b = projectBlocker(f);
    const finish = f.project.finish;
    const projectP50 = finish?.p50 ?? f.todayDay;
    // People likely to be free well before the end, other than whoever already owns the blocker.
    const room = f.people.filter((p) => p.userId !== null && p.role !== 'VIEWER' && p.finish && projectP50 - p.finish.p50 >= 5 && p.name !== b?.owner);
    return [
      finish ? `Likely done ${dateRange(origin, finish)}${project.deadline && f.project.pDeadline !== null ? `, ${chanceText(f.project.pDeadline)} chance by the deadline` : ''}.` : '',
      b ? `${b.key}${b.owner ? ` (${b.owner})` : ' (no owner)'} holds up ${b.waiting.map((w) => w.name.split(' ')[0]).join(', ')}.` : 'No one’s work is waiting on anyone else’s.',
      room.length && b ? `${room.map((p) => p.name.split(' ')[0]).join(', ')} ${room.length === 1 ? 'has' : 'have'} room and could help with it.` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  const next = g.lanes.find((l) => l.milestone && !l.milestone.completed && l.milestone.id !== null);
  return [
    next?.milestone?.band ? `Next milestone, “${next.label}”${next.milestone.dueDay !== null ? `, is due ${dayText(origin, next.milestone.dueDay)}` : ''}; its work is likely approved ${dateRange(origin, next.milestone.band)}.` : '',
    f.project.finish ? `The whole project is likely done ${dateRange(origin, f.project.finish)}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function GraphCanvas({ graph, originMs, zoom, selected, onSelect, data }: { graph: GraphData; originMs: number; zoom: Zoom; selected: number | null; onSelect: (id: number | null) => void; data: DeliveryForecastData }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const span = Math.max(1, graph.end - graph.start);
  const px = zoom === '2w' ? 46 : zoom === '6w' ? 18 : Math.max(3, (width - 8) / span);
  const x = (day: number) => (day - graph.start) * px;
  const totalW = Math.max(width, span * px);
  const height = HEAD + graph.rows * ROW + 6;

  // Open near today (a quarter from the left), and again whenever the range changes.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, x(graph.today) - el.clientWidth * 0.25);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, graph.lens, graph.start]);

  const chain = useMemo(() => (selected !== null ? chainOf(graph.items, selected) : null), [graph.items, selected]);
  const byId = useMemo(() => new Map(graph.items.map((it) => [it.id, it])), [graph.items]);
  const person = (lane: GraphLane) => (lane.userId !== null ? data.forecast?.people.find((p) => p.userId === lane.userId) : data.forecast?.people.find((p) => p.userId === null));

  // Week lines and labels (Mondays), sparser when zoomed out.
  const ticks = useMemo(() => {
    const out: { day: number; label: string }[] = [];
    const step = px * 7 < 34 ? 28 : 7;
    for (let d = Math.ceil(graph.start); d <= graph.end; d++) {
      const date = new Date(originMs + d * 86_400_000 + 43_200_000);
      if (date.getDay() === 1 && (step === 7 || date.getDate() <= 7)) out.push({ day: d, label: format(date, step === 7 ? 'd MMM' : 'MMM') });
    }
    return out;
  }, [graph.start, graph.end, originMs, px]);

  const spanOf = (it: GraphItem) => {
    const s = Math.min(it.recorded?.start ?? Infinity, it.planned?.start ?? Infinity);
    const e = Math.max(it.recorded?.end ?? -Infinity, it.planned?.end ?? -Infinity);
    return Number.isFinite(s) ? { s, e: Math.max(e, s + 12 / px) } : { s: it.createdDay, e: it.createdDay + 12 / px };
  };

  // Keyboard: arrows move between tasks (left/right in time, up/down between rows), Enter selects, Escape clears.
  const ordered = useMemo(() => [...graph.items].sort((a, b) => a.row - b.row || spanOf(a).s - spanOf(b).s), [graph.items, px]); // eslint-disable-line react-hooks/exhaustive-deps
  const [focusId, setFocusId] = useState<number | null>(null);
  const tabId = focusId ?? selected ?? ordered[0]?.id ?? null;
  const focus = (id: number) => {
    setFocusId(id);
    const el = scroller.current?.querySelector<HTMLButtonElement>(`[data-graph-item="${id}"]`);
    el?.focus();
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = graph.items.find((it) => it.id === (focusId ?? selected));
    if (e.key === 'Escape') {
      onSelect(null);
      return;
    }
    if (!cur || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const s = spanOf(cur).s;
    let next: GraphItem | undefined;
    if (e.key === 'Home') next = ordered[0];
    else if (e.key === 'End') next = ordered[ordered.length - 1];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const same = ordered.filter((it) => it.row === cur.row);
      const i = same.indexOf(cur);
      next = same[i + (e.key === 'ArrowRight' ? 1 : -1)];
    } else {
      const rows = [...new Set(ordered.map((it) => it.row))].sort((a, b) => a - b);
      const target = rows[rows.indexOf(cur.row) + (e.key === 'ArrowDown' ? 1 : -1)];
      if (target !== undefined) next = ordered.filter((it) => it.row === target).sort((a, b) => Math.abs(spanOf(a).s - s) - Math.abs(spanOf(b).s - s))[0];
    }
    if (next) focus(next.id);
  };

  if (graph.lens === 'delivery') return <DeliveryCanvas graph={graph} originMs={originMs} x={x} totalW={totalW} ticks={ticks} scroller={scroller} />;

  return (
    <div className="flex min-w-0 border-t border-line" data-graph-canvas="">
      {/* Labels stay put while the time axis scrolls. */}
      <div className="w-36 shrink-0 border-r border-line bg-surface sm:w-44" aria-hidden="true">
        <div style={{ height: HEAD }} className="border-b border-line" />
        {graph.lanes.map((l) => {
          const p = person(l);
          return (
            <div key={l.id} style={{ height: l.rows * ROW }} className={cn('border-b border-line px-3', l.rows === 1 ? 'flex items-center' : 'py-1.5')}>
              {/* A one-row lane has room for one line: the name, then the summary if it fits. */}
              <p className={cn('truncate text-[13px] font-medium text-ink', l.rows === 1 && 'min-w-0')}>
                {l.label}
                {l.rows === 1 && <span className="font-normal text-muted">, {p?.open ? `${p.open} open` : 'nothing open'}</span>}
              </p>
              {l.rows > 1 && (
                <p className="truncate text-[12px] text-muted">
                  {p?.open ? `${p.open} open${p.finish ? `, done ${dateRange(originMs, p.finish)}` : ''}` : 'Nothing open'}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div ref={scroller} className="scrollbar-thin relative min-w-0 flex-1 overflow-x-auto" onKeyDown={onKeyDown} role="group" aria-label="Tasks over time. Use the arrow keys to move between tasks, Enter to select one, Escape to clear.">
        <div className="relative" style={{ width: totalW, height }}>
          {/* Faint weekly grid, the deadline and today. */}
          <svg className="pointer-events-none absolute inset-0" width={totalW} height={height} aria-hidden="true">
            {ticks.map((t) => (
              <line key={t.day} x1={x(t.day)} x2={x(t.day)} y1={HEAD} y2={height} className="stroke-line" strokeWidth={1} />
            ))}
            {graph.lanes.map((l) => (
              <line key={l.id} x1={0} x2={totalW} y1={HEAD + (l.rowStart + l.rows) * ROW} y2={HEAD + (l.rowStart + l.rows) * ROW} className="stroke-line" strokeWidth={1} />
            ))}
            {graph.deadline !== null && <line x1={x(graph.deadline)} x2={x(graph.deadline)} y1={0} y2={height} stroke="var(--danger)" strokeWidth={1.5} strokeDasharray="4 3" />}
            <line x1={x(graph.today)} x2={x(graph.today)} y1={0} y2={height} stroke="var(--ink)" strokeWidth={1.5} />
            {selected !== null && <Connectors byId={byId} selected={selected} x={x} spanOf={spanOf} />}
          </svg>
          {/* Axis labels. */}
          <div className="absolute inset-x-0 top-0 border-b border-line text-[11px] text-muted" style={{ height: HEAD }} aria-hidden="true">
            {ticks
              // A date that would sit under the Today or Deadline tag is left out.
              .filter((t) => Math.abs(x(t.day) + 18 - x(graph.today)) > 44 && (graph.deadline === null || Math.abs(x(t.day) + 18 - x(graph.deadline)) > 50))
              .map((t) => (
                <span key={t.day} className="absolute top-2 pl-1 whitespace-nowrap" style={{ left: x(t.day) }}>
                  {t.label}
                </span>
              ))}
            {graph.milestones.map((m) => (
              <span key={`${m.name}-${m.day}`} className="absolute top-3.5 size-2 -translate-x-1/2 rotate-45 border border-ink-2" style={{ left: x(m.day), background: m.completed ? 'var(--ink-2)' : 'var(--surface)' }} title={`Milestone: ${m.name}`} />
            ))}
            <span className="absolute top-1 -translate-x-1/2 rounded bg-ink px-1.5 py-px text-[11px] font-medium text-canvas" style={{ left: x(graph.today) }}>
              Today
            </span>
            {graph.deadline !== null && (
              <span className="absolute top-1 -translate-x-1/2 rounded bg-danger-soft px-1.5 py-px text-[11px] font-medium text-danger" style={{ left: x(graph.deadline) }}>
                Deadline
              </span>
            )}
          </div>
          {graph.items.map((it) => {
            const { s, e } = spanOf(it);
            const left = x(s);
            const w = Math.max(12, x(e) - left);
            const faded = chain ? !chain.has(it.id) : it.muted;
            const top = HEAD + it.row * ROW + (ROW - BLOCK) / 2 - 3;
            const label = `${it.key} ${it.title}. ${it.owner ?? 'No owner'}. ${STATUS_LABEL[it.status]}, ${PRIORITY_LABEL[it.priority]} priority.${it.band ? ` Likely approved ${dateRange(originMs, it.band)}.` : ''}${it.flag === 'blocker' ? ' Holds up other work.' : ''}`;
            return (
              <div key={it.id}>
                <button
                  type="button"
                  data-graph-item={it.id}
                  tabIndex={it.id === tabId ? 0 : -1}
                  onFocus={() => setFocusId(it.id)}
                  onClick={() => onSelect(selected === it.id ? null : it.id)}
                  aria-pressed={selected === it.id}
                  aria-label={label}
                  title={`${it.key}: ${it.title}`}
                  className={cn(
                    'absolute flex items-center overflow-hidden rounded-[5px] text-left outline-offset-1 outline-ink/50 transition-opacity hover:z-10 hover:outline hover:outline-1 focus-visible:z-10',
                    selected === it.id && 'z-10 ring-2 ring-accent ring-offset-1 ring-offset-surface',
                    selected !== it.id && it.flag === 'blocker' && 'ring-2 ring-danger/70',
                    selected !== it.id && it.flag === 'review' && 'ring-2 ring-warning/70',
                  )}
                  style={{ left, width: w, top, height: BLOCK }}
                >
                  {/* Recorded part: solid. Planned part: outlined. Faded blocks fade their shapes, never their words. */}
                  {it.recorded && (
                    <span
                      className={cn('absolute inset-y-0 rounded-l-[5px] border', faded && 'opacity-30')}
                      style={{ left: 0, width: Math.max(4, x(it.recorded.end) - left), background: fill(it.status), borderColor: edge(it.status) }}
                    />
                  )}
                  {it.planned && (
                    <span
                      className={cn('absolute inset-y-0 rounded-r-[5px] border-[1.5px] border-dashed', faded && 'opacity-30')}
                      style={{ left: Math.max(0, x(it.planned.start) - left), right: 0, borderColor: it.planned.late ? 'var(--danger)' : edge(it.status), background: 'var(--surface)' }}
                    />
                  )}
                  {!it.recorded && !it.planned && <span className={cn('absolute inset-0 rounded-[5px] border', faded && 'opacity-30')} style={{ background: fill(it.status), borderColor: edge(it.status) }} />}
                  <span className={cn('relative flex min-w-0 items-center gap-1 px-1.5 text-[11.5px] leading-none', faded ? 'text-muted' : 'text-ink')}>
                    <span className={cn('size-1.5 shrink-0 rounded-full', faded && 'opacity-40')} style={{ background: STATUS_COLOR[it.status] }} aria-hidden="true" />
                    <span className="shrink-0 font-medium">{it.key}</span>
                    {w > 150 && <span className={cn('min-w-0 truncate', faded ? 'text-muted' : 'text-ink-2')}>{it.title}</span>}
                  </span>
                  {(it.priority === 'URGENT' || it.priority === 'HIGH') && w > 76 && (
                    <span className={cn('relative ml-auto mr-1 shrink-0 rounded-sm px-1 text-[11px] leading-4 font-semibold', it.priority === 'URGENT' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning')} aria-hidden="true">
                      {it.priority === 'URGENT' ? '!!' : '!'}
                    </span>
                  )}
                </button>
                {it.band && (
                  <span className={cn('pointer-events-none absolute', faded && 'opacity-30')} style={{ left: x(it.band.p10), width: Math.max(3, x(it.band.p90) - x(it.band.p10)), top: top + BLOCK + 2, height: 4 }} aria-hidden="true">
                    <span className="absolute inset-x-0 top-[1px] h-0.5 rounded-full bg-accent/45" />
                    <span className="absolute top-0 size-1 -translate-x-1/2 rounded-full bg-accent" style={{ left: x(it.band.p50) - x(it.band.p10) }} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Dependency connectors for the selected task only: what it waits on, and what waits on it. */
function Connectors({ byId, selected, x, spanOf }: { byId: Map<number, GraphItem>; selected: number; x: (d: number) => number; spanOf: (it: GraphItem) => { s: number; e: number } }) {
  const sel = byId.get(selected);
  if (!sel) return null;
  const y = (it: GraphItem) => HEAD + it.row * ROW + ROW / 2 - 3;
  const links: { from: GraphItem; to: GraphItem }[] = [];
  for (const p of sel.blockedBy) if (byId.has(p)) links.push({ from: byId.get(p)!, to: sel });
  for (const n of sel.blocks) if (byId.has(n)) links.push({ from: sel, to: byId.get(n)! });
  return (
    <g>
      <defs>
        <marker id="graph-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 8 4 0 8z" fill="var(--accent)" />
        </marker>
      </defs>
      {links.map(({ from, to }) => {
        const x1 = x(spanOf(from).e);
        const y1 = y(from);
        const x2 = x(spanOf(to).s);
        const y2 = y(to);
        const mid = Math.max(x1 + 8, Math.min(x2 - 8, (x1 + x2) / 2));
        return <path key={`${from.id}-${to.id}`} d={`M${x1} ${y1} H${mid} V${y2} H${x2 - 1}`} fill="none" stroke="var(--accent)" strokeWidth={1.5} markerEnd="url(#graph-arrow)" />;
      })}
    </g>
  );
}

function DeliveryCanvas({ graph, originMs, x, totalW, ticks, scroller }: { graph: GraphData; originMs: number; x: (d: number) => number; totalW: number; ticks: { day: number; label: string }[]; scroller: RefObject<HTMLDivElement | null> }) {
  const height = HEAD + graph.rows * DROW + 6;
  return (
    <div className="flex min-w-0 border-t border-line" data-graph-canvas="delivery">
      <div className="w-36 shrink-0 border-r border-line sm:w-44">
        <div style={{ height: HEAD }} className="border-b border-line" />
        {graph.lanes.map((l) => (
          <div key={l.id} style={{ height: DROW }} className="flex flex-col justify-center border-b border-line px-3">
            <p className="truncate text-[13px] font-medium text-ink">{l.label}</p>
            <p className="truncate text-[12px] text-muted">
              {l.milestone!.total - l.milestone!.open} of {l.milestone!.total} approved
            </p>
          </div>
        ))}
      </div>
      <div ref={scroller} className="scrollbar-thin relative min-w-0 flex-1 overflow-x-auto">
        <div className="relative" style={{ width: totalW, height }}>
          <svg className="pointer-events-none absolute inset-0" width={totalW} height={height} aria-hidden="true">
            {ticks.map((t) => (
              <line key={t.day} x1={x(t.day)} x2={x(t.day)} y1={HEAD} y2={height} className="stroke-line" strokeWidth={1} />
            ))}
            {graph.deadline !== null && <line x1={x(graph.deadline)} x2={x(graph.deadline)} y1={0} y2={height} stroke="var(--danger)" strokeWidth={1.5} strokeDasharray="4 3" />}
            <line x1={x(graph.today)} x2={x(graph.today)} y1={0} y2={height} stroke="var(--ink)" strokeWidth={1.5} />
          </svg>
          <div className="absolute inset-x-0 top-0 border-b border-line text-[11px] text-muted" style={{ height: HEAD }} aria-hidden="true">
            {ticks
              // A date that would sit under the Today or Deadline tag is left out.
              .filter((t) => Math.abs(x(t.day) + 18 - x(graph.today)) > 44 && (graph.deadline === null || Math.abs(x(t.day) + 18 - x(graph.deadline)) > 50))
              .map((t) => (
                <span key={t.day} className="absolute top-2 pl-1 whitespace-nowrap" style={{ left: x(t.day) }}>
                  {t.label}
                </span>
              ))}
            <span className="absolute top-1 -translate-x-1/2 rounded bg-ink px-1.5 py-px text-[11px] font-medium text-canvas" style={{ left: x(graph.today) }}>
              Today
            </span>
            {graph.deadline !== null && (
              <span className="absolute top-1 -translate-x-1/2 rounded bg-danger-soft px-1.5 py-px text-[11px] font-medium text-danger" style={{ left: x(graph.deadline) }}>
                Deadline
              </span>
            )}
          </div>
          <ul aria-label="Milestones over time">
            {graph.lanes.map((l, i) => {
              const m = l.milestone!;
              const top = HEAD + i * DROW;
              const text = `${l.label}: ${m.total - m.open} of ${m.total} tasks approved${m.dueDay !== null ? `, due ${dayText(originMs, m.dueDay)}` : ''}${m.band ? `, likely all approved ${dateRange(originMs, m.band)}` : m.open === 0 ? ', done' : ''}.`;
              return (
                <li key={l.id} className="absolute inset-x-0" style={{ top, height: DROW }}>
                  <span className="sr-only">{text}</span>
                  {m.span && (
                    <span className="absolute rounded-[5px] border" style={{ left: x(m.span.start), width: Math.max(6, x(m.span.end) - x(m.span.start)), top: 13, height: 16, background: fill(m.open ? 'IN_PROGRESS' : 'DONE'), borderColor: edge(m.open ? 'IN_PROGRESS' : 'DONE') }} aria-hidden="true" />
                  )}
                  {m.band && (
                    <span className="absolute" style={{ left: x(m.band.p10), width: Math.max(4, x(m.band.p90) - x(m.band.p10)), top: 17, height: 8 }} aria-hidden="true">
                      <span className="absolute inset-0 rounded-full bg-accent/25 ring-1 ring-accent/50" />
                      <span className="absolute top-[-2px] h-3 w-0.5 rounded-full bg-accent" style={{ left: x(m.band.p50) - x(m.band.p10) }} />
                    </span>
                  )}
                  {m.dueDay !== null && <span className="absolute top-4 size-2.5 -translate-x-1/2 rotate-45 border border-ink-2 bg-surface" style={{ left: x(m.dueDay) }} aria-hidden="true" title={`Due ${dayText(originMs, m.dueDay)}`} />}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** A task key that links to the task in the app, or plain text on a public sample. */
function TaskRef({ projectId, id, children, sample, className }: { projectId: number; id: number; children: ReactNode; sample: boolean; className?: string }) {
  return sample ? (
    <span className={cn('font-medium text-ink', className)}>{children}</span>
  ) : (
    <Link to={`/projects/${projectId}/tasks/${id}`} className={cn('font-medium text-accent hover:underline', className)}>
      {children}
    </Link>
  );
}

function Detail({ graph, id, originMs, projectId, data, onClose, sample }: { graph: GraphData; id: number; originMs: number; projectId: number; data: DeliveryForecastData; onClose: () => void; sample: boolean }) {
  const it = graph.items.find((x) => x.id === id);
  if (!it) return null;
  const all = new Map((data.tasks ?? []).map((t) => [t.id, t]));
  const task = all.get(id);
  const refs = (ids: number[]) =>
    ids.length ? (
      <ul className="space-y-0.5">
        {ids.map((i) => {
          const t = all.get(i);
          if (!t) return null;
          return (
            <li key={i}>
              <TaskRef projectId={projectId} id={i} sample={sample}>
                {t.key}
              </TaskRef>{' '}
              <span className="text-ink-2">{t.title}</span> <span className="text-muted">({STATUS_LABEL[t.status].toLowerCase()}{t.assignee ? `, ${t.assignee.name}` : ''})</span>
            </li>
          );
        })}
      </ul>
    ) : (
      <span className="text-muted">Nothing</span>
    );
  const rows: [string, ReactNode][] = [
    ['Owner', it.owner ?? 'Nobody yet'],
    ['Status', `${STATUS_LABEL[it.status]}, ${PRIORITY_LABEL[it.priority].toLowerCase()} priority`],
    ['Due', task?.dueDate ? `${dayText(originMs, it.dueDay!, 'd MMM yyyy')}${task.overdue ? ' (overdue)' : ''}` : 'No due date'],
    ['Recorded', it.recorded ? `Started ${dayText(originMs, it.recorded.start)}${it.status === 'DONE' ? `, approved ${dayText(originMs, it.recorded.end)}` : ''}` : 'Not started'],
  ];
  if (it.planned) rows.push(['Planned', `${dayText(originMs, it.planned.start)} – ${dayText(originMs, it.planned.end)}, the forecast’s typical schedule${it.planned.assumed ? ' (no estimate: the typical one was used)' : ''}`]);
  if (it.band) rows.push(['Likely approved', `${dateRange(originMs, it.band)} (forecast range)`]);
  rows.push(['Waits on', refs(it.blockedBy)], ['Holds up', refs(it.blocks)]);
  return (
    <aside className="border-t border-line bg-surface-2/60 p-4 xl:border-t-0 xl:border-l" aria-label={`${it.key} details`} data-graph-detail="">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-muted">{it.key}</p>
          <p className="text-[15px] leading-snug font-semibold text-ink">{it.title}</p>
        </div>
        <button type="button" onClick={onClose} className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-ink" aria-label="Clear the selection">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <dl className="mt-3 space-y-2 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[96px_minmax(0,1fr)] gap-2">
            <dt className="text-muted">{k}</dt>
            <dd className="text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      {!sample && (
        <Link to={`/projects/${projectId}/tasks/${id}`} className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
          Open {it.key}
        </Link>
      )}
      <p className="mt-3 text-[12px] text-muted">Dates after today are planning estimates from the records, not commitments.</p>
    </aside>
  );
}

/** The same information as a plain, readable table. */
function GraphList({ graph, originMs, projectId, data, sample }: { graph: GraphData; originMs: number; projectId: number; data: DeliveryForecastData; sample: boolean }) {
  if (graph.lens === 'delivery') {
    return (
      <div className="overflow-x-auto border-t border-line" data-graph-list="">
        <table className="w-full min-w-[640px] text-[13px]">
          <caption className="sr-only">Milestones, their progress and when their work is likely approved</caption>
          <thead className="text-left text-[12px] text-muted">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Milestone</th>
              <th scope="col" className="px-3 py-2 font-medium">Approved</th>
              <th scope="col" className="px-3 py-2 font-medium">Due</th>
              <th scope="col" className="px-4 py-2 font-medium">Likely all approved</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {graph.lanes.map((l) => (
              <tr key={l.id}>
                <th scope="row" className="px-4 py-2 text-left font-medium text-ink">{l.label}</th>
                <td className="px-3 py-2 tabular">{l.milestone!.total - l.milestone!.open} of {l.milestone!.total}</td>
                <td className="px-3 py-2">{l.milestone!.dueDay !== null ? dayText(originMs, l.milestone!.dueDay) : '–'}</td>
                <td className="px-4 py-2">{l.milestone!.band ? dateRange(originMs, l.milestone!.band) : l.milestone!.open === 0 ? 'Done' : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const keyOf = new Map((data.tasks ?? []).map((t) => [t.id, t.key]));
  return (
    <div className="overflow-x-auto border-t border-line" data-graph-list="">
      <table className="w-full min-w-[860px] text-[13px]">
        <caption className="sr-only">Tasks, their owners, recorded and planned dates, and when they’re likely approved</caption>
        <thead className="text-left text-[12px] text-muted">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">Task</th>
            <th scope="col" className="px-3 py-2 font-medium">Owner</th>
            <th scope="col" className="px-3 py-2 font-medium">Status</th>
            <th scope="col" className="px-3 py-2 font-medium">Started</th>
            <th scope="col" className="px-3 py-2 font-medium">Planned finish</th>
            <th scope="col" className="px-3 py-2 font-medium">Likely approved</th>
            <th scope="col" className="px-4 py-2 font-medium">Waits on</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {[...graph.items]
            .sort((a, b) => a.row - b.row || (a.recorded?.start ?? a.planned?.start ?? 0) - (b.recorded?.start ?? b.planned?.start ?? 0))
            .map((it) => (
              <tr key={it.id} className={cn(it.muted && 'text-muted')}>
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  <TaskRef projectId={projectId} id={it.id} sample={sample}>
                    {it.key}
                  </TaskRef>{' '}
                  <span className="text-ink-2">{it.title}</span>
                </th>
                <td className="px-3 py-2">{it.owner ?? 'Nobody yet'}</td>
                <td className="px-3 py-2">{STATUS_LABEL[it.status]}</td>
                <td className="px-3 py-2">{it.recorded ? dayText(originMs, it.recorded.start) : '–'}</td>
                <td className="px-3 py-2">{it.status === 'DONE' && it.recorded ? `Approved ${dayText(originMs, it.recorded.end)}` : it.planned ? dayText(originMs, it.planned.end) : '–'}</td>
                <td className="px-3 py-2">{it.band ? dateRange(originMs, it.band) : '–'}</td>
                <td className="px-4 py-2">{it.blockedBy.map((b) => keyOf.get(b)).filter(Boolean).join(', ') || '–'}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
