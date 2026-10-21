import { useMemo } from 'react';
import { useBoardTasksQuery, useDependenciesQuery, useMilestonesQuery, useProjectHistoryQuery } from '@/api/endpoints';
import type { ProjectDetail } from '@/api/types';
import { todayIso } from '@/lib/dates';
import { analyzeProject } from '@/lib/projectAnalysis';
import { schedule } from '@/lib/scheduler';
import { buildProjectModel } from '@/three/projectModel';

/**
 * A project's model (records → scheduler estimate → model) and its computed analysis, shared by
 * the Overview and Model pages. The queries are cached, so moving between the two pages doesn't
 * fetch again. Nothing here touches three.js.
 */
export function useProjectModel(project: Pick<ProjectDetail, 'id' | 'startDate' | 'deadline'> | null) {
  const skip = project === null;
  const id = project?.id ?? 0;
  const tasks = useBoardTasksQuery(id, { skip });
  const deps = useDependenciesQuery(id, { skip });
  const milestones = useMilestonesQuery(id, { skip });
  const history = useProjectHistoryQuery(id, { skip });

  const model = useMemo(() => {
    // currentData: never mix the previous project's records into this one while switching.
    if (!project || !tasks.currentData || !deps.currentData || !milestones.currentData || !history.currentData) return null;
    const projection = schedule({
      today: todayIso(),
      tasks: tasks.currentData.map((t) => ({
        id: t.id,
        key: t.key,
        title: t.title,
        status: t.status,
        priority: t.priority,
        assigneeId: t.assignee?.id ?? null,
        dueDate: t.dueDate,
        estimateDays: t.estimateDays,
        startedOn: t.startedAt ? todayIso(new Date(t.startedAt)) : null,
        milestoneId: t.milestoneId,
      })),
      dependencies: deps.currentData.map((d) => ({ blockerId: d.blocker.id, blockedId: d.blocked.id })),
    });
    return buildProjectModel({
      now: new Date(),
      projectStart: project.startDate,
      deadline: project.deadline,
      tasks: tasks.currentData,
      dependencies: deps.currentData,
      milestones: milestones.currentData,
      history: history.currentData,
      projection,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.currentData, deps.currentData, milestones.currentData, history.currentData, project?.startDate, project?.deadline]);

  const analysis = useMemo(() => (model ? analyzeProject(model) : null), [model]);

  /** The time span the graph and the replay share: first task (a day before) to the estimated finish. */
  const range = useMemo(() => {
    if (!model) return null;
    const start = Math.max(0, Math.min(...model.blocks.map((b) => b.createdDay), model.todayDay) - 1);
    const end = Math.max(model.todayDay, model.projectionEnd ?? model.todayDay);
    return { start, end };
  }, [model]);

  const error = tasks.error ?? deps.error ?? milestones.error ?? history.error;
  /** True until the model is built or a query failed (for callers that must wait for it). */
  const loading = project !== null && model === null && !error;
  const refetch = () => void Promise.all([tasks.refetch(), deps.refetch(), milestones.refetch(), history.refetch()]);
  return { model, analysis, range, error, refetch, loading };
}
