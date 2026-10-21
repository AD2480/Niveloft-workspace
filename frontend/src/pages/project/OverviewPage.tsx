import { CheckCircle2, Flag, Info } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Member, Milestone, TaskStatus } from '@/api/types';
import { useBoardTasksQuery, useProjectActivityQuery, useProjectAnalyticsQuery } from '@/api/endpoints';
import { RoleBadge } from '@/components/domain';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { LastUpdated } from '@/components/ui/LastUpdated';
import { PrintButton } from '@/components/PrintHeader';
import { ProgressBar } from '@/components/ui/Progress';
import { Skeleton } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/States';
import { ActivityList } from '@/features/activity/ActivityList';
import { HealthCard } from '@/features/analytics/HealthCard';
import { DeliveryForecastCard, MyForecastCard, SupportingMetrics } from '@/features/forecast/DeliveryForecast';
import { useDeliveryForecast } from '@/features/forecast/useDeliveryForecast';
import { ForecastCard } from '@/features/model/ForecastCard';
import { ProjectSnowpackCard } from '@/features/overview/ProjectSnowpackCard';
import { CardEmpty, SummaryCard } from '@/features/overview/SummaryCard';
import { useProjectContext } from '@/features/projects/projectContext';
import { RoleGuideDialog } from '@/features/roles/RoleGuide';
import { MiniTaskList } from '@/features/tasks/MiniTaskList';
import { TaskGroupsDialog } from '@/features/tasks/TaskGroupsDialog';
import { ROLE_DESCRIPTION, ROLE_LABEL, ROLES, STATUS_LABEL } from '@/lib/constants';
import { addDaysIso, dueRelative, formatDate, todayIso } from '@/lib/dates';
import { RichText } from '@/components/RichText';

type Pop = TaskStatus | 'OVERDUE' | 'DEADLINES' | 'MILESTONES' | 'TEAM' | 'ACTIVITY' | 'ABOUT' | 'ROLES' | null;

/** How many rows each card previews. The same everywhere, so the cards line up. */
const PREVIEW = 4;
const LONG_DESCRIPTION = 240;

const byRoleThenName = (a: Member, b: Member) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.user.name.localeCompare(b.user.name);
const openFirst = (a: Milestone, b: Milestone) => Number(a.completed) - Number(b.completed) || (a.completed ? b.dueDate.localeCompare(a.dueDate) : a.dueDate.localeCompare(b.dueDate));

/**
 * A project at a glance. It leads with the delivery forecast (when it will likely finish, against
 * the deadline, what holds it up and the next move) and three supporting numbers, then your own
 * part, then the status counts (each opens a tidy list), the avalanche (the tasks as snow on a
 * mountain), the history graph, and six even cards.
 */
export function OverviewPage() {
  const { project } = useProjectContext();
  const forecast = useDeliveryForecast(project);
  const [pop, setPop] = useState<Pop>(null);
  const close = (o: boolean) => !o && setPop(null);
  const { data: a, isLoading, isFetching, isError, error, refetch, fulfilledTimeStamp } = useProjectAnalyticsQuery(project.id);
  const { data: activity } = useProjectActivityQuery({ projectId: project.id, size: PREVIEW });
  const { data: allActivity } = useProjectActivityQuery({ projectId: project.id, size: 40 }, { skip: pop !== 'ACTIVITY' });
  const taskPop = pop === 'TODO' || pop === 'IN_PROGRESS' || pop === 'IN_REVIEW' || pop === 'DONE' || pop === 'OVERDUE' || pop === 'DEADLINES';
  const { data: tasks } = useBoardTasksQuery(project.id, { skip: !taskPop });
  const c = project.taskCounts;

  const popTasks = useMemo(() => {
    if (!tasks || !taskPop) return undefined;
    if (pop === 'OVERDUE') return tasks.filter((t) => t.overdue);
    if (pop === 'DEADLINES') {
      const until = addDaysIso(todayIso(), 14);
      return tasks.filter((t) => t.status !== 'DONE' && t.dueDate !== null && t.dueDate <= until);
    }
    return tasks.filter((t) => t.status === pop);
  }, [tasks, pop, taskPop]);

  const members = useMemo(() => [...project.members].sort(byRoleThenName), [project.members]);
  const milestones = useMemo(() => [...(a?.milestones ?? [])].sort(openFirst), [a?.milestones]);
  const deadlines = a ? [...a.overdueTasks, ...a.upcomingDeadlines] : [];
  const description = project.description?.trim() || '';

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6 lg:px-10">
      <div className="-mb-2 flex flex-wrap items-center justify-end gap-2" data-print="hide">
        <LastUpdated at={fulfilledTimeStamp} onRefresh={refetch} refreshing={isFetching} className="mr-auto" />
        <PrintButton variant="ghost" size="sm" label="Print summary" />
      </div>
      {/* Lead with what matters most: when it will finish, what holds it up, and the next move. */}
      <DeliveryForecastCard project={project} data={forecast} />
      <SupportingMetrics data={forecast} />
      <MyForecastCard project={project} />

      {/* The project as a block of snowpack (the front page's picture, from this project's tasks);
          each layer opens its tasks as a grouped, sorted list. */}
      <ProjectSnowpackCard projectId={project.id} tasks={forecast.tasks} dependencies={forecast.dependencies} loading={forecast.loading} onOpen={setPop} />

      <ForecastCard project={project} />

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <SummaryCard
          title="About this project"
          viewAll={description.length > LONG_DESCRIPTION ? { label: 'Read the full description', onClick: () => setPop('ABOUT') } : { label: `Open all ${c.total} tasks`, to: 'tasks' }}
        >
          {description ? <RichText text={description} projectId={project.id} className="line-clamp-4 text-[13.5px]" /> : <p className="text-[13.5px] text-muted">No description yet.</p>}
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 text-[13px]">
            <Fact label="Owner">
              <Avatar user={project.owner} size="xs" /> <span className="truncate">{project.owner.name}</span>
            </Fact>
            <Fact label="Tasks">
              <span className="tabular">{c.total}</span>
            </Fact>
            <Fact label="Start">{formatDate(project.startDate)}</Fact>
            <Fact label="Deadline">{formatDate(project.deadline)}</Fact>
          </dl>
        </SummaryCard>

        {a ? (
          <HealthCard className="h-full" rulesInFooter health={a.health} reasons={a.healthReasons} progress={a.progress} expected={project.status === 'ACTIVE' ? a.expectedProgress : null} color={project.color} />
        ) : (
          <Skeleton className="h-full min-h-56 w-full rounded-lg" />
        )}

        <SummaryCard
          title="Deadlines"
          description={a ? `${a.overdueTasks.length} overdue, ${a.upcomingDeadlines.length} due in the next 14 days` : 'Open tasks due soon'}
          viewAll={deadlines.length ? { label: `View all ${deadlines.length}, grouped by date`, onClick: () => setPop('DEADLINES') } : { label: 'Open the timeline', to: 'timeline' }}
          bodyClassName="py-1"
        >
          {isLoading ? (
            <Skeleton className="my-2 h-40 w-full" />
          ) : isError ? (
            <ErrorState error={error} onRetry={refetch} />
          ) : deadlines.length ? (
            <MiniTaskList tasks={deadlines.slice(0, PREVIEW)} showAssignee />
          ) : (
            <CardEmpty>Nothing is overdue or due in the next two weeks.</CardEmpty>
          )}
        </SummaryCard>

        <SummaryCard
          title="Milestones"
          description={a ? `${milestones.filter((m) => m.completed).length} of ${milestones.length} completed` : undefined}
          viewAll={milestones.length ? { label: `View all ${milestones.length}`, onClick: () => setPop('MILESTONES') } : { label: 'Add milestones', to: 'milestones' }}
        >
          {!a ? (
            <Skeleton className="h-40 w-full" />
          ) : milestones.length ? (
            <MilestoneRows items={milestones.slice(0, PREVIEW)} />
          ) : (
            <CardEmpty>No milestones yet. They group tasks into checkpoints.</CardEmpty>
          )}
        </SummaryCard>

        <SummaryCard
          title="Team"
          description={`${members.length} ${members.length === 1 ? 'person' : 'people'}, by role`}
          action={
            <Button variant="ghost" size="xs" leftIcon={<Info />} onClick={() => setPop('ROLES')}>
              Roles explained
            </Button>
          }
          viewAll={{ label: `View all ${members.length}, grouped by role`, onClick: () => setPop('TEAM') }}
          bodyClassName="py-1"
        >
          <MemberRows items={members.slice(0, PREVIEW)} />
        </SummaryCard>

        <SummaryCard title="Recent activity" viewAll={{ label: 'View more activity', onClick: () => setPop('ACTIVITY') }}>
          {activity ? activity.content.length ? <ActivityList items={activity.content} compact /> : <CardEmpty>Nothing has happened yet.</CardEmpty> : <Skeleton className="h-40 w-full" />}
        </SummaryCard>
      </div>

      {/* Pop-ups ------------------------------------------------------------------------------ */}
      <TaskGroupsDialog
        key={pop ?? 'none'}
        open={taskPop}
        onOpenChange={close}
        title={pop === 'OVERDUE' ? 'Overdue tasks' : pop === 'DEADLINES' ? 'Deadlines: overdue and the next 14 days' : taskPop ? STATUS_LABEL[pop as TaskStatus] : ''}
        description={pop === 'OVERDUE' ? 'Not done, and the due date has passed.' : pop === 'DEADLINES' ? undefined : 'Every task in this column, grouped and sorted by due date.'}
        tasks={popTasks}
        initialGroup={pop === 'OVERDUE' || pop === 'DEADLINES' ? 'due' : 'person'}
        showStatus={pop === 'OVERDUE' || pop === 'DEADLINES'}
        listLink={pop === 'OVERDUE' ? 'tasks?due=overdue' : pop === 'DEADLINES' ? 'tasks?due=week' : `tasks?status=${pop}`}
      />

      <Dialog open={pop === 'ABOUT'} onOpenChange={close} title="About this project" size="lg">
        <RichText text={description} projectId={project.id} />
      </Dialog>

      <Dialog
        open={pop === 'MILESTONES'}
        onOpenChange={close}
        title="Milestones"
        description="Open milestones first, soonest due first; then completed ones."
        footer={
          <Link to="milestones" className="text-[12.5px] font-medium text-accent hover:underline">
            Manage milestones
          </Link>
        }
      >
        <MilestoneRows items={milestones} />
      </Dialog>

      <Dialog
        open={pop === 'TEAM'}
        onOpenChange={close}
        title="Team"
        description="Grouped by role. What each person can do comes from their role in this project."
        size="lg"
        footer={
          <Link to="team" className="text-[12.5px] font-medium text-accent hover:underline">
            Manage the team
          </Link>
        }
      >
        <div className="space-y-4">
          {ROLES.map((role) => {
            const people = members.filter((m) => m.role === role);
            if (!people.length) return null;
            return (
              <section key={role} className="overflow-hidden rounded-lg border border-line">
                <header className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
                  <h3 className="text-[13px] font-semibold text-ink">{ROLE_LABEL[role]}</h3>
                  <span className="truncate text-xs text-muted">{ROLE_DESCRIPTION[role]}</span>
                  <span className="ml-auto rounded-full bg-surface-3 px-2 text-xs font-medium text-muted tabular">{people.length}</span>
                </header>
                <div className="px-3 py-1">
                  <MemberRows items={people} />
                </div>
              </section>
            );
          })}
        </div>
      </Dialog>

      <Dialog
        open={pop === 'ACTIVITY'}
        onOpenChange={close}
        title="Recent activity"
        description="The latest 40 changes, newest first."
        size="lg"
        footer={
          <Link to="activity" className="text-[12.5px] font-medium text-accent hover:underline">
            Open the full history
          </Link>
        }
      >
        {allActivity ? <ActivityList items={allActivity.content} compact /> : <Skeleton className="h-60 w-full" />}
      </Dialog>

      <RoleGuideDialog open={pop === 'ROLES'} onOpenChange={close} myRole={project.myRole} projectName={project.name} />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 flex items-center gap-1.5 font-medium text-ink">{children}</dd>
    </div>
  );
}

function MilestoneRows({ items }: { items: Milestone[] }) {
  return (
    <ul className="space-y-4">
      {items.map((m) => (
        <li key={m.id}>
          <div className="flex items-center justify-between gap-2 text-[13px]">
            <span className="flex min-w-0 items-center gap-1.5 font-medium text-ink">
              {m.completed ? <CheckCircle2 className="size-4 shrink-0 text-success" aria-label="Completed" /> : <Flag className="size-4 shrink-0 text-muted" aria-hidden="true" />}
              <span className="truncate">{m.name}</span>
            </span>
            <span className="shrink-0 text-xs text-muted">{m.completed ? formatDate(m.dueDate, 'd MMM') : dueRelative(m.dueDate)}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <ProgressBar value={m.progress} color={m.completed ? 'var(--success)' : undefined} label={`${m.name} progress`} />
            <span className="w-12 shrink-0 text-right text-xs text-muted tabular">
              {m.doneCount}/{m.taskCount}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function MemberRows({ items }: { items: Member[] }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((m) => (
        <li key={m.id} className="flex items-center gap-3 py-2">
          <Avatar user={m.user} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink">{m.user.name}</p>
            <p className="truncate text-xs text-muted">
              {m.openTaskCount} open {m.openTaskCount === 1 ? 'task' : 'tasks'}
            </p>
          </div>
          <RoleBadge role={m.role} />
        </li>
      ))}
    </ul>
  );
}
