import { RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PersonForecast, ProgressForecast } from '@/lib/progressForecast';
import { ProgressChart3D, type ChartHover } from '@/three/ProgressChart3D';
import { onThemeChange, webglAvailable } from '@/three/capabilities';
import { formatDay, ROLE_LABEL_ONE } from './format';

/**
 * The 3D history-and-prediction chart. Drag to turn it; point at a lane for that person's
 * numbers. The tables under it carry the same information as text.
 */
export default function ProgressChartCanvas({ forecast, people, originMs, highlight }: { forecast: ProgressForecast; people: PersonForecast[]; originMs: number; highlight: string | null }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<ProgressChart3D | null>(null);
  const [hover, setHover] = useState<ChartHover | null>(null);
  const canRender = useMemo(() => webglAvailable(), []);

  useEffect(() => {
    if (!canRender || !host.current) return;
    const c = new ProgressChart3D(host.current, setHover);
    chart.current = c;
    const stop = onThemeChange(() => c.refreshTheme());
    return () => {
      stop();
      c.dispose();
      chart.current = null;
    };
  }, [canRender]);

  useEffect(() => chart.current?.setData(forecast, people, originMs), [forecast, people, originMs]);
  useEffect(() => chart.current?.highlight(highlight), [highlight]);

  if (!canRender) {
    return (
      <p className="flex h-full items-center justify-center px-6 text-center text-[13px] text-muted">
        This browser can’t show 3D graphics (WebGL is off or unavailable). The same predictions are in the tables below.
      </p>
    );
  }
  const person = hover ? people.find((p) => p.name === hover.person) : undefined;
  return (
    <div className="relative h-full">
      <div ref={host} className="h-full" aria-hidden="true" />
      <button
        type="button"
        onClick={() => chart.current?.resetView()}
        className="absolute top-3 right-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface/90 px-2.5 text-[12px] font-medium text-ink-2 hover:text-ink"
      >
        <RotateCcw className="size-3.5" aria-hidden="true" /> Reset view
      </button>
      {person && hover && (
        <div className="pointer-events-none fixed z-50 w-64 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-pop" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <p className="text-[13px] font-semibold text-ink">{person.name}</p>
          <p className="text-xs text-muted">{person.role ? ROLE_LABEL_ONE[person.role] : 'Unassigned work'}</p>
          <p className="mt-1.5 text-xs text-ink-2 tabular">
            {person.approved} of {person.total} approved, {person.open} open
          </p>
          <p className="text-xs text-ink-2">
            {person.finish
              ? `All approved around ${formatDay(originMs, person.finish.p50)} (between ${formatDay(originMs, person.finish.p10)} and ${formatDay(originMs, person.finish.p90)})`
              : person.unpredictable
                ? 'Nobody is assigned, so it can’t be predicted.'
                : 'Nothing open.'}
          </p>
        </div>
      )}
    </div>
  );
}
