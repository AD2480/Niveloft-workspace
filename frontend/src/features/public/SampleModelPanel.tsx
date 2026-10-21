import { useMemo, type ReactNode } from 'react';
import { ModelAnalysis } from '@/features/model/ModelAnalysis';
import { ProjectModelView } from '@/features/model/ProjectModelView';
import { cn } from '@/lib/cn';
import { analyzeProject } from '@/lib/projectAnalysis';
import { webglAvailable } from '@/three/capabilities';
import { buildSampleModel, sampleSummary } from './sampleProject';

/**
 * The sample project shown exactly as a real project's Model chapter: the 3D model with its camera
 * views, estimate and dependency switches, the history-and-forecast graph and the replay, plus the
 * computed analysis. `aside` sits next to the analysis (e.g. a note about the AI assistant).
 * Loaded lazily, since it brings three.js.
 */
export default function SampleModelPanel({
  autoPlay = false,
  analysis = true,
  chart = true,
  aside,
  viewClassName,
  className,
}: {
  autoPlay?: boolean;
  analysis?: boolean;
  /** The history-and-forecast graph under the model. */
  chart?: boolean;
  aside?: ReactNode;
  viewClassName?: string;
  className?: string;
}) {
  const model = useMemo(() => buildSampleModel(), []);
  const facts = useMemo(() => analyzeProject(model), [model]);
  const canRender = useMemo(() => webglAvailable(), []);

  return (
    <div className={cn('space-y-4', className)}>
      {canRender ? (
        <ProjectModelView model={model} interaction="exhibit" autoPlay={autoPlay} chart={chart} className={viewClassName ?? 'min-h-[720px] sm:min-h-[800px]'} />
      ) : (
        <div className="border border-line bg-surface px-6 py-10">
          <p className="font-display text-xl font-semibold text-ink">This browser can’t draw 3D right now.</p>
          <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-muted">{sampleSummary(model)} The analysis below is the same either way.</p>
        </div>
      )}
      {analysis && (
        <div className={cn('grid items-start gap-4', aside && 'lg:grid-cols-2')}>
          <ModelAnalysis analysis={facts} model={model} />
          {aside}
        </div>
      )}
    </div>
  );
}
