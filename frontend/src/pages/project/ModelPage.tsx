import { useMemo } from 'react';
import { Link } from 'react-router';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/States';
import { useProjectContext } from '@/features/projects/projectContext';
import { ProjectAssistant } from '@/features/ai/ProjectAssistant';
import { useDeliveryForecast } from '@/features/forecast/useDeliveryForecast';
import { WorkGraph } from '@/features/graph/WorkGraph';
import { ModelAnalysis } from '@/features/model/ModelAnalysis';
import { ProjectModelView } from '@/features/model/ProjectModelView';
import { useDocumentTitle, useUrlState } from '@/lib/hooks';
import { webglAvailable } from '@/three/capabilities';

/**
 * The project over time. The 2D work graph comes first: people down the side, calendar time
 * across, recorded work solid, planned work outlined, the forecast as a range, and a view for
 * each role. The 3D model is there for anyone who wants it (and needs WebGL); both read the same
 * records, and the analysis and the assistant sit underneath either.
 */
export default function ModelPage() {
  const { project } = useProjectContext();
  useDocumentTitle(`${project.name} · Graph`);
  const data = useDeliveryForecast(project);
  const { model, analysis, error, refetch } = data;
  const canRender = useMemo(() => webglAvailable(), []);
  const [f, setF] = useUrlState({ view: '2d' });
  const view = f.view === '3d' ? '3d' : '2d';

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-5 sm:px-6 lg:px-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-[13.5px] leading-relaxed text-muted">
          Who is doing what, when. Recorded work is solid, planned work is outlined, and the thin line is the forecast’s range. Select a task to see what it waits on and
          what waits on it.
        </p>
        <Segmented
          label="Graph style"
          value={view}
          onChange={(v) => setF({ view: v === '2d' ? '' : v })}
          options={[
            { value: '2d', label: '2D graph' },
            { value: '3d', label: '3D model' },
          ]}
        />
      </div>

      {view === '2d' ? (
        <WorkGraph project={project} data={data} />
      ) : !canRender ? (
        <div className="rounded-lg border border-line bg-surface px-6 py-10">
          <p className="text-xl font-semibold text-ink">This browser can’t draw 3D right now.</p>
          <p className="mt-2 max-w-xl text-[13.5px] text-muted">
            WebGL is turned off or unavailable. The{' '}
            <button type="button" className="text-accent hover:underline" onClick={() => setF({ view: '' })}>
              2D graph
            </button>{' '}
            shows the same records, and so do the{' '}
            <Link to={`/projects/${project.id}/timeline`} className="text-accent hover:underline">
              timeline
            </Link>{' '}
            and the{' '}
            <Link to={`/projects/${project.id}/map`} className="text-accent hover:underline">
              dependency map
            </Link>
            .
          </p>
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !model ? (
        <Skeleton className="h-[72vh]" />
      ) : model.blocks.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface px-6 py-10">
          <p className="text-xl font-semibold text-ink">Nothing to model yet.</p>
          <p className="mt-2 text-[13.5px] text-muted">Tasks appear here as blocks as soon as they’re created.</p>
        </div>
      ) : (
        <ProjectModelView model={model} projectId={project.id} className="min-h-[calc(100dvh-10rem)]" />
      )}

      {model && analysis && model.blocks.length > 0 && (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <ModelAnalysis analysis={analysis} model={model} projectId={project.id} />
          <ProjectAssistant projectId={project.id} model={model} />
        </div>
      )}
    </div>
  );
}
