import { Plus, Users } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useProjectQuery } from '@/api/endpoints';
import { errorStatus } from '@/api/errors';
import type { Health, ProjectStatus } from '@/api/types';
import { HEALTH_COLOR, ProjectMark } from '@/components/domain';
import { Button } from '@/components/ui/Button';
import { lateOf, StrataBar, strataOf } from '@/components/ui/StrataBar';
import { Skeleton } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/States';
import type { ProjectOutletContext } from '@/features/projects/projectContext';
import { NEW_TASK_EVENT } from '@/features/keyboard/shortcuts';
import { TaskFormDialog } from '@/features/tasks/TaskFormDialog';
import { MyRoleButton } from '@/features/roles/RoleGuide';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import { can } from '@/lib/permissions';
import { NotFoundPage } from '../NotFoundPage';

/**
 * Eight chapters instead of twelve tabs. Each chapter owns one or more existing routes; chapters
 * with several routes show them as modes underneath (e.g. Work: Board · List).
 */
interface Chapter {
  numeral: string;
  label: string;
  /** Where the chapter link goes. */
  to: string;
  /** Route segments (first segment after /projects/:id) that belong to this chapter. */
  segments: string[];
  modes?: { to: string; label: string }[];
}

const CHAPTERS: Chapter[] = [
  {
    numeral: 'I',
    label: 'Overview',
    to: '',
    segments: ['', 'analytics', 'activity'],
    modes: [
      { to: '', label: 'Summary' },
      { to: 'analytics', label: 'Analytics' },
      { to: 'activity', label: 'Activity' },
    ],
  },
  {
    numeral: 'II',
    label: 'Work',
    to: 'board',
    segments: ['board', 'tasks'],
    modes: [
      { to: 'board', label: 'Board' },
      { to: 'tasks', label: 'List' },
    ],
  },
  { numeral: 'III', label: 'Delivery', to: 'delivery', segments: ['delivery'] },
  { numeral: 'IV', label: 'Graph', to: 'model', segments: ['model'] },
  { numeral: 'V', label: 'Prediction model', to: 'predictions', segments: ['predictions'] },
  {
    numeral: 'VI',
    label: 'Schedule',
    to: 'timeline',
    segments: ['timeline', 'map', 'plan', 'milestones'],
    modes: [
      { to: 'timeline', label: 'Timeline' },
      { to: 'map', label: 'Dependencies' },
      { to: 'plan', label: 'What if' },
      { to: 'milestones', label: 'Milestones' },
    ],
  },
  { numeral: 'VII', label: 'Documents', to: 'docs', segments: ['docs'] },
  { numeral: 'VIII', label: 'People', to: 'team', segments: ['team'] },
  { numeral: 'IX', label: 'Settings', to: 'settings', segments: ['settings'] },
];

const HEALTH_WORD: Record<Health, string> = {
  NOT_STARTED: 'Not started',
  ON_TRACK: 'On track',
  AT_RISK: 'At risk',
  OFF_TRACK: 'Off track',
  COMPLETED: 'Completed',
};

const STATUS_WORD: Record<ProjectStatus, string> = { ACTIVE: 'Active', ON_HOLD: 'On hold', COMPLETED: 'Completed', ARCHIVED: 'Archived' };

function ModesNav({ chapter, base }: { chapter: Chapter; base: string }) {
  return (
    <nav className="scrollbar-thin mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-4 py-2 sm:px-6 lg:px-10" aria-label={`${chapter.label} views`}>
      {chapter.modes!.map((m) => (
        <NavLink
          key={m.label}
          to={m.to ? `${base}/${m.to}` : base}
          end={m.to === '' || m.to === 'tasks'}
          className={({ isActive }) =>
            cn(
              'flex h-8 pointer-coarse:h-10 shrink-0 items-center rounded-md px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150',
              isActive
                ? 'bg-surface text-ink shadow-[0_1px_2px_hsl(var(--shadow-color)/0.1),0_0_0_1px_hsl(var(--shadow-color)/0.05)] dark:bg-surface-3 dark:shadow-none'
                : 'text-muted hover:bg-surface-3/60 hover:text-ink',
            )
          }
        >
          {m.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function ProjectLayout() {
  const { projectId } = useParams();
  const id = Number(projectId);
  const navigate = useNavigate();
  const location = useLocation();
  const { data: project, isLoading, isError, error, refetch } = useProjectQuery(id, { skip: !Number.isFinite(id) });
  const [newTask, setNewTask] = useState<{ open: boolean; defaults?: Parameters<ProjectOutletContext['openNewTask']>[0] }>({ open: false });
  useDocumentTitle(project?.name);

  // C (the keyboard layer) opens New task here, for people who can create tasks.
  const canCreate = !!project && can.createTask(project.myRole) && project.status !== 'ARCHIVED';
  useEffect(() => {
    if (!canCreate) return;
    const open = () => setNewTask({ open: true });
    window.addEventListener(NEW_TASK_EVENT, open);
    return () => window.removeEventListener(NEW_TASK_EVENT, open);
  }, [canCreate]);

  if (!Number.isFinite(id)) return <NotFoundPage />;

  if (isLoading) {
    return (
      <div className="border-b border-line">
        <div className="mx-auto max-w-[1600px] space-y-4 px-4 pt-6 pb-8 sm:px-6 lg:px-10">
          <Skeleton className="h-10 w-[28rem] max-w-full" />
          <Skeleton className="h-3 w-full max-w-xl" />
          <Skeleton className="h-2 w-full max-w-md rounded-full" />
        </div>
      </div>
    );
  }

  if (isError || !project) {
    const status = errorStatus(error);
    if (status === 404) return <NotFoundPage title="Project not found" description="It may have been deleted, or the link is wrong." />;
    if (status === 403) {
      return (
        <div className="mx-auto max-w-[1600px] px-4 py-16 sm:px-6 lg:px-10">
          <h1 className="display-wide text-[34px] text-ink">You aren’t a member of this project.</h1>
          <p className="mt-2 text-[14px] text-muted">Ask the owner or a manager to invite you.</p>
          <Button variant="secondary" className="mt-6" onClick={() => navigate('/projects')}>
            Back to projects
          </Button>
        </div>
      );
    }
    return <ErrorState error={error} onRetry={refetch} className="min-h-[60vh]" />;
  }

  const context: ProjectOutletContext = {
    project,
    openNewTask: (defaults) => setNewTask({ open: true, defaults }),
  };

  // Which chapter and mode are we in? Task pages (/tasks/:id…) belong to Work but no mode.
  const rest = location.pathname.replace(`/projects/${project.id}`, '').replace(/^\//, '');
  const segments = rest.split('/');
  const first = segments[0] ?? '';
  const deep = first === 'tasks' && segments.length > 1 && segments[1] !== '';
  const chapter = CHAPTERS.find((c) => c.segments.includes(first)) ?? CHAPTERS[0];
  const base = `/projects/${project.id}`;
  const expected = project.status === 'ACTIVE' ? project.expectedProgress : null;
  const TitleTag = deep ? 'p' : 'h1';

  const counts = project.taskCounts;
  return (
    <div>
      <div>
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-10">
          <div className={cn('flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between', deep ? 'pt-4 pb-4' : 'pt-5 pb-6')}>
            <div className="flex min-w-0 items-start gap-4">
              {!deep && <ProjectMark name={project.name} color={project.color} size="lg" className="mt-1 hidden sm:inline-flex" />}
              <div className="min-w-0">
                <TitleTag className={cn('break-words text-ink', deep ? 'font-display text-[19px] leading-tight font-semibold [font-stretch:106%]' : 'text-[28px] sm:text-[32px]')}>
                  {deep ? <Link to={base} className="transition-colors hover:text-accent">{project.name}</Link> : project.name}
                  {!deep && <span className="sr-only"> ({project.key})</span>}
                </TitleTag>
                {!deep && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13.5px] text-muted">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 font-medium',
                        project.health === 'OFF_TRACK' ? 'text-danger' : project.health === 'AT_RISK' ? 'text-warning' : 'text-ink-2',
                      )}
                    >
                      <span className="size-2 rounded-full" style={{ backgroundColor: HEALTH_COLOR[project.health] }} aria-hidden="true" />
                      {project.status === 'ACTIVE' ? HEALTH_WORD[project.health] : STATUS_WORD[project.status]}
                    </span>
                    <MyRoleButton role={project.myRole} projectName={project.name} className="-my-1" />
                    <span className="tabular">
                      {formatDate(project.startDate, 'd MMM')} – {project.deadline ? formatDate(project.deadline, 'd MMM yyyy') : 'no deadline'}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="size-3.5" aria-hidden="true" />
                      {project.memberCount} people
                    </span>
                    <span className="font-medium text-subtle">{project.key}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-end gap-6">
              {!deep && (
                // Counts, not effort: a small task and a big one count the same, so this says "tasks".
                <div className="w-full min-w-56 sm:w-64" data-project-count="">
                  <p className="flex items-baseline justify-between gap-3 text-[13px] text-muted">
                    <span>
                      <span className="reading text-[22px] text-ink">{counts.done}</span> of {counts.total} tasks approved
                    </span>
                    {counts.overdue > 0 && <span className="text-[12.5px] font-medium text-danger">{counts.overdue} late</span>}
                  </p>
                  <div className="relative mt-2.5">
                    <StrataBar counts={strataOf(counts)} late={lateOf(counts)} />
                    {expected !== null && (
                      <span className="absolute -top-1 -bottom-1 w-[2px] rounded-full bg-ink" style={{ left: `calc(${expected}% - 1px)` }} aria-hidden="true" />
                    )}
                  </div>
                  <p className="mt-2 text-[12px] text-muted">{expected !== null ? `${expected}% of the time to the deadline has passed` : 'No deadline set'}</p>
                </div>
              )}
              {can.createTask(project.myRole) && project.status !== 'ARCHIVED' && (
                <Button onClick={() => setNewTask({ open: true })} leftIcon={<Plus />} data-print="hide">
                  New task
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* The chapters stay under the top bar while the page scrolls. */}
      <div className="sticky top-14 z-10 border-b border-line bg-canvas/88 backdrop-blur-md supports-[backdrop-filter]:bg-canvas/75" data-print="hide" data-project-bar="">
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-10">
          <nav className="scrollbar-thin -mx-4 flex gap-7 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Project chapters">
            {CHAPTERS.map((c) => {
              const active = c === chapter;
              return (
                <Link
                  key={c.label}
                  to={c.to ? `${base}/${c.to}` : base}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex h-11 shrink-0 items-center gap-2 text-[14px] font-medium transition-colors',
                    active ? 'text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-[2px] after:rounded-full after:bg-accent' : 'text-muted hover:text-ink',
                  )}
                >
                  {c.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
      {/* A chapter's views, as a row of quiet tabs under the chapters (they scroll away with the page). */}
      {chapter.modes && !deep && (
        <div data-print="hide" data-project-modes="">
          <ModesNav chapter={chapter} base={base} />
        </div>
      )}

      {/* Keyed by project so per-project page state (e.g. saved plan scenarios) never carries over. */}
      <Suspense fallback={<div className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-10"><Skeleton className="h-96 rounded-lg" /></div>}>
        <Outlet key={context.project.id} context={context} />
      </Suspense>

      <TaskFormDialog open={newTask.open} onOpenChange={(open) => setNewTask((s) => ({ ...s, open }))} project={project} defaults={newTask.defaults} />
    </div>
  );
}
