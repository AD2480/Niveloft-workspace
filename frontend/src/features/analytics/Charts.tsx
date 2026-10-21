import { BarChart3, Table2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { FlowPoint, Priority, TaskStatus, TrendPoint, WorkloadRow } from '@/api/types';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Segmented } from '@/components/ui/Segmented';
import { PRIORITY_LABEL, STATUS_COLOR, STATUS_LABEL } from '@/lib/constants';
import { formatDate } from '@/lib/dates';
import { BarList, ChartLegend, StackedBarList, TimeChart, type ChartSeries } from './svgCharts';

/** Chart card with a chart/table toggle so every chart has an accessible table view. */
export function ChartCard({
  title,
  description,
  chart,
  table,
  height,
}: {
  title: string;
  description?: string;
  chart: ReactNode;
  table: { headers: string[]; rows: (string | number)[][] };
  /** Room the table may take before it scrolls (the chart sizes itself). */
  height?: number;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <Card data-chart-card="">
      <CardHeader
        title={title}
        description={description}
        action={
          <Segmented
            label={`${title} view`}
            value={view}
            onChange={setView}
            options={[
              { value: 'chart', label: <span className="sr-only">Chart</span>, icon: <BarChart3 aria-hidden="true" /> },
              { value: 'table', label: <span className="sr-only">Table</span>, icon: <Table2 aria-hidden="true" /> },
            ]}
          />
        }
      />
      <CardBody>
        {view === 'chart' ? (
          chart
        ) : (
          <div className="scrollbar-thin overflow-auto" style={{ maxHeight: height ?? 320 }}>
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-surface text-[12.5px] text-muted">
                <tr>
                  {table.headers.map((h, i) => (
                    <th key={h} scope="col" className={`border-b border-line py-2 font-medium ${i === 0 ? 'text-left' : 'text-right'}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {table.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j} className={`py-1.5 ${j === 0 ? 'text-left text-ink-2' : 'text-right text-ink tabular'}`}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

const STATES: { status: TaskStatus; key: 'todo' | 'inProgress' | 'inReview' | 'done' }[] = [
  { status: 'DONE', key: 'done' },
  { status: 'IN_REVIEW', key: 'inReview' },
  { status: 'IN_PROGRESS', key: 'inProgress' },
  { status: 'TODO', key: 'todo' },
];

const PRIORITY_ORDER: Priority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];

// ---------------------------------------------------------------------------

export function StatusChart({ data }: { data: { status: TaskStatus; count: number }[] }) {
  // The snowpack's order: approved first, then in review, in progress, not started.
  const rows = STATES.map((s) => ({ key: s.status, label: STATUS_LABEL[s.status], value: data.find((d) => d.status === s.status)?.count ?? 0, color: STATUS_COLOR[s.status] }));
  return (
    <ChartCard
      title="Tasks by status"
      description="Every task in the project, in the layer of its state"
      table={{ headers: ['Status', 'Tasks'], rows: rows.map((r) => [r.label, r.value]) }}
      chart={<BarList rows={rows} labelWidth={92} />}
    />
  );
}

export function PriorityChart({ data }: { data: { priority: Priority; count: number }[] }) {
  const rows = PRIORITY_ORDER.map((p) => ({ key: p, label: PRIORITY_LABEL[p], value: data.find((d) => d.priority === p)?.count ?? 0, color: 'var(--series-1)' }));
  return (
    <ChartCard
      title="Open tasks by priority"
      description="Tasks not yet approved"
      table={{ headers: ['Priority', 'Open tasks'], rows: rows.map((r) => [r.label, r.value]) }}
      chart={<BarList rows={rows} labelWidth={92} />}
    />
  );
}

const WORK_SERIES: ChartSeries[] = [
  { key: 'inReview', name: 'In review', color: STATUS_COLOR.IN_REVIEW },
  { key: 'inProgress', name: 'In progress', color: STATUS_COLOR.IN_PROGRESS },
  { key: 'todo', name: 'To do', color: STATUS_COLOR.TODO },
];

export function WorkloadChart({ data }: { data: WorkloadRow[] }) {
  const rows = data.map((w) => ({
    key: String(w.user.id),
    label: w.user.name.split(' ')[0],
    title: w.user.name,
    values: { todo: w.todo, inProgress: w.inProgress, inReview: w.inReview },
    note: w.overdue ? <span className="text-[12.5px] font-medium text-danger">{w.overdue} late</span> : undefined,
  }));
  return (
    <ChartCard
      title="Workload by member"
      description="Open tasks assigned to each person, and how many are late"
      table={{
        headers: ['Member', 'To do', 'In progress', 'In review', 'Late', 'Approved'],
        rows: data.map((r) => [r.user.name, r.todo, r.inProgress, r.inReview, r.overdue, r.done]),
      }}
      chart={rows.length ? <StackedBarList rows={rows} series={WORK_SERIES} /> : <p className="py-8 text-center text-[13px] text-muted">Nobody has open work.</p>}
    />
  );
}

export function TrendChart({ data, title = 'Completion trend', description = 'Tasks created and approved each week, the last 8 weeks' }: { data: TrendPoint[]; title?: string; description?: string }) {
  const series = [
    { key: 'created', name: 'Created', color: 'var(--series-1)', values: data.map((p) => p.created) },
    { key: 'completed', name: 'Approved', color: 'var(--series-2)', values: data.map((p) => p.completed) },
  ];
  const created = data.reduce((n, p) => n + p.created, 0);
  const approved = data.reduce((n, p) => n + p.completed, 0);
  return (
    <ChartCard
      title={title}
      description={description}
      table={{ headers: ['Week of', 'Created', 'Approved'], rows: data.map((p) => [formatDate(p.weekStart, 'd MMM'), p.created, p.completed]) }}
      chart={
        <>
          <ChartLegend series={series} mark="line" className="mb-3" />
          <TimeChart
            kind="lines"
            labels={data.map((p) => formatDate(p.weekStart, 'd MMM'))}
            title={(i) => `Week of ${formatDate(data[i].weekStart, 'd MMM')}`}
            series={series}
            height={220}
            label={`${created} tasks created and ${approved} approved over the last ${data.length} weeks.`}
          />
        </>
      }
    />
  );
}

/**
 * Cumulative flow, drawn as a snowpack over time: how many tasks sat in each state at the end of
 * each day, replayed from the status-change history, approved at the bottom. A layer that thickens
 * is work piling up (a growing In review layer is reviews not keeping up).
 */
export function FlowChart({ data }: { data: FlowPoint[] }) {
  const series = STATES.map((s) => ({ key: s.key, name: STATUS_LABEL[s.status], color: STATUS_COLOR[s.status], values: data.map((p) => p[s.key]) }));
  const last = data[data.length - 1];
  return (
    <ChartCard
      title="Flow over the last 28 days"
      description="Tasks in each state at the end of each day, from the recorded status changes"
      chart={
        <>
          <ChartLegend series={series} className="mb-3" />
          <TimeChart
            kind="stack"
            labels={data.map((p) => formatDate(p.date, 'd MMM'))}
            title={(i) => formatDate(data[i].date, 'EEE d MMM')}
            series={series}
            height={260}
            every={7}
            label={last ? `On ${formatDate(last.date, 'd MMM')}: ${last.done} approved, ${last.inReview} in review, ${last.inProgress} in progress and ${last.todo} to do.` : 'No history yet.'}
          />
        </>
      }
      table={{
        headers: ['Day', 'To do', 'In progress', 'In review', 'Approved'],
        rows: data.map((p) => [formatDate(p.date, 'EEE d MMM'), p.todo, p.inProgress, p.inReview, p.done]),
      }}
    />
  );
}
