import { BarChart3, Info } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useProjectQuery, useProjectsQuery } from '@/api/endpoints';
import { HealthBadge, ProjectMark, ProjectStatusBadge } from '@/components/domain';
import { PageContainer } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Select } from '@/components/ui/Form';
import { LastUpdated } from '@/components/ui/LastUpdated';
import { PrintButton } from '@/components/PrintHeader';
import { ProgressBar } from '@/components/ui/Progress';
import { Skeleton } from '@/components/ui/Spinner';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { HealthRulesDialog } from '@/features/analytics/HealthCard';
import { ProjectAnalyticsView } from '@/features/analytics/ProjectAnalyticsView';
import { DeliveryForecastCard, SupportingMetrics } from '@/features/forecast/DeliveryForecast';
import { useDeliveryForecast } from '@/features/forecast/useDeliveryForecast';
import { WorkGraph } from '@/features/graph/WorkGraph';
import { formatDate } from '@/lib/dates';
import { useDocumentTitle, useUrlState } from '@/lib/hooks';

export function AnalyticsPage() {
  useDocumentTitle('Reports');
  const { data, isLoading, isFetching, isError, error, refetch, fulfilledTimeStamp } = useProjectsQuery({ size: 100 });
  const [f, setF] = useUrlState({ project: '' });
  const [rulesOpen, setRulesOpen] = useState(false);
  const projects = data?.content ?? [];
  const selected = projects.find((p) => String(p.id) === f.project) ?? projects.find((p) => p.status === 'ACTIVE') ?? projects[0];

  return (
    <PageContainer wide>
      {/* A compact title row: the page, the project it's about, and the page's tools. */}
      <div className="flex flex-col gap-3 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-ink sm:text-[30px]">Reports</h1>
          {projects.length > 0 && selected && (
            <Select aria-label="Project" value={selected.id} onChange={(e) => setF({ project: e.target.value })} className="w-full sm:w-72" data-reports-project="">
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2" data-print="hide">
          <LastUpdated at={fulfilledTimeStamp} onRefresh={refetch} refreshing={isFetching} className="mr-2" />
          <PrintButton variant="ghost" />
          <Button variant="ghost" leftIcon={<Info />} onClick={() => setRulesOpen(true)}>
            Health rules
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : projects.length === 0 || !selected ? (
        <EmptyState icon={BarChart3} title="No data yet" description="Create a project and add tasks to see its forecast and reports." action={<Link to="/projects" className="text-sm font-medium text-accent hover:underline">Go to projects</Link>} />
      ) : (
        <div className="space-y-8">
          <ProjectReport key={selected.id} projectId={selected.id} />

          <section aria-labelledby="breakdowns-title" className="space-y-4">
            <h2 id="breakdowns-title" className="text-[18px] font-semibold text-ink">
              Breakdowns
            </h2>
            <ProjectAnalyticsView key={selected.id} projectId={selected.id} color={selected.color} showExpected={selected.status === 'ACTIVE'} />
          </section>

          <Card>
            <CardHeader title="All your projects" description="Every project you’re a member of. Choose one to see its forecast above." />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead className="text-[12px] text-muted">
                  <tr>
                    <th scope="col" className="px-5 py-2.5 text-left font-medium">Project</th>
                    <th scope="col" className="px-3 py-2.5 text-left font-medium">Health</th>
                    <th scope="col" className="w-56 px-3 py-2.5 text-left font-medium">Tasks approved</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">Open</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">Overdue</th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">Deadline</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {projects.map((p) => (
                    <tr key={p.id} className={selected?.id === p.id ? 'bg-brand-soft/40' : undefined}>
                      <td className="px-5 py-2.5">
                        <button type="button" onClick={() => setF({ project: String(p.id) })} className="flex items-center gap-2.5 text-left font-medium text-ink hover:text-accent" aria-current={selected?.id === p.id ? 'true' : undefined}>
                          <ProjectMark name={p.name} color={p.color} size="sm" />
                          {p.name}
                        </button>
                      </td>
                      <td className="px-3 py-2.5">{p.status === 'ACTIVE' ? <HealthBadge health={p.health} /> : <ProjectStatusBadge status={p.status} />}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <ProgressBar value={p.progress} color={p.color} label={`${p.name}: ${p.taskCounts.done} of ${p.taskCounts.total} tasks approved`} />
                          <span className="w-14 text-right text-xs tabular">
                            {p.taskCounts.done}/{p.taskCounts.total}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular">{p.taskCounts.total - p.taskCounts.done}</td>
                      <td className={`px-3 py-2.5 text-right tabular ${p.taskCounts.overdue ? 'font-semibold text-danger' : ''}`}>{p.taskCounts.overdue}</td>
                      <td className="px-5 py-2.5 text-right text-muted">{formatDate(p.deadline, 'd MMM yyyy')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
      <HealthRulesDialog open={rulesOpen} onOpenChange={setRulesOpen} />
    </PageContainer>
  );
}

/** The report for one project: the forecast, three supporting numbers, and the work graph. */
function ProjectReport({ projectId }: { projectId: number }) {
  const { data: project, isLoading, isError, error, refetch } = useProjectQuery(projectId);
  const forecast = useDeliveryForecast(project ?? null);
  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (isError || !project) return <ErrorState error={error} onRetry={refetch} title="Couldn’t load this project" />;
  return (
    <section aria-label={`${project.name}: forecast`} className="space-y-4">
      <DeliveryForecastCard project={project} data={forecast} />
      <SupportingMetrics data={forecast} />
      <WorkGraph project={project} data={forecast} heading="The timeline" />
    </section>
  );
}
