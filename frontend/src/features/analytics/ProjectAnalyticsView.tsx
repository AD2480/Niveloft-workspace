import { AlertTriangle, CalendarClock, CheckCircle2, Gauge, Timer } from 'lucide-react';
import { useBoardTasksQuery, useProjectAnalyticsQuery } from '@/api/endpoints';
import { cycleStats, progressMeasures, EFFORT_COVERAGE } from '@/lib/workStats';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Spinner';
import { StatGrid, StatTile } from '@/components/ui/StatTile';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { MiniTaskList } from '@/features/tasks/MiniTaskList';
import { AiStatusDraft } from '@/features/ai/AiPanels';
import { FlowChart, PriorityChart, StatusChart, TrendChart, WorkloadChart } from './Charts';
import { HealthCard } from './HealthCard';

export function ProjectAnalyticsView({ projectId, color, showExpected = true }: { projectId: number; color?: string; showExpected?: boolean }) {
  const { data: a, isLoading, isError, error, refetch, isFetching } = useProjectAnalyticsQuery(projectId);
  const { currentData: tasks } = useBoardTasksQuery(projectId);
  const measures = tasks ? progressMeasures(tasks) : null;
  const cycle = tasks ? cycleStats(tasks) : null;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl lg:col-span-2" />
        </div>
      </div>
    );
  }
  if (isError || !a) return <ErrorState error={error} onRetry={refetch} title="Couldn’t load analytics" />;

  return (
    <div className={`space-y-6 transition-opacity ${isFetching ? 'opacity-80' : ''}`}>
      <StatGrid cols={4}>
        {/* A count, labelled as one: a small task and a big one count the same. */}
        <StatTile
          label="Tasks approved"
          value={`${a.taskCounts.done} of ${a.taskCounts.total}`}
          icon={Gauge}
          tone="brand"
          hint={
            measures?.effortShare != null
              ? `${Math.round(measures.effortShare * 100)}% of the estimated work (${Math.round(measures.estimated * 100)}% of tasks have estimates)`
              : `${a.progress}% of tasks. Counts tasks, not effort${measures ? `: only ${Math.round(measures.estimated * 100)}% have estimates, too few to weigh by work (needs ${EFFORT_COVERAGE * 100}%)` : ''}.`
          }
        />
        <StatTile label="Overdue" value={a.taskCounts.overdue} icon={AlertTriangle} tone={a.taskCounts.overdue ? 'danger' : 'neutral'} hint="Open tasks past their due date" />
        <StatTile
          label="Cycle time (median)"
          value={cycle?.median != null ? `${cycle.median} d` : '–'}
          icon={Timer}
          tone="info"
          hint={
            !cycle
              ? 'First start to approval'
              : cycle.median === null
                ? `Too few approved tasks to say (${cycle.n}; needs 3)`
                : (
                    <>
                      From first start to approval. Middle half {cycle.p25}–{cycle.p75} d, range {cycle.min}–{cycle.max} d, from {cycle.n} approved tasks.
                      <DotStrip values={cycle.values} low={cycle.p25!} high={cycle.p75!} />
                    </>
                  )
          }
        />
        <StatTile
          label="First-time approval"
          value={a.approvalRate === null ? '–' : `${a.approvalRate}%`}
          icon={CheckCircle2}
          tone="success"
          hint={a.approvalRate === null ? 'No reviewed tasks yet' : 'Reviewed tasks approved on their first submission'}
        />
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-3">
        <HealthCard health={a.health} reasons={a.healthReasons} progress={a.progress} expected={showExpected ? a.expectedProgress : null} color={color} />
        <div className="lg:col-span-2">
          <TrendChart data={a.completionTrend} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <StatusChart data={a.statusDistribution} />
        <PriorityChart data={a.priorityDistribution} />
      </div>

      <FlowChart data={a.flow} />

      <Card aria-labelledby="review-flow" data-review-flow="">
        <CardHeader title={<span id="review-flow">Review flow</span>} description="From submissions, reviews and status changes. Medians, so one outlier doesn’t skew them." />
        <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden border-t border-line bg-line lg:grid-cols-5">
          {[
            { label: 'Submissions', value: String(a.reviewStats.submissions), hint: `${a.reviewStats.reviewed} reviewed, ${a.reviewStats.pending} waiting` },
            {
              label: 'Time to review',
              value:
                a.reviewStats.medianHoursToReview === null
                  ? '–'
                  : a.reviewStats.medianHoursToReview < 48
                    ? `${Math.round(a.reviewStats.medianHoursToReview)}h`
                    : `${Math.round(a.reviewStats.medianHoursToReview / 24)}d`,
              hint: 'Median, from submission to decision',
            },
            { label: 'Changes requested', value: a.reviewStats.reworkRate === null ? '–' : `${a.reviewStats.reworkRate}%`, hint: 'Share of reviews sending work back' },
            ...a.timeInStatus.map((t) => ({
              label: t.status === 'IN_PROGRESS' ? 'In progress for' : 'In review for',
              value: t.medianDays === null ? '–' : `${t.medianDays}d`,
              hint: t.samples ? `Median of ${t.samples} finished ${t.samples === 1 ? 'stay' : 'stays'}` : 'No finished stays yet',
            })),
          ].map((s) => (
            <div key={s.label} className="bg-surface px-5 py-4">
              <dt className="text-[13px] font-medium text-muted">{s.label}</dt>
              <dd className="reading mt-3 text-[28px] text-ink">{s.value}</dd>
              <dd className="mt-2 text-[12.5px] leading-snug text-muted">{s.hint}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <AiStatusDraft projectId={a.projectId} />

      {a.workload.length > 0 && <WorkloadChart data={a.workload} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Overdue tasks" description="Open tasks whose due date has passed" />
          <CardBody className="py-2">
            {a.overdueTasks.length ? (
              <MiniTaskList tasks={a.overdueTasks} showAssignee />
            ) : (
              <EmptyState icon={CheckCircle2} title="Nothing overdue" description="Every open task is on schedule." compact />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Upcoming deadlines" description="Open tasks due in the next 14 days" />
          <CardBody className="py-2">
            {a.upcomingDeadlines.length ? (
              <MiniTaskList tasks={a.upcomingDeadlines} showAssignee />
            ) : (
              <EmptyState icon={CalendarClock} title="No upcoming deadlines" compact />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/** Every measurement as a dot on one line, with the middle half shaded: the spread at a glance. */
function DotStrip({ values, low, high }: { values: number[]; low: number; high: number }) {
  const max = Math.max(1, ...values);
  const x = (v: number) => 4 + (v / max) * 192;
  return (
    <svg viewBox="0 0 200 16" className="mt-2 h-4 w-full max-w-[200px]" role="img" aria-label={`${values.length} cycle times from ${values[0]} to ${values[values.length - 1]} days`}>
      <rect x={x(low)} y={3} width={Math.max(2, x(high) - x(low))} height={10} rx={3} className="fill-brand-soft" />
      <line x1={4} x2={196} y1={8} y2={8} className="stroke-line-strong" strokeWidth={1} />
      {values.map((v, i) => (
        <circle key={i} cx={x(v)} cy={8} r={2.4} className="fill-accent" opacity={0.75} />
      ))}
    </svg>
  );
}

