import { CheckSquare, Search, SearchX, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useMyTasksQuery, useProjectQuery } from '@/api/endpoints';
import type { DueFilter, Priority, TaskSort, TaskStatus } from '@/api/types';
import { PageContainer } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Form';
import { PageHeader } from '@/components/ui/PageHeader';
import { LastUpdated } from '@/components/ui/LastUpdated';
import { Pagination } from '@/components/ui/Pagination';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Spinner';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { MyForecastCard } from '@/features/forecast/DeliveryForecast';
import { TaskTable } from '@/features/tasks/TaskTable';
import { PRIORITIES, PRIORITY_LABEL } from '@/lib/constants';
import { useDebouncedValue, useDocumentTitle, useUrlState } from '@/lib/hooks';

const DEFAULTS = { q: '', status: 'OPEN', priority: '', due: '', sort: 'dueDate', dir: 'asc', page: '0' };

export function MyTasksPage() {
  useDocumentTitle('My work');
  const [f, setF] = useUrlState(DEFAULTS);
  const [search, setSearch] = useState(f.q);
  const debounced = useDebouncedValue(search.trim(), 300);
  useEffect(() => {
    if (debounced !== f.q) setF({ q: debounced, page: '0' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const { data, isLoading, isFetching, isError, error, refetch, fulfilledTimeStamp } = useMyTasksQuery({
    search: f.q,
    status: f.status === 'ALL' ? '' : (f.status as TaskStatus | 'OPEN'),
    priority: f.priority as Priority | '',
    due: f.due as DueFilter | '',
    sort: f.sort as TaskSort,
    direction: f.dir as 'asc' | 'desc',
    page: Number(f.page),
    size: 20,
  });

  const filtered = Boolean(f.q || f.priority || f.due || (f.status !== 'OPEN' && f.status !== 'ALL'));
  const clear = () => {
    setSearch('');
    setF({ q: '', priority: '', due: '', status: 'OPEN', page: '0' });
  };

  return (
    <PageContainer>
      <PageHeader
        title="Assigned to you"
        description="Everything assigned to you across all projects."
        actions={<LastUpdated at={fulfilledTimeStamp} onRefresh={refetch} refreshing={isFetching} />}
      />

      <div className="mt-6 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="scrollbar-thin -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <Segmented
            label="Status"
            value={f.status}
            onChange={(status) => setF({ status, page: '0' })}
            options={[
              { value: 'OPEN', label: 'Open' },
              { value: 'TODO', label: 'To do' },
              { value: 'IN_PROGRESS', label: 'In progress' },
              { value: 'IN_REVIEW', label: 'In review' },
              { value: 'DONE', label: 'Done' },
              { value: 'ALL', label: 'All' },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-56">
            <Input leftIcon={<Search />} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search my tasks" aria-label="Search my tasks" />
          </div>
          <Select aria-label="Priority" value={f.priority} onChange={(e) => setF({ priority: e.target.value, page: '0' })} className="w-[calc(50%-4px)] sm:w-36">
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </Select>
          <Select aria-label="Due date" value={f.due} onChange={(e) => setF({ due: e.target.value, page: '0' })} className="w-[calc(50%-4px)] sm:w-36">
            <option value="">Any due date</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="week">Next 7 days</option>
            <option value="none">No due date</option>
          </Select>
          {filtered && (
            <Button variant="ghost" size="sm" leftIcon={<X />} onClick={clear}>
              Clear
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState error={error} onRetry={refetch} title="Couldn’t load your tasks" />
        ) : data && data.content.length > 0 ? (
          <>
            <TaskTable tasks={data.content} sort={f.sort as TaskSort} direction={f.dir as 'asc' | 'desc'} onSort={(sort, dir) => setF({ sort, dir, page: '0' })} showProject dimmed={isFetching} />
            <Pagination page={data.page} totalPages={data.totalPages} totalElements={data.totalElements} size={data.size} onPageChange={(p) => setF({ page: String(p) })} noun="tasks" />
          </>
        ) : filtered ? (
          <EmptyState icon={SearchX} title="No tasks match these filters" action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />
        ) : (
          <EmptyState icon={CheckSquare} title="Nothing assigned to you" description="Tasks assigned to you in any project will show up here." />
        )}
      </div>

      <MyForecasts />
    </PageContainer>
  );
}

/**
 * "When am I likely to finish?", per project you have open work in (up to three): your remaining
 * effort, when your work is likely approved, what it waits on, and the whole project's finish.
 */
function MyForecasts() {
  const { data } = useMyTasksQuery({ status: 'OPEN', size: 100 });
  const counts = new Map<number, number>();
  for (const t of data?.content ?? []) counts.set(t.projectId, (counts.get(t.projectId) ?? 0) + 1);
  const ids = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
  if (!ids.length) return null;
  return (
    <section aria-labelledby="my-forecasts-title" className="mt-10 space-y-4">
      <div>
        <h2 id="my-forecasts-title" className="text-[18px] font-semibold text-ink">
          When you’re likely to finish
        </h2>
        <p className="mt-1 max-w-3xl text-[13.5px] text-muted">
          Three different questions with three different answers: how much work you have left, when your work is likely approved (waiting for other work and reviews
          included), and when the whole project is.
        </p>
      </div>
      {ids.map((id) => (
        <ProjectForecast key={id} projectId={id} />
      ))}
    </section>
  );
}

function ProjectForecast({ projectId }: { projectId: number }) {
  const { data: project } = useProjectQuery(projectId);
  return project ? <MyForecastCard project={project} /> : <Skeleton className="h-48 w-full" />;
}

