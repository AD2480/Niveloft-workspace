import { ListTodo, Plus, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useMilestonesQuery, useTasksQuery } from '@/api/endpoints';
import type { DueFilter, Priority, TaskSort, TaskStatus } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Pagination } from '@/components/ui/Pagination';
import { Skeleton } from '@/components/ui/Spinner';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { useProjectContext } from '@/features/projects/projectContext';
import { TaskFilters } from '@/features/tasks/TaskFilters';
import { TaskTable } from '@/features/tasks/TaskTable';
import { useDebouncedValue, useUrlState } from '@/lib/hooks';
import { can } from '@/lib/permissions';

const DEFAULTS = { q: '', status: '', assignee: '', priority: '', milestone: '', due: '', sort: 'position', dir: 'asc', page: '0' };

export function TaskListPage() {
  const { project, openNewTask } = useProjectContext();
  const [f, setF] = useUrlState(DEFAULTS);
  const [search, setSearch] = useState(f.q);
  const debounced = useDebouncedValue(search.trim(), 300);
  useEffect(() => {
    if (debounced !== f.q) setF({ q: debounced, page: '0' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  const { data: milestones } = useMilestonesQuery(project.id);

  const { data, isLoading, isFetching, isError, error, refetch } = useTasksQuery({
    projectId: project.id,
    search: f.q,
    status: f.status as TaskStatus | '',
    assignee: f.assignee,
    priority: f.priority as Priority | '',
    milestoneId: f.milestone ? Number(f.milestone) : '',
    due: f.due as DueFilter | '',
    sort: f.sort as TaskSort,
    direction: f.dir as 'asc' | 'desc',
    page: Number(f.page),
    size: 20,
  });

  const filtered = Boolean(f.q || f.status || f.assignee || f.priority || f.milestone || f.due);
  const clear = () => {
    setSearch('');
    setF({ q: '', status: '', assignee: '', priority: '', milestone: '', due: '', page: '0' });
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-5 sm:px-6 lg:px-10">
      <TaskFilters
        values={f}
        search={search}
        onSearchChange={setSearch}
        onChange={(patch) => setF({ ...patch, page: '0' })}
        onClear={clear}
        members={project.members}
        milestones={milestones}
        showStatus
        showDue
        showMilestone
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} title="Couldn’t load tasks" />
      ) : data && data.content.length > 0 ? (
        <>
          <TaskTable
            tasks={data.content}
            sort={f.sort as TaskSort}
            direction={f.dir as 'asc' | 'desc'}
            onSort={(sort, dir) => setF({ sort, dir, page: '0' })}
            dimmed={isFetching}
          />
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            totalElements={data.totalElements}
            size={data.size}
            onPageChange={(p) => setF({ page: String(p) })}
            noun="tasks"
          />
        </>
      ) : filtered ? (
        <EmptyState
          icon={SearchX}
          title="No tasks match these filters"
          action={
            <Button variant="secondary" onClick={clear}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={ListTodo}
          title="No tasks yet"
          description="Break the project into tasks, assign owners and set due dates."
          action={
            can.createTask(project.myRole) ? (
              <Button leftIcon={<Plus />} onClick={() => openNewTask()}>
                New task
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
