/**
 * Niveloft's charts, drawn by hand in SVG and HTML so they share the snowpack's colours, type and
 * spacing: thin marks, a 2px surface gap between touching marks, hairline grids, values at the
 * tips of bars, and a crosshair that finds the nearest day or week with one readout for every
 * series. Every chart sits in a ChartCard, which also offers the numbers as a table.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { cn } from '@/lib/cn';

export interface ChartSeries {
  key: string;
  name: string;
  /** A CSS colour (a token, e.g. var(--strata-done)). */
  color: string;
}

/** Width of an element, kept up to date. */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Clean integer ticks from 0 to at least `max` (0, 2, 4…; 0, 5, 10…), at most `count` + 1 of them. */
export function niceTicks(max: number, count = 4): number[] {
  const top = Math.max(1, max);
  const raw = top / count;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow);
  const ticks: number[] = [];
  for (let v = 0; v <= top + step * 0.001; v += step) ticks.push(Math.round(v));
  if (ticks[ticks.length - 1] < top) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

// --------------------------------------------------------------------------- legend & tooltip

/** A legend: a short line or a small square per series, in reading order. */
export function ChartLegend({ series, mark = 'square', className }: { series: ChartSeries[]; mark?: 'square' | 'line'; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-2', className)} data-chart-legend="">
      {series.map((s) => (
        <li key={s.key} className="inline-flex items-center gap-1.5">
          {mark === 'line' ? (
            <span className="h-[2px] w-3.5 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
          ) : (
            <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: s.color }} aria-hidden="true" />
          )}
          {s.name}
        </li>
      ))}
    </ul>
  );
}

/** The readout: the values lead, the series names follow, each keyed by a short line in its colour. */
function Readout({ title, rows, x, width, footer }: { title: string; rows: { key: string; name: string; color: string; value: number }[]; x: number; width: number; footer?: ReactNode }) {
  const W = 184;
  const left = Math.min(Math.max(8, x + 14), Math.max(8, width - W - 8));
  const flip = x + 14 + W > width - 8 && x - W - 14 > 0;
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 rounded-lg border border-line bg-surface px-3 py-2 shadow-pop dark:bg-surface-2"
      style={{ left: flip ? x - W - 14 : left, width: W }}
      role="status"
      aria-live="polite"
      data-chart-readout=""
    >
      <p className="text-[12px] font-medium text-muted">{title}</p>
      <ul className="mt-1 space-y-0.5">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2 text-[12.5px]">
            <span className="h-[2px] w-3 shrink-0 rounded-full" style={{ backgroundColor: r.color }} aria-hidden="true" />
            <span className="font-semibold text-ink tabular">{r.value}</span>
            <span className="truncate text-muted">{r.name}</span>
          </li>
        ))}
      </ul>
      {footer && <p className="mt-1.5 border-t border-line pt-1.5 text-[12px] text-muted">{footer}</p>}
    </div>
  );
}

// --------------------------------------------------------------------------- horizontal bars

export interface BarRow {
  key: string;
  label: string;
  value: number;
  color: string;
}

/**
 * Horizontal bars from one baseline: the label, the bar (at most 16px thick, rounded at its end,
 * square at the baseline) and its value at the tip. Rows are links to nothing; the value is always
 * visible, so there is no tooltip to hunt for.
 */
export function BarList({ rows, labelWidth = 96, unit }: { rows: BarRow[]; labelWidth?: number; unit?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5" data-bar-list="">
      {rows.map((r) => (
        <li key={r.key} className="grid items-center gap-3" style={{ gridTemplateColumns: `${labelWidth}px minmax(0,1fr)` }} title={`${r.label}: ${unit ? unit(r.value) : r.value}`}>
          <span className="truncate text-[13px] text-ink-2">{r.label}</span>
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="block h-4 rounded-r-[4px] transition-[width] duration-500 ease-out"
              style={{ width: r.value ? `max(4px, ${((r.value / max) * 88).toFixed(2)}%)` : 0, backgroundColor: r.color }}
              aria-hidden="true"
            />
            <span className="text-[13px] font-semibold text-ink tabular">{unit ? unit(r.value) : r.value}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface StackedRow {
  key: string;
  label: string;
  /** Full name, for the tooltip. */
  title?: string;
  values: Record<string, number>;
  /** A small note at the end of the row (e.g. "2 late"). */
  note?: ReactNode;
}

/**
 * Stacked horizontal bars, one per row, segments separated by a 2px surface gap and rounded only
 * at the bar's end. Each segment shows its value on hover and focus; the total sits at the tip.
 */
export function StackedBarList({ rows, series, labelWidth = 84 }: { rows: StackedRow[]; series: ChartSeries[]; labelWidth?: number }) {
  const totals = rows.map((r) => series.reduce((n, s) => n + (r.values[s.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const [hover, setHover] = useState<{ row: string; key: string } | null>(null);
  return (
    <div>
      <ChartLegend series={series} className="mb-4" />
      <ul className="space-y-3" data-stacked-bar-list="">
        {rows.map((r, i) => (
          <li key={r.key} className="grid items-center gap-3" style={{ gridTemplateColumns: `${labelWidth}px minmax(0,1fr)` }}>
            <span className="truncate text-[13px] text-ink-2" title={r.title ?? r.label}>
              {r.label}
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex h-4 gap-[2px]" style={{ width: totals[i] ? `max(6px, ${((totals[i] / max) * 84).toFixed(2)}%)` : 0 }}>
                {series.map((s) => {
                  const v = r.values[s.key] ?? 0;
                  if (!v) return null;
                  const on = hover?.row === r.key && hover.key === s.key;
                  return (
                    <span
                      key={s.key}
                      tabIndex={0}
                      onPointerEnter={() => setHover({ row: r.key, key: s.key })}
                      onPointerLeave={() => setHover(null)}
                      onFocus={() => setHover({ row: r.key, key: s.key })}
                      onBlur={() => setHover(null)}
                      className={cn('relative block h-full outline-none last:rounded-r-[4px] focus-visible:ring-2 focus-visible:ring-[var(--ring)]', on && 'brightness-110')}
                      style={{ flexGrow: v, flexBasis: 0, minWidth: 3, backgroundColor: s.color }}
                      aria-label={`${r.title ?? r.label}: ${v} ${s.name.toLowerCase()}`}
                    >
                      {on && (
                        <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 rounded-md border border-line bg-surface px-2 py-1 text-[12px] whitespace-nowrap text-ink shadow-pop dark:bg-surface-2">
                          <span className="font-semibold tabular">{v}</span> <span className="text-muted">{s.name.toLowerCase()}</span>
                        </span>
                      )}
                    </span>
                  );
                })}
              </span>
              <span className="text-[13px] font-semibold text-ink tabular">{totals[i]}</span>
              {r.note}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --------------------------------------------------------------------------- over time

interface TimeChartProps {
  /** One label per position (a day or a week), oldest first. */
  labels: string[];
  /** The readout's title for a position ("Week of 21 Sep"). */
  title?: (i: number) => string;
  series: (ChartSeries & { values: number[] })[];
  height?: number;
  /** Show every nth label on the axis (always the first and last). */
  every?: number;
  /** 'lines' plots each series; 'stack' piles them up as layers, first series at the bottom. */
  kind: 'lines' | 'stack';
  /** A summary for screen readers. */
  label: string;
}

const PAD = { top: 12, right: 12, bottom: 26, left: 32 };

/**
 * Lines or stacked layers over time, with hairline gridlines at clean ticks, a crosshair that snaps
 * to the nearest position, and one readout for all series. Arrow keys move the crosshair.
 */
export function TimeChart({ labels, title, series, height = 240, every, kind, label }: TimeChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [at, setAt] = useState<number | null>(null);
  const n = labels.length;
  const stacks = useMemo(() => {
    if (kind !== 'stack') return null;
    const base = Array.from({ length: n }, () => 0);
    return series.map((s) => {
      const lo = base.slice();
      for (let i = 0; i < n; i++) base[i] += s.values[i] ?? 0;
      return { lo, hi: base.slice() };
    });
  }, [kind, series, n]);
  const max = kind === 'stack' ? Math.max(1, ...(stacks?.[stacks.length - 1]?.hi ?? [1])) : Math.max(1, ...series.flatMap((s) => s.values));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const w = Math.max(10, width - PAD.left - PAD.right);
  const h = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => PAD.top + h - (v / top) * h;
  const step = every ?? Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 72))));

  const pick = (e: ReactPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.round(((px - PAD.left) / Math.max(1, w)) * (n - 1));
    setAt(Math.max(0, Math.min(n - 1, i)));
  };
  const keys = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setAt((cur) => Math.max(0, Math.min(n - 1, (cur ?? (e.key === 'ArrowRight' ? -1 : n)) + (e.key === 'ArrowRight' ? 1 : -1))));
    } else if (e.key === 'Escape') setAt(null);
  };

  const path = (pts: [number, number][]) => pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
  const rows = at === null ? [] : (kind === 'stack' ? [...series].reverse() : series).map((s) => ({ key: s.key, name: s.name, color: s.color, value: s.values[at] ?? 0 }));
  const total = at !== null && kind === 'stack' ? rows.reduce((t, r) => t + r.value, 0) : null;

  return (
    <div className="relative" ref={ref} data-time-chart={kind}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          className="block touch-pan-y outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          role="img"
          aria-label={label}
          tabIndex={0}
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={() => setAt(null)}
          onKeyDown={keys}
          onBlur={() => setAt(null)}
        >
          {/* Gridlines at clean ticks, and the baseline. */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + w} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-[var(--muted)] text-[11.5px] tabular">
                {t}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            i % step === 0 || i === n - 1 ? (
              <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="fill-[var(--muted)] text-[11.5px]">
                {(i === n - 1 && i % step !== 0 && n - 1 - Math.floor((n - 1) / step) * step < step / 2) ? '' : l}
              </text>
            ) : null,
          )}

          {kind === 'stack' && stacks
            ? series.map((s, k) => {
                const hi = stacks[k].hi.map((v, i) => [x(i), y(v)] as [number, number]);
                const lo = stacks[k].lo.map((v, i) => [x(i), y(v)] as [number, number]).reverse();
                return (
                  <g key={s.key}>
                    <path d={`${path(hi)}L${lo.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join('L')}Z`} fill={s.color} opacity={0.92} />
                    {/* The surface gap between layers. */}
                    <path d={path(hi)} fill="none" stroke="var(--surface)" strokeWidth={2} strokeLinejoin="round" />
                  </g>
                );
              })
            : series.map((s) => (
                <g key={s.key}>
                  <path d={path(s.values.map((v, i) => [x(i), y(v)]))} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {n <= 16 &&
                    s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={at === i ? 5 : 3.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />)}
                </g>
              ))}

          {at !== null && (
            <g pointerEvents="none">
              <line x1={x(at)} x2={x(at)} y1={PAD.top} y2={PAD.top + h} stroke="var(--ink)" strokeOpacity={0.35} strokeWidth={1} shapeRendering="crispEdges" />
              {kind === 'stack' &&
                stacks &&
                series.map((s, k) => <circle key={s.key} cx={x(at)} cy={y(stacks[k].hi[at])} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />)}
            </g>
          )}
        </svg>
      )}
      {at !== null && width > 0 && <Readout title={title ? title(at) : labels[at]} rows={rows} x={x(at)} width={width} footer={total !== null ? `${total} in all` : undefined} />}
    </div>
  );
}
