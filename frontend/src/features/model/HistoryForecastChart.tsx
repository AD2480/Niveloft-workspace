import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { cn } from '@/lib/cn';
import { historySeries, shortDate, type SeriesPoint } from '@/lib/projectAnalysis';
import { dayToIso, type ProjectModel } from '@/three/projectModel';

export interface HistoryForecastChartProps {
  model: ProjectModel;
  /** Day range, identical to the replay scrubber's so the two line up. */
  start: number;
  end: number;
  /** Replay time, drawn as the cursor. */
  day: number;
  /** Clicking or dragging on the chart moves the replay there. */
  onScrub?: (day: number) => void;
  /** Horizontal inset in px (half the scrubber thumb), so x positions match the scrubber's. */
  inset?: number;
  height?: number;
  /** The "History and forecast" label before the legend (off when a card header already says it). */
  showTitle?: boolean;
  className?: string;
}

/** Two rows of reference labels (Today, Deadline, Finish) sit above the plot, never on the lines. */
const LABEL_ROW = 11;
const PAD_TOP = 8 + LABEL_ROW * 2;
/** Room below the baseline for the replay cursor's handle. */
const PAD_BOTTOM = 10;
const CHAR_W = 5.4;

interface Marker {
  x: number;
  text: string;
  color: string;
  anchor: 'start' | 'end';
}

/** Places reference labels in up to two rows so they never overlap each other. */
function layoutMarkers(markers: Marker[], width: number): (Marker & { row: number; tx: number })[] {
  const rowsEnd: number[] = [-Infinity, -Infinity];
  return [...markers]
    .sort((a, b) => a.x - b.x)
    .map((m) => {
      const w = m.text.length * CHAR_W;
      // Flip the anchor when the label would run off either edge.
      let anchor = m.anchor;
      if (anchor === 'start' && m.x + 3 + w > width) anchor = 'end';
      if (anchor === 'end' && m.x - 3 - w < 0) anchor = 'start';
      const x0 = anchor === 'start' ? m.x + 3 : m.x - 3 - w;
      const x1 = x0 + w;
      let row = rowsEnd.findIndex((end) => end < x0 - 6);
      if (row === -1) row = 1;
      rowsEnd[row] = x1;
      return { ...m, anchor, row, tx: anchor === 'start' ? m.x + 3 : m.x - 3 };
    });
}

function niceStep(max: number): number {
  const target = max / 3;
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]) if (s >= target) return s;
  return Math.ceil(target / 1000) * 1000;
}

/**
 * Burn-up of the project: all tasks that existed (scope) and approved tasks, day by day. Up to
 * today both come from the record; beyond it the approved line follows the scheduler's
 * projection and is drawn dashed as an estimate. The cursor is the replay time.
 */
export function HistoryForecastChart({ model, start, end, day, onScrub, inset = 6, height = 156, showTitle = true, className }: HistoryForecastChartProps) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const series = useMemo(() => historySeries(model, start, end), [model, start, end]);
  const scopeMax = Math.max(1, ...series.map((p) => p.scope));
  const step = niceStep(scopeMax);
  const yMax = Math.ceil(scopeMax / step) * step;
  const plotW = Math.max(1, width - inset * 2);
  const plotH = height - PAD_TOP - PAD_BOTTOM;
  const x = (d: number) => inset + ((d - start) / Math.max(0.001, end - start)) * plotW;
  const y = (v: number) => PAD_TOP + (1 - v / yMax) * plotH;
  const dayAt = (px: number) => Math.min(end, Math.max(start, start + ((px - inset) / plotW) * (end - start)));

  const recorded = series.filter((p) => !p.estimate);
  const estimated = [recorded[recorded.length - 1], ...series.filter((p) => p.estimate)].filter(Boolean) as SeriesPoint[];
  const line = (pts: SeriesPoint[], v: (p: SeriesPoint) => number) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(v(p)).toFixed(1)}`).join('');
  const area = (pts: SeriesPoint[], v: (p: SeriesPoint) => number) =>
    pts.length ? `${line(pts, v)}L${x(pts[pts.length - 1].day).toFixed(1)},${y(0)}L${x(pts[0].day).toFixed(1)},${y(0)}Z` : '';
  const approved = (p: SeriesPoint) => p.counts.DONE;
  const scope = (p: SeriesPoint) => p.scope;

  const ticks: number[] = [];
  for (let v = step; v <= yMax; v += step) ticks.push(v);

  const today = model.todayDay;
  const deadline = model.deadlineDay;
  const finish = model.projectionEnd !== null && model.projectionEnd - 1 >= today && model.projectionEnd <= end + 0.01 ? model.projectionEnd : null;
  const finishPoint = finish !== null ? series.find((p) => p.day >= finish) ?? series[series.length - 1] : null;

  const markers = width
    ? layoutMarkers(
        [
          { x: x(today), text: 'Today', color: 'var(--accent)', anchor: 'start' as const },
          ...(deadline !== null && deadline >= start && deadline <= end
            ? [{ x: x(deadline), text: `Deadline ${shortDate(dayToIso(model.originMs, deadline))}`, color: 'var(--danger)', anchor: 'end' as const }]
            : []),
          ...(finish !== null ? [{ x: x(finish), text: `Plan ${shortDate(dayToIso(model.originMs, finish - 1))} (if estimates hold)`, color: 'var(--ink-2)', anchor: 'end' as const }] : []),
        ],
        width,
      )
    : [];

  const nearest = (d: number) => series.reduce((best, p) => (Math.abs(p.day - d) < Math.abs(best.day - d) ? p : best), series[0]);
  const hovered = hoverX !== null ? nearest(dayAt(hoverX)) : null;
  const last = series[series.length - 1];
  const nowPoint = nearest(today);

  const summary =
    `History and forecast. By today ${nowPoint.counts.DONE} of ${nowPoint.scope} tasks are approved` +
    (finish !== null ? `; the estimate reaches ${last.counts.DONE} by ${shortDate(dayToIso(model.originMs, finish - 1))}` : '') +
    (deadline !== null ? `; the deadline is ${shortDate(dayToIso(model.originMs, deadline))}.` : '.');

  const localX = (e: PointerEvent<SVGSVGElement>) => e.clientX - e.currentTarget.getBoundingClientRect().left;
  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!onScrub) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onScrub(dayAt(localX(e)));
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const px = localX(e);
    setHoverX(px);
    if (dragging.current && onScrub) onScrub(dayAt(px));
  };
  const onUp = () => {
    dragging.current = false;
  };

  // Weekly snapshots for the table view (plus today and the estimated finish).
  const rows = useMemo(() => {
    const picks: SeriesPoint[] = [];
    for (let d = Math.ceil(start); d <= end; d += 7) picks.push(nearest(d));
    picks.push(nearest(today));
    if (finish !== null) picks.push(nearest(finish));
    return [...new Map(picks.sort((a, b) => a.day - b.day).map((p) => [dayToIso(model.originMs, p.day), p])).entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, start, end, today, finish]);

  return (
    <div className={cn('relative', className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted" style={{ paddingLeft: inset }}>
        {showTitle && <span className="text-[12px] font-medium text-ink">History and forecast</span>}
        <LegendKey color="var(--ink-2)" label="All tasks" />
        <LegendKey color="var(--model-done)" label="Approved" />
        <LegendKey color="var(--muted)" label="Estimate" dashed />
      </div>

      <div ref={box} className="relative" style={{ height }}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={summary}
            className={cn('block touch-pan-y select-none', onScrub && 'cursor-ew-resize')}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerLeave={() => setHoverX(null)}
          >
            {/* Grid */}
            <line x1={inset} x2={width - inset} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" strokeWidth="1" />
            {ticks.map((t) => (
              <g key={t}>
                <line x1={inset} x2={width - inset} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
                <text x={inset + 2} y={y(t) - 3} fontSize="9.5" fill="var(--subtle)" className="tabular">
                  {t}
                </text>
              </g>
            ))}

            {/* Estimate region */}
            {today < end && <rect x={x(today)} y={PAD_TOP} width={Math.max(0, x(end) - x(today))} height={plotH} fill="var(--surface-2)" opacity="0.7" />}

            {/* Approved: wash + line, recorded solid, estimate dashed */}
            <path d={area(recorded, approved)} fill="var(--model-done)" opacity="0.12" />
            <path d={area(estimated, approved)} fill="var(--model-done)" opacity="0.06" />
            <path d={line(recorded, scope)} fill="none" stroke="var(--ink-2)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            <path d={line(estimated, scope)} fill="none" stroke="var(--ink-2)" strokeWidth="1.5" strokeDasharray="4 3" />
            <path d={line(recorded, approved)} fill="none" stroke="var(--model-done)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            <path d={line(estimated, approved)} fill="none" stroke="var(--model-done)" strokeWidth="2" strokeDasharray="4 3" />

            {/* Reference rules, labelled above the plot */}
            {markers.map((m) => (
              <g key={m.text}>
                <line x1={m.x} x2={m.x} y1={9 + m.row * LABEL_ROW + 2} y2={y(0)} stroke={m.color} strokeWidth="1" strokeDasharray={m.text.startsWith('Plan') ? '2 2' : undefined} />
                <text x={m.tx} y={9 + m.row * LABEL_ROW} fontSize="9.5" textAnchor={m.anchor} fill={m.color}>
                  {m.text}
                </text>
              </g>
            ))}
            {finishPoint && finish !== null && (
              <circle cx={x(finishPoint.day)} cy={y(approved(finishPoint))} r="4" fill="var(--model-done)" stroke="var(--surface)" strokeWidth="2" />
            )}

            {/* Replay cursor, with its handle below the baseline (only where the graph drives a replay) */}
            {onScrub && (
              <>
                <line x1={x(day)} x2={x(day)} y1={PAD_TOP} y2={y(0) + 2} stroke="var(--ink)" strokeWidth="1.5" />
                <rect x={x(day) - 3} y={y(0) + 2} width="6" height="6" fill="var(--ink)" />
              </>
            )}

            {/* Hover crosshair */}
            {hovered && <line x1={x(hovered.day)} x2={x(hovered.day)} y1={PAD_TOP} y2={y(0)} stroke="var(--muted)" strokeWidth="1" />}
          </svg>
        )}
        {hovered && hoverX !== null && (
        <div
          className="pointer-events-none absolute top-0 z-20 min-w-40 -translate-y-full border border-line bg-surface px-3 py-2 shadow-pop"
          style={{ left: Math.min(Math.max(0, hoverX + 12), Math.max(0, width - 176)) }}
        >
          <p className="flex items-baseline justify-between gap-3">
            <span className="text-[12px] font-medium text-ink">{shortDate(dayToIso(model.originMs, hovered.day))}</span>
            <span className={cn('text-[11.5px] font-medium', hovered.estimate ? 'text-accent' : 'text-muted')}>{hovered.estimate ? 'Estimate' : 'Recorded'}</span>
          </p>
          <dl className="mt-1.5 space-y-0.5 text-[12px]">
            <Row color="var(--model-done)" label="Approved" value={hovered.counts.DONE} strong />
            <Row label="In review" value={hovered.counts.IN_REVIEW} />
            <Row label="In progress" value={hovered.counts.IN_PROGRESS} />
            <Row label="Not started" value={hovered.counts.TODO} />
            <Row color="var(--ink-2)" label="All tasks" value={hovered.scope} />
          </dl>
        </div>
        )}
      </div>

      <details className="mt-1 text-[12px] text-muted" style={{ paddingLeft: inset }}>
        <summary className="caps min-h-6 cursor-pointer py-1 text-[11px] hover:text-ink">Show the numbers</summary>
        <div className="scrollbar-thin mt-2 max-h-48 overflow-auto">
          <table className="w-full min-w-[420px] text-left tabular">
            <thead>
              <tr className="text-muted">
                <th className="py-1 pr-3 font-medium">Date</th>
                <th className="py-1 pr-3 font-medium">Source</th>
                <th className="py-1 pr-3 text-right font-medium">Approved</th>
                <th className="py-1 pr-3 text-right font-medium">In review</th>
                <th className="py-1 pr-3 text-right font-medium">In progress</th>
                <th className="py-1 pr-3 text-right font-medium">Not started</th>
                <th className="py-1 text-right font-medium">All tasks</th>
              </tr>
            </thead>
            <tbody className="text-ink-2">
              {rows.map(([iso, p]) => (
                <tr key={iso} className="border-t border-line">
                  <td className="py-1 pr-3">{shortDate(iso)}</td>
                  <td className="py-1 pr-3">{p.estimate ? 'Estimate' : 'Recorded'}</td>
                  <td className="py-1 pr-3 text-right">{p.counts.DONE}</td>
                  <td className="py-1 pr-3 text-right">{p.counts.IN_REVIEW}</td>
                  <td className="py-1 pr-3 text-right">{p.counts.IN_PROGRESS}</td>
                  <td className="py-1 pr-3 text-right">{p.counts.TODO}</td>
                  <td className="py-1 text-right">{p.scope}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function LegendKey({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="16" height="6" aria-hidden="true">
        <line x1="0" x2="16" y1="3" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dashed ? '4 3' : undefined} />
      </svg>
      {label}
    </span>
  );
}

function Row({ label, value, color, strong = false }: { label: string; value: number; color?: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="flex items-center gap-1.5 text-muted">
        {color ? (
          <svg width="10" height="4" aria-hidden="true">
            <line x1="0" x2="10" y1="2" y2="2" stroke={color} strokeWidth="2" />
          </svg>
        ) : (
          <span className="inline-block w-2.5" aria-hidden="true" />
        )}
        {label}
      </dt>
      <dd className={cn('tabular', strong ? 'font-semibold text-ink' : 'text-ink-2')}>{value}</dd>
    </div>
  );
}
