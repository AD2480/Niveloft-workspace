import { useMemo } from 'react';
import { useBoardTasksQuery, useDependenciesQuery, useMilestonesQuery } from '@/api/endpoints';
import type { ProjectDetail, TaskStatus } from '@/api/types';
import { useProjectModel } from '@/features/model/useProjectModel';
import { checkRanges, forecastProgress } from '@/lib/progressForecast';

const DAY_MS = 86_400_000;

/**
 * A project's delivery forecast, computed in the browser from its records: when open work is
 * likely to be approved (dependency-aware, with ranges), how much work is left, what holds it up,
 * how good the ranges have been, and when the records last changed. `shares` is a what-if (a
 * person's share of their time from now on); the effort stays the same, only the dates move.
 */
export function useDeliveryForecast(project: ProjectDetail | null, shares?: Record<number, number>) {
  const pm = useProjectModel(project);
  const skip = project === null;
  const id = project?.id ?? 0;
  const tasks = useBoardTasksQuery(id, { skip });
  const deps = useDependenciesQuery(id, { skip });
  const milestones = useMilestonesQuery(id, { skip });
  const sharesKey = JSON.stringify(shares ?? {});

  const forecast = useMemo(
    () => (project && pm.model && tasks.currentData?.length ? forecastProgress({ model: pm.model, tasks: tasks.currentData, members: project.members, shares }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pm.model, tasks.currentData, project?.members, sharesKey],
  );

  const rangeCheck = useMemo(() => (pm.model && tasks.currentData ? checkRanges(tasks.currentData, pm.model) : null), [pm.model, tasks.currentData]);

  /** The latest recorded status change: what the forecast was last updated after. */
  const lastChange = useMemo(() => {
    if (!pm.model) return null;
    let best: { key: string; status: TaskStatus; from: number } | null = null;
    for (const b of pm.model.blocks) {
      const seg = b.segments[b.segments.length - 1];
      if (seg && (!best || seg.from > best.from)) best = { key: b.key, status: seg.status, from: seg.from };
    }
    return best ? { key: best.key, status: best.status, at: new Date(pm.model.originMs + best.from * DAY_MS) } : null;
  }, [pm.model]);

  return {
    ...pm,
    tasks: tasks.currentData,
    dependencies: deps.currentData,
    milestones: milestones.currentData,
    forecast,
    rangeCheck,
    lastChange,
  };
}

export type DeliveryForecastData = ReturnType<typeof useDeliveryForecast>;
