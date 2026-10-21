import { Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import type { TaskStatus } from '@/api/types';
import { StatusDot } from '@/components/domain';
import { cn } from '@/lib/cn';
import { PRIORITY_LABEL, STATUS_LABEL } from '@/lib/constants';
import { blockStateAt, countsAt, dayToIso, statusAt, type ModelBlock, type ProjectModel } from '@/three/projectModel';
import { ProjectModelScene, type SceneInteraction, type SceneOptions, type ViewPreset } from '@/three/ProjectModelScene';
import { onThemeChange, prefersReducedMotion } from '@/three/capabilities';
import { HistoryForecastChart } from './HistoryForecastChart';

const VIEWS: { value: ViewPreset; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'plan', label: 'Plan' },
  { value: 'elevation', label: 'Elevation' },
  { value: 'today', label: 'Today' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function short(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Tasks in reading order: lane by lane, then by start. Used for keyboard navigation. */
function readingOrder(model: ProjectModel): ModelBlock[] {
  return [...model.blocks].sort((a, b) => a.lane - b.lane || a.row - b.row || (a.startedDay ?? a.createdDay) - (b.startedDay ?? b.createdDay));
}

function describe(model: ProjectModel, b: ModelBlock, day: number): string {
  const s = blockStateAt(b, day, model.todayDay, true);
  const parts = [`${b.key} ${b.title}`];
  parts.push(s.status ? STATUS_LABEL[s.status] : 'not created yet');
  if (s.overdue && b.dueDay !== null) parts.push(`overdue since ${short(dayToIso(model.originMs, b.dueDay + 1))}`);
  else if (b.dueDay !== null && s.status !== 'DONE') parts.push(`due ${short(dayToIso(model.originMs, b.dueDay))}`);
  parts.push(b.assigneeName ?? 'unassigned');
  if (b.blockedBy.length) parts.push(`waits on ${b.blockedBy.length} ${b.blockedBy.length === 1 ? 'task' : 'tasks'}`);
  if (s.ghost) parts.push(`estimated finish ${short(dayToIso(model.originMs, s.ghost.end - 1))}`);
  return parts.join(', ');
}

export interface ProjectModelViewProps {
  model: ProjectModel;
  /** The real project, for "Open task" links. Omit for the sample project on public pages. */
  projectId?: number;
  /** `exhibit` leaves wheel and touch scrolling to the page (public pages). */
  interaction?: SceneInteraction;
  /** Play the replay once from the beginning when the model first comes into view. */
  autoPlay?: boolean;
  /** The history-and-forecast chart above the scrubber. */
  chart?: boolean;
  className?: string;
}

/**
 * The interactive 3D model with its controls: view presets, estimate/dependency toggles, a replay
 * scrubber that runs from the first recorded day through today into the projection, hover
 * details, a selection panel, and full keyboard access (arrow keys move between tasks).
 */
export function ProjectModelView({ model, projectId, interaction = 'full', autoPlay = false, chart = true, className }: ProjectModelViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<ProjectModelScene | null>(null);
  const [day, setDay] = useState(model.todayDay);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<ViewPreset>('overview');
  const [options, setOptions] = useState<SceneOptions>({ showProjection: true, showLinks: false, hideDone: false });
  const [hover, setHover] = useState<{ id: number; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const byId = useMemo(() => new Map(model.blocks.map((b) => [b.id, b])), [model]);
  const order = useMemo(() => readingOrder(model), [model]);
  const end = Math.max(model.todayDay, options.showProjection && model.projectionEnd !== null ? model.projectionEnd : model.todayDay);
  const start = Math.max(0, Math.min(...model.blocks.map((b) => b.createdDay), model.todayDay) - 1);

  // Create the scene once; feed it the model whenever it changes (e.g. live updates).
  useEffect(() => {
    if (!host.current) return;
    const s = new ProjectModelScene(
      host.current,
      {
        onHover: (id, x, y) => setHover(id === null ? null : { id, x, y }),
        onSelect: (id) => setSelected(id),
      },
      interaction,
    );
    scene.current = s;
    const stop = onThemeChange(() => s.refreshTheme());
    return () => {
      stop();
      s.dispose();
      scene.current = null;
    };
    // The interaction mode is fixed for the lifetime of the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const firstModel = useRef(true);
  useEffect(() => {
    scene.current?.setModel(model, !firstModel.current);
    firstModel.current = false;
  }, [model]);

  useEffect(() => scene.current?.setTime(day), [day, model]);
  useEffect(() => scene.current?.setOptions(options), [options, model]);
  useEffect(() => scene.current?.setSelected(selected), [selected, model]);

  // Replay: run from the current position (or the beginning) to the end in about 14 seconds.
  const dayRef = useRef(day);
  dayRef.current = day;
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const rate = (end - start) / 14_000;
    const tick = (now: number) => {
      const next = Math.min(end, dayRef.current + (now - last) * rate);
      last = now;
      dayRef.current = next;
      setDay(next);
      if (next >= end) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, start, end]);

  // Autoplay: once, from the beginning, the first time at least a third of the view is visible.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!autoPlay || prefersReducedMotion() || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        setDay(start);
        setPlaying(true);
      },
      { threshold: 0.33 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [autoPlay, start]);

  const togglePlay = () => {
    if (!playing && day >= end - 0.05) setDay(start);
    setPlaying((p) => !p);
  };

  const chooseView = (v: ViewPreset) => {
    setView(v);
    scene.current?.view(v, !prefersReducedMotion());
  };

  const moveFocus = useCallback(
    (id: number | null) => {
      setFocused(id);
      scene.current?.focus(id, id !== null);
      const b = id === null ? undefined : byId.get(id);
      setAnnouncement(b ? describe(model, b, day) : '');
    },
    [byId, model, day],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = focused === null ? undefined : byId.get(focused);
    const sameLane = (b: ModelBlock) => current !== undefined && b.lane === current.lane;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowLeft': {
        e.preventDefault();
        if (!current) return moveFocus(order[0]?.id ?? null);
        const lane = order.filter(sameLane);
        const i = lane.indexOf(current) + (e.key === 'ArrowRight' ? 1 : -1);
        if (lane[i]) moveFocus(lane[i].id);
        return;
      }
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        if (!current) return moveFocus(order[0]?.id ?? null);
        const laneIndex = current.lane + (e.key === 'ArrowDown' ? 1 : -1);
        const candidates = model.blocks.filter((b) => b.lane === laneIndex);
        if (!candidates.length) return;
        const t = current.startedDay ?? current.createdDay;
        const nearest = candidates.reduce((best, b) =>
          Math.abs((b.startedDay ?? b.createdDay) - t) < Math.abs((best.startedDay ?? best.createdDay) - t) ? b : best,
        );
        moveFocus(nearest.id);
        return;
      }
      case 'Home':
        e.preventDefault();
        moveFocus(order[0]?.id ?? null);
        return;
      case 'End':
        e.preventDefault();
        moveFocus(order[order.length - 1]?.id ?? null);
        return;
      case 'Enter':
      case ' ':
        if (focused !== null) {
          e.preventDefault();
          setSelected(focused);
        }
        return;
      case 'Escape':
        setSelected(null);
        moveFocus(null);
        return;
      case 'p':
      case 'P':
        togglePlay();
        return;
      default:
    }
  };

  const counts = countsAt(model, day);
  // Anything after now is an estimate (the counts switch to the projection there too).
  const mode = day > model.todayDay + 1e-6 ? 'ESTIMATE' : day < model.todayDay - 0.25 ? 'RECORDED' : 'TODAY';
  const iso = dayToIso(model.originMs, day);
  const pct = (d: number) => `${(((d - start) / Math.max(1, end - start)) * 100).toFixed(2)}%`;
  const hovered = hover ? byId.get(hover.id) : undefined;
  const selectedBlock = selected !== null ? byId.get(selected) : undefined;

  return (
    <div ref={root} className={cn('relative flex flex-col overflow-hidden rounded-xl border border-line bg-canvas shadow-card', className)}>
      {/* Readout ------------------------------------------------------------------ */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line bg-surface px-5 py-4">
        <div className="flex items-end gap-5">
          <p className="reading text-[40px] text-ink" aria-hidden="true">
            {short(iso)}
          </p>
          <div className="pb-1">
            <p className={cn('caps', mode === 'ESTIMATE' ? 'text-accent' : mode === 'TODAY' ? 'text-ink' : 'text-muted')}>{mode === 'ESTIMATE' ? 'Estimate' : mode === 'TODAY' ? 'Today' : 'Recorded'}</p>
            <p className="mt-1 flex flex-wrap gap-x-3 text-[12.5px] text-muted tabular">
              {(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as TaskStatus[]).map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <StatusDot status={s} className="size-[7px]" />
                  {STATUS_LABEL[s]} <span className="font-medium text-ink-2">{counts[s]}</span>
                </span>
              ))}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div role="radiogroup" aria-label="Camera" className="flex gap-4">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                type="button"
                role="radio"
                aria-checked={view === v.value}
                onClick={() => chooseView(v.value)}
                className={cn('caps border-b py-1', view === v.value ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink')}
              >
                {v.label}
              </button>
            ))}
          </div>
          <span className="hidden h-4 w-px bg-line-strong sm:block" aria-hidden="true" />
          {(
            [
              ['showProjection', 'Estimates'],
              ['showLinks', 'All dependencies'],
              ['hideDone', 'Hide done'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="caps flex min-h-6 cursor-pointer items-center gap-2 py-1 text-muted">
              <input
                type="checkbox"
                className="size-3.5 accent-[var(--accent)]"
                checked={options[key]}
                onChange={(e) => setOptions((o) => ({ ...o, [key]: e.target.checked }))}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* Canvas ---------------------------------------------------------------------- */}
      <div className="relative min-h-[420px] flex-1">
        <div
          ref={host}
          tabIndex={0}
          role="application"
          aria-roledescription="3D project model"
          aria-label={
            interaction === 'exhibit'
              ? 'Sample project model. Drag to turn it. Arrow keys move between tasks, Enter shows details, P plays the replay.'
              : 'Project model. Drag to orbit, scroll to zoom, right-drag to pan. Arrow keys move between tasks, Enter shows details, P plays the replay.'
          }
          onKeyDown={onKeyDown}
          onFocus={(e) => {
            // Keyboard users land on the first task; a mouse click shouldn't move the camera.
            if (focused === null && order[0] && e.currentTarget.matches(':focus-visible')) moveFocus(order[0].id);
          }}
          className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
        />
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>

        {hovered && hover && (
          <div
            className="pointer-events-none fixed z-50 max-w-72 border border-line bg-surface px-3 py-2 shadow-pop"
            style={{ left: hover.x + 14, top: hover.y + 14 }}
          >
            <p className="font-mono text-[12px] text-muted">{hovered.key}</p>
            <p className="text-[13px] font-medium text-ink">{hovered.title}</p>
            <p className="mt-1 text-xs text-muted">{describe(model, hovered, day).split(', ').slice(1).join(', ')}</p>
            {day > model.todayDay && hovered.projected && <p className="caps mt-1 text-accent">Estimate</p>}
          </div>
        )}

        {selectedBlock && (
          <SelectionPanel model={model} block={selectedBlock} day={day} projectId={projectId} byId={byId} onClose={() => setSelected(null)} onPick={setSelected} />
        )}

        <Legend />
      </div>

      {/* Replay: the history-and-forecast chart sits directly above the scrubber, on the same time axis. */}
      <div className="flex items-end gap-4 border-t border-line bg-surface px-5 pt-3 pb-3">
        <button
          type="button"
          onClick={togglePlay}
          className="mb-1 flex size-10 shrink-0 items-center justify-center border border-line-strong text-ink hover:border-ink"
          aria-label={playing ? 'Pause replay' : 'Play replay'}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
        <div className="min-w-0 flex-1">
          {chart && (
            <HistoryForecastChart
              model={model}
              start={start}
              end={end}
              day={day}
              onScrub={(d) => {
                setPlaying(false);
                setDay(d);
              }}
              className="mb-1"
            />
          )}
          <div className="relative py-2">
            <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line-strong" aria-hidden="true" />
            {end > model.todayDay && (
              <div
                className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 bg-accent/25"
                style={{ left: pct(model.todayDay), right: 0 }}
                aria-hidden="true"
              />
            )}
            <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-accent" style={{ left: pct(model.todayDay) }} aria-hidden="true" />
            <input
              type="range"
              min={start}
              max={end}
              step={0.05}
              value={Math.min(end, Math.max(start, day))}
              onChange={(e) => {
                setPlaying(false);
                setDay(Number(e.target.value));
              }}
              aria-label="Replay time"
              aria-valuetext={`${short(iso)}, ${mode === 'ESTIMATE' ? 'estimated' : mode === 'TODAY' ? 'today' : 'recorded'}`}
              className="model-scrubber relative w-full"
            />
          </div>
        </div>
        <button type="button" onClick={() => setDay(model.todayDay)} className="caps mb-3 shrink-0 text-muted hover:text-ink">
          Today
        </button>
      </div>
    </div>
  );
}

function SelectionPanel({
  model,
  block,
  day,
  projectId,
  byId,
  onClose,
  onPick,
}: {
  model: ProjectModel;
  block: ModelBlock;
  day: number;
  projectId?: number;
  byId: Map<number, ModelBlock>;
  onClose: () => void;
  onPick: (id: number) => void;
}) {
  const s = blockStateAt(block, day, model.todayDay, true);
  const unblocks = model.links.filter((l) => l.blockerId === block.id).map((l) => byId.get(l.blockedId)).filter((b): b is ModelBlock => !!b);
  const waits = block.blockedBy.map((id) => byId.get(id)).filter((b): b is ModelBlock => !!b);
  const date = (d: number | null) => (d === null ? '—' : short(dayToIso(model.originMs, d)));
  const row = (label: string, value: string) => (
    <div className="grid grid-cols-[96px_1fr] gap-2 py-1.5">
      <dt className="caps text-muted">{label}</dt>
      <dd className="text-[13px] text-ink">{value}</dd>
    </div>
  );
  return (
    <aside className="absolute top-4 right-4 bottom-4 z-10 flex w-80 max-w-[calc(100%-2rem)] flex-col border border-line bg-surface shadow-pop" aria-label={`${block.key} details`}>
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="font-mono text-[12px] text-muted">{block.key}</p>
          <p className="text-[15px] leading-snug font-medium text-ink">{block.title}</p>
        </div>
        <button type="button" onClick={onClose} className="caps shrink-0 text-muted hover:text-ink" aria-label="Close details">
          Close
        </button>
      </div>
      <dl className="scrollbar-thin flex-1 divide-y divide-line overflow-y-auto px-4 py-2">
        {row('Status', s.status ? STATUS_LABEL[s.status] + (s.overdue ? ', late' : '') : 'Not created yet')}
        {row('Owner', block.assigneeName ?? 'Unassigned')}
        {row('Priority', PRIORITY_LABEL[block.priority])}
        {row('Created', date(block.createdDay))}
        {row('Started', date(block.startedDay))}
        {row('Approved', date(block.doneDay))}
        {row('Due', date(block.dueDay))}
        {block.projected && statusAt(block, model.todayDay) !== 'DONE' && row('Finish', `${date(block.projected.end - 1)} (estimate)`)}
        {row('Evidence', block.submissionCount === 0 ? 'No submissions yet' : `${block.submissionCount} ${block.submissionCount === 1 ? 'submission' : 'submissions'}`)}
        <div className="py-2">
          <dt className="caps text-muted">Waits on</dt>
          <dd className="mt-1 space-y-1">
            {waits.length === 0 ? (
              <span className="text-[13px] text-muted">Nothing</span>
            ) : (
              waits.map((b) => (
                <button key={b.id} type="button" onClick={() => onPick(b.id)} className="block text-left text-[13px] text-ink hover:text-accent">
                  <span className="font-mono text-[12px] text-muted">{b.key}</span> {b.title}
                </button>
              ))
            )}
          </dd>
        </div>
        <div className="py-2">
          <dt className="caps text-muted">Unblocks</dt>
          <dd className="mt-1 space-y-1">
            {unblocks.length === 0 ? (
              <span className="text-[13px] text-muted">Nothing</span>
            ) : (
              unblocks.map((b) => (
                <button key={b.id} type="button" onClick={() => onPick(b.id)} className="block text-left text-[13px] text-ink hover:text-accent">
                  <span className="font-mono text-[12px] text-muted">{b.key}</span> {b.title}
                </button>
              ))
            )}
          </dd>
        </div>
      </dl>
      {projectId !== undefined && (
      <div className="flex gap-2 border-t border-line px-4 py-3">
        <Link to={`/projects/${projectId}/tasks/${block.id}`} className="caps flex h-9 flex-1 items-center justify-center bg-brand text-white dark:text-canvas">
          Open task
        </Link>
        {block.submissionCount > 0 && (
          <Link to={`/projects/${projectId}/tasks/${block.id}/review`} className="caps flex h-9 flex-1 items-center justify-center border border-line-strong text-ink hover:border-ink">
            Evidence
          </Link>
        )}
      </div>
      )}
    </aside>
  );
}

function Legend() {
  const item = (swatch: string, label: string) => (
    <span className="flex items-center gap-2">
      <span className={cn('inline-block', swatch)} aria-hidden="true" />
      {label}
    </span>
  );
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-4 gap-y-1.5 border border-line bg-surface/90 px-3 py-2 text-[12px] text-muted">
      {item('h-2.5 w-4 bg-[var(--model-todo)]', 'Not started')}
      {item('h-2.5 w-4 bg-[var(--model-progress)]', 'In progress')}
      {item('h-2.5 w-4 bg-[var(--model-review)]', 'In review')}
      {item('h-2.5 w-4 bg-[var(--model-done)]', 'Approved')}
      {item('h-2.5 w-4 border border-ink-2', 'Estimate')}
      {item('h-1 w-4 bg-danger', 'Overdue')}
      {item('h-2.5 w-px bg-accent', 'Today')}
    </div>
  );
}
