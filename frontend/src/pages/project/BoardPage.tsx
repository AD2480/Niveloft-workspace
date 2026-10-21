import { subDays } from 'date-fns';
import { Info, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode, Suspense } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { useBoardTasksQuery } from '@/api/endpoints';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Form';
import { Skeleton } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/States';
import { Tooltip } from '@/components/ui/Tooltip';
import { useCurrentUserId, useProjectContext } from '@/features/projects/projectContext';
import { KanbanBoard } from '@/features/tasks/KanbanBoard';
import { cn } from '@/lib/cn';
import { PRIORITIES, PRIORITY_LABEL } from '@/lib/constants';
import { useDebouncedValue, useUrlState } from '@/lib/hooks';
import { can } from '@/lib/permissions';

const RECENT_DAYS = 3;

function Toggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'h-9 rounded-lg border px-3 text-[13px] font-medium whitespace-nowrap transition-colors',
        pressed ? 'border-ink bg-ink text-canvas' : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-2',
      )}
    >
      {children}
    </button>
  );
}

export function BoardPage() {
  const context = useProjectContext();
  const { project } = context;
  const me = useCurrentUserId();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: tasks, isLoading, isError, error, refetch } = useBoardTasksQuery(project.id);
  const [f, setF] = useUrlState({ q: '', people: '', priority: '', mine: '', recent: '' });
  const [search, setSearch] = useState(f.q);
  const debounced = useDebouncedValue(search.trim().toLowerCase(), 150);
  useEffect(() => {
    if (debounced !== f.q) setF({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const people = useMemo(() => (f.people ? f.people.split(',').map(Number).filter(Boolean) : []), [f.people]);
  const togglePerson = (id: number) => {
    const next = people.includes(id) ? people.filter((p) => p !== id) : [...people, id];
    setF({ people: next.join(',') });
  };
  const workers = project.members.filter((m) => m.role !== 'VIEWER');

  const visible = useMemo(() => {
    if (!tasks) return [];
    const recentSince = subDays(new Date(), RECENT_DAYS).toISOString();
    return tasks.filter((t) => {
      if (f.q && !`${t.key} ${t.title}`.toLowerCase().includes(f.q)) return false;
      if (people.length && !(t.assignee && people.includes(t.assignee.id))) return false;
      if (f.mine && t.assignee?.id !== me) return false;
      if (f.recent && t.updatedAt < recentSince) return false;
      if (f.priority && t.priority !== f.priority) return false;
      return true;
    });
  }, [tasks, f.q, f.mine, f.recent, f.priority, people, me]);

  const filtered = Boolean(f.q || f.people || f.priority || f.mine || f.recent);
  const clear = () => {
    setSearch('');
    setF({ q: '', people: '', priority: '', mine: '', recent: '' });
  };

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-10">
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Filter board">
          <div className="w-full sm:w-56">
            <Input leftIcon={<Search />} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search board" aria-label="Search board" />
          </div>

          {/* Avatar filter: click people to show only their tasks (idea from jira_clone). */}
          <div className="flex items-center -space-x-1" role="group" aria-label="Filter by assignee">
            {workers.slice(0, 8).map((m) => {
              const active = people.includes(m.user.id);
              return (
                <Tooltip key={m.user.id} content={m.user.name}>
                  <button
                    type="button"
                    aria-pressed={active}
                    aria-label={`Show tasks assigned to ${m.user.name}`}
                    onClick={() => togglePerson(m.user.id)}
                    className={cn('rounded-full transition-transform hover:z-10 hover:-translate-y-0.5', active && 'z-10 ring-2 ring-ink ring-offset-2 ring-offset-canvas')}
                  >
                    <Avatar user={m.user} size="md" />
                  </button>
                </Tooltip>
              );
            })}
          </div>

          <Toggle pressed={!!f.mine} onClick={() => setF({ mine: f.mine ? '' : '1' })}>
            Only my tasks
          </Toggle>
          <Toggle pressed={!!f.recent} onClick={() => setF({ recent: f.recent ? '' : '1' })}>
            Recently updated
          </Toggle>
          <Select aria-label="Priority" value={f.priority} onChange={(e) => setF({ priority: e.target.value })} className="w-36">
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </Select>
          {filtered && (
            <Button variant="ghost" size="sm" leftIcon={<X />} onClick={clear}>
              Clear
            </Button>
          )}
        </div>
        <p className="flex items-start gap-1.5 text-[12.5px] leading-snug text-muted xl:max-w-[17rem]">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {can.createTask(project.myRole) ? 'Drag a card to In review to submit it. Reviewers drag it to Done to approve.' : 'You have read-only access to this board.'}
        </p>
      </div>

      {isLoading ? (
        <div className="flex gap-4 overflow-hidden">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="w-[300px] shrink-0 space-y-2 rounded-xl bg-surface-2/70 p-3 ring-1 ring-line lg:flex-1">
              <Skeleton className="h-5 w-24" />
              {[0, 1, 2].map((j) => (
                <Skeleton key={j} className="h-24 w-full rounded-lg" />
              ))}
            </div>
          ))}
        </div>
      ) : isError || !tasks ? (
        <ErrorState error={error} onRetry={refetch} title="Couldn’t load the board" />
      ) : (
        <KanbanBoard project={project} tasks={tasks} visible={visible} onOpenTask={(t) => navigate(`/projects/${project.id}/board/tasks/${t.id}${location.search}`)} />
      )}

      {/* Task side panel (nested route). */}
      <Suspense fallback={null}>
        <Outlet context={context} />
      </Suspense>
    </div>
  );
}
