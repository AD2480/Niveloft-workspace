import { CheckCircle2, Flag, FolderKanban, Plus, Sparkles } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useDashboardQuery } from '@/api/endpoints';
import type { DashboardData, Health } from '@/api/types';
import { useAppSelector } from '@/app/store';
import { PageContainer } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { LastUpdated } from '@/components/ui/LastUpdated';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Spinner';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { ApprovedList, AttentionList } from '@/features/dashboard/AttentionList';
import { CatchUp } from '@/features/dashboard/CatchUp';
import { FirstSteps } from '@/features/dashboard/FirstSteps';
import { ProjectSnowpacks } from '@/features/dashboard/ProjectSnowpacks';
import { CardFooterAction } from '@/features/overview/SummaryCard';
import { PendingInvitations } from '@/features/projects/InvitationList';
import { ProjectFormDialog } from '@/features/projects/ProjectFormDialog';
import { MiniTaskList } from '@/features/tasks/MiniTaskList';
import { cn } from '@/lib/cn';
import { daysUntil } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';

/** How many project cards Today shows (the rest are a click away). */
const MAX_PROJECTS = 8;
const HEALTH_ORDER: Health[] = ['OFF_TRACK', 'AT_RISK', 'ON_TRACK', 'NOT_STARTED', 'COMPLETED'];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The day in two sentences: what needs a decision, then what's waiting on you. */
export function todaySummary(data: DashboardData): string {
  const n = data.attention.length;
  const now = data.attention.filter((a) => a.severity === 'HIGH').length;
  const first =
    n === 0
      ? 'Nothing needs a decision right now.'
      : now
        ? `${plural(now, 'thing needs', 'things need')} a decision now${n - now ? `, and ${n - now} more can wait a little` : ''}.`
        : `${plural(n, 'thing needs', 'things need')} a decision, none of them urgent.`;
  const { awaitingMyReview: reviews, myOpenTasks: open, myOverdueTasks: late } = data.stats;
  const tasks = open ? `${plural(open, 'open task', 'open tasks')} of yours${late ? `, ${late} of them late` : ''}` : 'no open tasks of yours';
  const second = reviews
    ? `${plural(reviews, 'review is', 'reviews are')} waiting for you, and there ${open === 1 ? 'is' : 'are'} ${tasks}.`
    : `There ${open === 1 ? 'is' : 'are'} ${tasks}.`;
  return `${first} ${second}`;
}

/**
 * Today: what needs a decision, what's next for you, and every project you're in as a block of
 * snowpack. Everything here comes from the records; nothing is estimated.
 */
export function DashboardPage() {
  useDocumentTitle('Today');
  const navigate = useNavigate();
  const user = useAppSelector((s) => s.auth.user);
  const { data, isLoading, isFetching, isError, error, refetch, fulfilledTimeStamp } = useDashboardQuery();
  const [creating, setCreating] = useState(false);
  const projects = useMemo(
    () => [...(data?.projects ?? [])].sort((a, b) => HEALTH_ORDER.indexOf(a.health) - HEALTH_ORDER.indexOf(b.health)).slice(0, MAX_PROJECTS),
    [data?.projects],
  );

  return (
    <PageContainer>
      <PageHeader
        eyebrow={new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        title={`${greeting()}, ${user?.name.split(' ')[0] ?? 'there'}`}
        description={data ? todaySummary(data) : undefined}
        actions={
          <>
            <LastUpdated at={fulfilledTimeStamp} onRefresh={refetch} refreshing={isFetching} className="mr-1" />
            <Button leftIcon={<Plus />} onClick={() => setCreating(true)}>
              New project
            </Button>
          </>
        }
      />

      <div className="space-y-10">
        <PendingInvitations />
        <CatchUp />
        {user && data && <FirstSteps userId={user.id} projects={data.projects.length} myOpenTasks={data.stats.myOpenTasks} onCreateProject={() => setCreating(true)} />}

        {isLoading ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-[290px] rounded-xl" />
              ))}
            </div>
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
              <Skeleton className="h-96 rounded-xl" />
              <Skeleton className="h-96 rounded-xl" />
            </div>
          </>
        ) : isError || !data ? (
          <ErrorState error={error} onRetry={refetch} title="Couldn’t load Today" />
        ) : (
          <>
            <section aria-labelledby="projects-heading">
              <SectionHead
                id="projects-heading"
                title="Your projects"
                note="Each block is a project’s tasks as layers of snow: approved at the base, then in review, in progress and not started on top. Red is late work."
                action={
                  data.projects.length > 0 && (
                    <Link to="/projects" className="shrink-0 text-[13px] font-medium text-accent hover:underline">
                      {data.projects.length > MAX_PROJECTS ? `All ${data.projects.length} projects` : 'All projects'}
                    </Link>
                  )
                }
              />
              {data.projects.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={FolderKanban}
                    title="No active projects"
                    description="Projects you own or were added to appear here, each as a block of its tasks."
                    action={
                      <Button size="sm" leftIcon={<Plus />} onClick={() => setCreating(true)}>
                        Create a project
                      </Button>
                    }
                  />
                </Card>
              ) : (
                <ProjectSnowpacks projects={projects} />
              )}
            </section>

            <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_360px] xl:gap-10">
              <section aria-labelledby="attention-heading" className="min-w-0">
                <SectionHead
                  id="attention-heading"
                  title="Needs you"
                  note={data.attention.length ? 'Each item names the rule that raised it and links to the records behind it. Nothing here is estimated.' : undefined}
                />
                {data.attention.length ? (
                  <AttentionList items={data.attention} />
                ) : (
                  <Card>
                    <EmptyState
                      icon={Sparkles}
                      title="Nothing needs a decision"
                      description="No reviews waiting, nothing late, no changes requested, and no project or milestone at risk."
                      compact
                    />
                  </Card>
                )}
              </section>

              <aside className="space-y-6" aria-label="Your work">
                <Card>
                  <CardHeader title="Up next for you" description="Open tasks assigned to you, soonest due first." />
                  <div className="px-2 pt-1 pb-2 sm:px-3">
                    {data.myTasks.length ? <MiniTaskList tasks={data.myTasks} showProject /> : <p className="px-2 py-5 text-[13px] text-muted">Nothing is assigned to you.</p>}
                  </div>
                  <CardFooterAction label="All my tasks" to="/my-tasks" />
                </Card>

                <Card>
                  <CardHeader title="Next three weeks" description="Your projects’ deadlines and milestones." />
                  {data.upcoming.length ? (
                    <ul className="px-2 pt-1 pb-2 sm:px-3">
                      {data.upcoming.map((u) => {
                        const n = daysUntil(u.date);
                        return (
                          <li key={`${u.type}-${u.id}`}>
                            <Link to={u.link} className="group flex items-center gap-3.5 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2/70">
                              <span
                                className={cn(
                                  'flex w-11 shrink-0 flex-col items-center rounded-lg border py-1 leading-none',
                                  u.overdue
                                    ? 'border-danger/30 bg-danger-soft text-danger'
                                    : n <= 2
                                      ? 'border-warning/30 bg-warning-soft text-warning'
                                      : 'border-line bg-surface-2 text-ink',
                                )}
                              >
                                <span className="reading text-[17px]">{Number(u.date.slice(8))}</span>
                                <span className="mt-0.5 text-[11px] font-medium">{new Date(`${u.date}T00:00:00`).toLocaleString('en', { month: 'short' })}</span>
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-1.5 text-[13.5px] font-medium text-ink group-hover:text-brand-ink">
                                  {u.type === 'MILESTONE' && <Flag className="size-3.5 shrink-0 text-muted" aria-label="Milestone" />}
                                  <span className="truncate">{u.title}</span>
                                </span>
                                <span className="mt-0.5 flex min-w-0 gap-2 text-[12.5px] text-muted">
                                  {u.overdue && <span className="shrink-0 font-medium text-danger">{n === -1 ? '1 day late' : `${-n} days late`}</span>}
                                  {u.key && <span className="shrink-0 tabular">{u.key}</span>}
                                  <span className="truncate">{u.projectName}</span>
                                </span>
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="px-5 pt-2 pb-5 text-[13px] text-muted">No deadlines or milestones in the next three weeks.</p>
                  )}
                </Card>

                <Card>
                  <CardHeader title="Approved recently" description="The last 14 days, and the evidence each was approved on." />
                  {data.recentlyApproved.length ? (
                    <div className="pt-1">
                      <ApprovedList items={data.recentlyApproved} />
                    </div>
                  ) : (
                    <p className="flex items-center gap-2 px-5 pt-2 pb-5 text-[13px] text-muted">
                      <CheckCircle2 className="size-4" aria-hidden="true" />
                      Nothing was approved in the last 14 days.
                    </p>
                  )}
                </Card>
              </aside>
            </div>
          </>
        )}
      </div>
      <ProjectFormDialog open={creating} onOpenChange={setCreating} onSaved={(p) => navigate(`/projects/${p.id}`)} />
    </PageContainer>
  );
}

function SectionHead({ id, title, note, action }: { id: string; title: string; note?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-6">
      <div className="min-w-0">
        <h2 id={id} className="text-[18px] font-semibold tracking-[-0.012em] text-ink">
          {title}
        </h2>
        {note && <p className="mt-1 max-w-[80ch] text-[13px] leading-relaxed text-muted">{note}</p>}
      </div>
      {action}
    </div>
  );
}
