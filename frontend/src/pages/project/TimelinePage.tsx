import { addDays, differenceInCalendarDays, eachDayOfInterval, format, isMonday, parseISO, startOfDay } from 'date-fns';
import { CalendarRange, Flag, Lock } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { useBoardTasksQuery, useDependenciesQuery, useMilestonesQuery } from '@/api/endpoints';
import type { Milestone, Task } from '@/api/types';
import { Avatar } from '@/components/ui/Avatar';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Spinner';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { useProjectContext } from '@/features/projects/projectContext';
import { cn } from '@/lib/cn';
import { STATUS_COLOR, STATUS_LABEL } from '@/lib/constants';
import { formatDate, todayIso } from '@/lib/dates';
import { buildIndex, openBlockers } from '@/lib/dependencies';
import { useDocumentTitle, useUrlState } from '@/lib/hooks';

const ZOOM = { week: 26, month: 10, quarter: 4 } as const;
type Zoom = keyof typeof ZOOM;
const LABEL_W = 300;
const ROW_H = 40;

/** Local calendar day for an ISO date or instant. */
const dayOf = (iso: string) => startOfDay(parseISO(iso.length === 10 ? `${iso}T00:00:00` : iso));

interface Group {
  id: string;
  milestone: Milestone | null;
  tasks: Task[];
}

/**
 * Project timeline: one row per task, grouped by milestone, on a shared date axis with a
 * Today rule and the project deadline. It draws only recorded dates — when a task was
 * created, started, approved and when it is due. Estimated schedules belong to the Plan tab,
 * where they are labelled as estimates; this view never draws a planned duration.
 */
export function TimelinePage() {
  const { project } = useProjectContext();
  useDocumentTitle(`${project.name} · Timeline`);
  const [f, setF] = useUrlState({ zoom: 'month', done: '' });
  const zoom: Zoom = f.zoom === 'week' || f.zoom === 'quarter' ? f.zoom : 'month';
  const hideDone = f.done === 'hide';
  const px = ZOOM[zoom];

  const { data: tasks, isLoading, isError, error, refetch } = useBoardTasksQuery(project.id);
  const { data: milestones } = useMilestonesQuery(project.id);
  const { data: deps } = useDependenciesQuery(project.id);
  const index = useMemo(() => buildIndex(deps ?? []), [deps]);
  const today = dayOf(todayIso());

  const shown = useMemo(() => (tasks ?? []).filter((t) => !(hideDone && t.status === 'DONE')), [tasks, hideDone]);

  const groups = useMemo<Group[]>(() => {
    const ms = [...(milestones ?? [])].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const byDue = (a: Task, b: Task) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.key.localeCompare(b.key, undefined, { numeric: true });
    const out: Group[] = ms.map((m) => ({ id: `m-${m.id}`, milestone: m, tasks: shown.filter((t) => t.milestoneId === m.id).sort(byDue) }));
    out.push({ id: 'none', milestone: null, tasks: shown.filter((t) => !t.milestoneId || !ms.some((m) => m.id === t.milestoneId)).sort(byDue) });
    return out.filter((g) => g.tasks.length > 0 || (g.milestone && !(hideDone && g.milestone.completed)));
  }, [milestones, shown, hideDone]);

  const range = useMemo(() => {
    const dates: Date[] = [dayOf(project.startDate), today];
    if (project.deadline) dates.push(dayOf(project.deadline));
    for (const t of shown) {
      dates.push(dayOf(t.createdAt));
      if (t.dueDate) dates.push(dayOf(t.dueDate));
      if (t.completedAt) dates.push(dayOf(t.completedAt));
    }
    for (const m of milestones ?? []) dates.push(dayOf(m.dueDate));
    const min = new Date(Math.min(...dates.map((d) => d.getTime())));
    const max = new Date(Math.max(...dates.map((d) => d.getTime())));
    return { start: addDays(min, -3), end: addDays(max, 7) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, milestones, project.startDate, project.deadline]);

  const x = (d: Date) => differenceInCalendarDays(d, range.start) * px;
  const width = (differenceInCalendarDays(range.end, range.start) + 1) * px;
  const days = eachDayOfInterval({ start: range.start, end: range.end });

  // Month names at the first of each month (and at the start if a month began earlier). A label is
  // dropped when the next one would start within its width, so names never run together.
  const monthLabels = (() => {
    const fmt = zoom === 'quarter' ? 'MMM yyyy' : 'MMMM';
    const starts = days.filter((d, i) => d.getDate() === 1 || i === 0);
    const out: { key: string; label: string; left: number }[] = [];
    starts.forEach((d, i) => {
      const label = format(d, fmt);
      const left = x(d);
      const next = starts[i + 1];
      const room = next ? x(next) - left : Number.POSITIVE_INFINITY;
      if (room >= label.length * 8 + 16) out.push({ key: d.toISOString(), label, left });
    });
    return out;
  })();

  const marks = [
    { label: 'Today', date: today, className: 'border-accent bg-surface text-accent' },
    ...(project.deadline ? [{ label: 'Deadline', date: dayOf(project.deadline), className: 'border-dashed border-ink bg-surface text-ink' }] : []),
  ];

  const header = (
    <div className="sticky top-0 z-20 flex border-b border-line bg-surface" style={{ width: LABEL_W + width }}>
      <div className="caps sticky left-0 z-10 flex h-16 shrink-0 items-end border-r border-line bg-surface px-4 pb-2 text-[11px] text-muted" style={{ width: LABEL_W }}>
        Task
      </div>
      {/* Three rows: months on top, Today/Deadline in the middle, day ticks at the bottom. */}
      <div className="relative h-16" style={{ width }}>
        {monthLabels.map((m) => (
          <span key={m.key} className="caps absolute top-2 text-[11px] whitespace-nowrap text-ink" style={{ left: m.left + 4 }}>
            {m.label}
          </span>
        ))}
        {days.map((d) => {
          const tick = zoom === 'week' ? true : zoom === 'month' ? isMonday(d) : d.getDate() === 1;
          if (!tick) return null;
          return (
            <div key={d.toISOString()} className="absolute top-0 bottom-0" style={{ left: x(d) }}>
              <span className="absolute bottom-1.5 left-1 text-[11px] text-muted tabular">{format(d, 'd')}</span>
              <span className="absolute bottom-0 h-1.5 w-px bg-line-strong" aria-hidden="true" />
            </div>
          );
        })}
        {/* Labels for the vertical rules live in the sticky header so they stay visible while scrolling. */}
        {marks.map((m) => (
          <span
            key={m.label}
            className={cn('caps absolute top-[26px] z-10 border-l px-1 text-[9px] whitespace-nowrap', m.className)}
            style={{ left: x(m.date) + px / 2 }}
          >
            {m.label}
          </span>
        ))}
      </div>
    </div>
  );

  const rule = (d: Date, className: string) => (
    <div className={cn('pointer-events-none absolute top-0 bottom-0 z-10 w-px', className)} style={{ left: LABEL_W + x(d) + px / 2 }} aria-hidden="true" />
  );

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6 lg:px-10">
      <div className="flex flex-col gap-4 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="font-display text-[26px] leading-tight font-semibold tracking-[-0.03em] text-ink">
            {format(range.start, 'd MMM')} – {format(range.end, 'd MMM yyyy')}
          </h2>
          <p className="mt-2 max-w-3xl text-[13px] text-muted">
            Drawn from recorded dates only: created, started, approved and due. A bar never shows a planned duration; estimated schedules are on the{' '}
            <Link to={`/projects/${project.id}/plan`} className="text-accent hover:underline">
              Plan
            </Link>{' '}
            tab.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Zoom"
            value={zoom}
            onChange={(v) => setF({ zoom: v })}
            options={[
              { value: 'week', label: 'Days' },
              { value: 'month', label: 'Weeks' },
              { value: 'quarter', label: 'Months' },
            ]}
          />
          <label className="flex h-9 items-center gap-2 border border-line-strong bg-surface px-3 text-[13px] text-ink">
            <input type="checkbox" checked={hideDone} onChange={(e) => setF({ done: e.target.checked ? 'hide' : '' })} className="size-4 accent-[var(--brand)]" />
            Hide completed
          </label>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-96" />
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : shown.length === 0 ? (
        <EmptyState icon={CalendarRange} title={hideDone ? 'Everything here is complete' : 'No tasks yet'} description={hideDone ? 'Untick “Hide completed” to see finished work.' : 'Tasks appear here once they are created.'} />
      ) : (
        <>
          <div className="scrollbar-thin relative overflow-auto border border-line bg-surface" style={{ maxHeight: '72vh' }}>
            <div className="relative" style={{ width: LABEL_W + width }}>
              {header}
              {rule(today, 'bg-accent')}
              {project.deadline && rule(dayOf(project.deadline), 'border-l border-dashed border-ink')}

              {groups.map((g) => (
                <div key={g.id} role="group" aria-label={g.milestone ? `Milestone ${g.milestone.name}` : 'No milestone'}>
                  <div className="flex border-b border-line bg-surface-2/70" style={{ height: ROW_H }}>
                    <div className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-line bg-surface-2 px-4" style={{ width: LABEL_W }}>
                      {g.milestone ? <Flag className="size-3.5 shrink-0 text-accent" aria-hidden="true" /> : null}
                      <span className="caps truncate text-[11px] text-ink">{g.milestone ? g.milestone.name : 'No milestone'}</span>
                      {g.milestone && (
                        <span className="ml-auto text-[12px] text-muted tabular">
                          {g.milestone.doneCount}/{g.milestone.taskCount}
                        </span>
                      )}
                    </div>
                    <div className="relative" style={{ width }}>
                      {g.milestone && (
                        <span
                          className={cn('absolute top-1/2 size-3 -translate-y-1/2 rotate-45 border', g.milestone.completed ? 'border-success bg-success' : dayOf(g.milestone.dueDate) < today ? 'border-danger bg-surface' : 'border-accent bg-surface')}
                          style={{ left: x(dayOf(g.milestone.dueDate)) + px / 2 - 6 }}
                          title={`${g.milestone.name}, due ${formatDate(g.milestone.dueDate)}${g.milestone.completed ? ', completed' : ''}`}
                        />
                      )}
                    </div>
                  </div>
                  {g.tasks.map((t) => (
                    <TaskRow key={t.id} task={t} x={x} px={px} width={width} today={today} blockers={openBlockers(index, t.id).map((b) => b.key)} />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <Legend />
        </>
      )}
    </div>
  );
}

function TaskRow({ task: t, x, px, width, today, blockers }: { task: Task; x: (d: Date) => number; px: number; width: number; today: Date; blockers: string[] }) {
  const created = dayOf(t.createdAt);
  const started = t.startedAt ? dayOf(t.startedAt) : null;
  const done = t.completedAt ? dayOf(t.completedAt) : null;
  const due = t.dueDate ? dayOf(t.dueDate) : null;
  const workEnd = done ?? today;
  const late = due && !done && due < today;
  const summary = [
    `${t.key} ${t.title}: ${STATUS_LABEL[t.status]}.`,
    `Created ${format(created, 'd MMM')}.`,
    started ? `Started ${format(started, 'd MMM')}.` : 'Not started.',
    due ? `Due ${format(due, 'd MMM')}.` : 'No due date.',
    done ? `Approved ${format(done, 'd MMM')}.` : '',
    late ? 'Overdue.' : '',
    blockers.length ? `Waiting on ${blockers.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="group flex border-b border-line hover:bg-surface-2/50" style={{ height: ROW_H }}>
      <Link
        to={`/projects/${t.projectId}/tasks/${t.id}`}
        className="sticky left-0 z-10 flex shrink-0 items-center gap-2.5 border-r border-line bg-surface px-4 group-hover:bg-surface-2"
        style={{ width: LABEL_W }}
      >
        <span className="w-14 shrink-0 font-mono text-[12px] text-muted">{t.key}</span>
        <span className={cn('min-w-0 flex-1 truncate text-[13px]', t.status === 'DONE' ? 'text-muted' : 'text-ink')}>{t.title}</span>
        {blockers.length > 0 && <Lock className="size-3 shrink-0 text-muted" aria-label={`Waiting on ${blockers.join(', ')}`} />}
        <Avatar user={t.assignee} size="sm" />
      </Link>
      <div className="relative" style={{ width }} title={summary}>
        <span className="sr-only">{summary}</span>
        {/* The window the task has had: created → due. */}
        {due && due >= created && <span className="absolute top-1/2 h-px bg-line-strong" style={{ left: x(created) + px / 2, width: Math.max(1, x(due) - x(created)) }} aria-hidden="true" />}
        {/* Recorded work: started → approved (or today). */}
        {started && workEnd >= started && (
          <span
            className="absolute top-1/2 h-3 -translate-y-1/2"
            style={{ left: x(started) + px / 2, width: Math.max(px / 2, x(workEnd) - x(started)), backgroundColor: STATUS_COLOR[t.status], opacity: t.status === 'DONE' ? 0.55 : 0.9 }}
            aria-hidden="true"
          />
        )}
        {/* Overdue stretch: due → today. */}
        {late && (
          <span
            className="absolute top-1/2 h-1 -translate-y-1/2 bg-danger"
            style={{ left: x(due!) + px / 2, width: Math.max(2, x(today) - x(due!)) }}
            aria-hidden="true"
          />
        )}
        {due && <span className={cn('absolute top-2.5 bottom-2.5 w-0.5', late ? 'bg-danger' : 'bg-ink')} style={{ left: x(due) + px / 2 - 1 }} aria-hidden="true" />}
        {!due && !started && <span className="absolute top-1/2 -translate-y-1/2 text-[12px] text-subtle" style={{ left: x(created) + px / 2 + 4 }}>no due date</span>}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <p className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted">
      <span className="inline-flex items-center gap-2">
        <span className="h-px w-6 bg-line-strong" aria-hidden="true" /> created → due
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="h-3 w-6" style={{ backgroundColor: STATUS_COLOR.IN_PROGRESS }} aria-hidden="true" /> started → approved (or today), coloured by status
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="h-3 w-0.5 bg-ink" aria-hidden="true" /> due date
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="h-1 w-6 bg-danger" aria-hidden="true" /> overdue
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="size-2.5 rotate-45 border border-accent" aria-hidden="true" /> milestone
      </span>
      <span className="inline-flex items-center gap-2">
        <Lock className="size-3" aria-hidden="true" /> waiting on another task
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="h-3 w-px bg-accent" aria-hidden="true" /> today
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="h-3 border-l border-dashed border-ink" aria-hidden="true" /> project deadline
      </span>
    </p>
  );
}
