import { ChartLine } from 'lucide-react';
import { Link } from 'react-router';
import type { ProjectDetail } from '@/api/types';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Spinner';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { HistoryForecastChart } from './HistoryForecastChart';
import { AnalysisHighlights } from './ModelAnalysis';
import { useProjectModel } from './useProjectModel';

/**
 * The project's history and forecast on its Overview: the graph (recorded up to today, the
 * scheduler's estimate after it) and the analysis lines that need attention. The 3D model, the
 * full analysis and the AI assistant are one click away on the Graph page.
 */
export function ForecastCard({ project }: { project: ProjectDetail }) {
  const { model, analysis, range, error, refetch } = useProjectModel(project);
  return (
    <Card>
      <CardHeader
        title="History and forecast"
        description="Every task and every approved task, day by day. Solid up to today; dashed after it is the scheduler’s estimate, not a commitment."
        action={
          <Link to="model" className="inline-flex min-h-6 items-center gap-1 text-xs font-medium text-accent hover:underline">
            Open the graph
          </Link>
        }
      />
      <CardBody>
        {error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : !model || !analysis || !range ? (
          <Skeleton className="h-52 w-full" />
        ) : model.blocks.length === 0 ? (
          <EmptyState icon={ChartLine} title="Nothing to chart yet" description="The graph starts as soon as the project has tasks." compact />
        ) : (
          <div className="grid gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <HistoryForecastChart model={model} start={range.start} end={range.end} day={model.todayDay} height={188} showTitle={false} />
            <div>
              <p className="text-[12px] font-medium text-muted">Analysis, computed from the records (not AI)</p>
              <AnalysisHighlights analysis={analysis} className="mt-1" />
              <Link to="model" className="caps mt-3 inline-flex items-center gap-1.5 text-[11px] text-accent hover:text-ink">
                Full analysis and the AI assistant
              </Link>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
