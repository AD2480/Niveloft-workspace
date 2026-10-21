import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { CalendarDays, CalendarX, ChevronLeft, ChevronRight, Flag, List, Target } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useCalendarQuery, useProjectsQuery } from '@/api/endpoints';
import type { CalendarEvent } from '@/api/types';
import { PriorityIcon, StatusBadge } from '@/components/domain';
import { PageContainer } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Select } from '@/components/ui/Form';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/ui/Segmented';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { cn } from '@/lib/cn';
import { formatDate, parseLocalDate, todayIso } from '@/lib/dates';
import { useDocumentTitle, useUrlState } from '@/lib/hooks';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function EventChip({ e }: { e: CalendarEvent }) {
  const Icon = e.type === 'MILESTONE' ? Flag : e.type === 'PROJECT_DEADLINE' ? Target : null;
  return (
    <Link
      to={e.link}
      title={`${e.title} (${e.projectName})`}
      className={cn(
        'flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[12px] leading-4 font-medium transition-opacity hover:opacity-80',
        e.completed ? 'text-muted' : 'text-ink',
        e.overdue && 'ring-1 ring-danger/50',
      )}
      style={{ backgroundColor: `color-mix(in srgb, ${e.projectColor} ${e.type === 'TASK' ? 14 : 24}%, transparent)` }}
    >
      {Icon ? <Icon className="size-3 shrink-0" style={{ color: e.projectColor }} aria-hidden="true" /> : <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: e.projectColor }} aria-hidden="true" />}
      <span className="truncate">{e.title}</span>
    </Link>
  );
}

export function CalendarPage() {
  useDocumentTitle('Calendar');
  const [f, setF] = useUrlState({ month: format(new Date(), 'yyyy-MM'), project: '', mine: '', view: 'month', hide: '' });
  const view = f.view === 'agenda' ? 'agenda' : 'month';
  const hideDone = f.hide === 'done';
  const month = parseLocalDate(`${/^\d{4}-\d{2}$/.test(f.month) ? f.month : format(new Date(), 'yyyy-MM')}-01`);
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const today = todayIso();
  const [selected, setSelected] = useState<string>(today);

  const { data: projects } = useProjectsQuery({ size: 100 });
  const { data: events, isLoading, isFetching, isError, error, refetch } = useCalendarQuery({
    from: format(gridStart, 'yyyy-MM-dd'),
    to: format(gridEnd, 'yyyy-MM-dd'),
    projectId: f.project ? Number(f.project) : '',
    mine: f.mine === 'true' || undefined,
  });

  const byDate = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events ?? []) {
      if (hideDone && e.completed) continue;
      m.set(e.date, [...(m.get(e.date) ?? []), e]);
    }
    return m;
  }, [events, hideDone]);
  const hiddenCount = hideDone ? (events ?? []).filter((e) => e.completed).length : 0;

  const go = (delta: number) => setF({ month: format(addMonths(month, delta), 'yyyy-MM') });
  const selectedEvents = byDate.get(selected) ?? [];

  return (
    <PageContainer wide>
      <PageHeader title="Calendar" description="Task due dates, milestones and project deadlines." />

      <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="icon" onClick={() => go(-1)} aria-label="Previous month">
            <ChevronLeft />
          </Button>
          <Button variant="secondary" size="icon" onClick={() => go(1)} aria-label="Next month">
            <ChevronRight />
          </Button>
          <h2 className="ml-1 min-w-40 text-lg font-semibold text-ink" aria-live="polite">
            {format(month, 'MMMM yyyy')}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setF({ month: format(new Date(), 'yyyy-MM') });
              setSelected(today);
            }}
          >
            Today
          </Button>
          {isFetching && !isLoading && <Spinner className="size-4 text-muted" />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="View"
            value={view}
            onChange={(v) => setF({ view: v === 'month' ? '' : v })}
            options={[
              { value: 'month', label: 'Month', icon: <CalendarDays /> },
              { value: 'agenda', label: 'Agenda', icon: <List /> },
            ]}
          />
          <Select aria-label="Project" value={f.project} onChange={(e) => setF({ project: e.target.value })} className="w-52">
            <option value="">All projects</option>
            {projects?.content.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-[13px] text-ink transition-colors hover:border-ink">
            <input type="checkbox" checked={f.mine === 'true'} onChange={(e) => setF({ mine: e.target.checked ? 'true' : '' })} className="size-4 accent-[var(--brand)]" />
            Only my tasks
          </label>
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-[13px] text-ink transition-colors hover:border-ink">
            <input type="checkbox" checked={hideDone} onChange={(e) => setF({ hide: e.target.checked ? 'done' : '' })} className="size-4 accent-[var(--brand)]" />
            Hide completed
            {hiddenCount > 0 && <span className="text-xs text-muted tabular">({hiddenCount})</span>}
          </label>
        </div>
      </div>

      {isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : view === 'agenda' ? (
        <Agenda days={days.filter((d) => isSameMonth(d, month)).map((d) => format(d, 'yyyy-MM-dd'))} byDate={byDate} today={today} loading={isLoading} />
      ) : (
        <div className="mt-4 grid gap-6 xl:grid-cols-[1fr_320px]">
          <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
            <div className="grid grid-cols-7 border-b border-line bg-surface-2/60">
              {WEEKDAYS.map((d) => (
                <div key={d} className="px-2 py-2 text-center text-xs font-semibold text-muted">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7" role="grid" aria-label={format(month, 'MMMM yyyy')}>
              {days.map((d) => {
                const iso = format(d, 'yyyy-MM-dd');
                const list = byDate.get(iso) ?? [];
                const inMonth = isSameMonth(d, month);
                const isToday = iso === today;
                const isSelected = iso === selected;
                return (
                  <div
                    key={iso}
                    role="gridcell"
                    aria-selected={isSelected}
                    className={cn(
                      'min-h-16 border-r border-b border-line p-1 sm:min-h-28 sm:p-1.5 [&:nth-child(7n)]:border-r-0',
                      !inMonth && 'bg-surface-2/40',
                      isSelected && 'bg-brand-soft/40',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelected(iso)}
                      className={cn(
                        'mb-1 flex size-7 items-center justify-center rounded-full text-xs font-medium tabular',
                        'transition-colors',
                        isToday ? 'bg-brand text-white hover:bg-brand-hover dark:text-canvas' : inMonth ? 'text-ink hover:bg-surface-2' : 'text-subtle hover:bg-surface-2',
                      )}
                      aria-label={`${format(d, 'EEEE d MMMM')}${list.length ? `, ${list.length} items` : ''}`}
                    >
                      {format(d, 'd')}
                    </button>
                    {/* Desktop: chips. Mobile: dots. */}
                    <div className="hidden space-y-0.5 sm:block">
                      {list.slice(0, 3).map((e) => (
                        <EventChip key={e.id} e={e} />
                      ))}
                      {list.length > 3 && (
                        <button type="button" onClick={() => setSelected(iso)} className="px-1.5 text-[12px] font-medium text-muted hover:text-ink">
                          +{list.length - 3} more
                        </button>
                      )}
                    </div>
                    {list.length > 0 && (
                      <div className="flex flex-wrap gap-0.5 px-1 sm:hidden" aria-hidden="true">
                        {list.slice(0, 4).map((e) => (
                          <span key={e.id} className="size-1.5 rounded-full" style={{ backgroundColor: e.projectColor }} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <Card className="self-start xl:sticky xl:top-20">
            <CardHeader title={formatDate(selected, 'EEEE, d MMMM')} description={`${selectedEvents.length} item${selectedEvents.length === 1 ? '' : 's'}`} />
            <CardBody className="py-2">
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Spinner />
                </div>
              ) : selectedEvents.length === 0 ? (
                <EmptyState icon={CalendarX} title="Nothing scheduled" description="Pick another day to see its items." compact />
              ) : (
                <ul className="divide-y divide-line">
                  {selectedEvents.map((e) => (
                    <li key={e.id}>
                      <Link to={e.link} className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-2/70">
                        <span className="mt-1 size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: e.projectColor }} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className={cn('block text-[13px] font-medium text-ink', e.completed && 'text-muted')}>{e.title}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                            {e.type === 'TASK' && e.status ? <StatusBadge status={e.status} /> : <span className="font-medium">{e.type === 'MILESTONE' ? 'Milestone' : 'Project deadline'}</span>}
                            <span className="truncate">{e.projectName}</span>
                            {e.overdue && <span className="font-medium text-danger">Overdue</span>}
                          </span>
                        </span>
                        {e.priority && <PriorityIcon priority={e.priority} />}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}

/** Agenda: the month as a list of days that have something on them, today marked. */
function Agenda({ days, byDate, today, loading }: { days: string[]; byDate: Map<string, CalendarEvent[]>; today: string; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }
  const withItems = days.filter((d) => (byDate.get(d)?.length ?? 0) > 0);
  if (withItems.length === 0) {
    return <EmptyState className="mt-10" icon={CalendarX} title="Nothing this month" description="No due dates, milestones or deadlines match these filters." />;
  }
  return (
    <ol className="mt-6 border-t border-line">
      {withItems.map((d) => {
        const list = byDate.get(d)!;
        const isToday = d === today;
        const past = d < today;
        return (
          <li key={d} className={cn('grid grid-cols-[88px_1fr] gap-6 border-b border-line py-5 sm:grid-cols-[120px_1fr]', past && 'opacity-80')} aria-current={isToday ? 'date' : undefined}>
            <div className="leading-none">
              <p className={cn('numeral text-[40px]', isToday ? 'text-accent' : 'text-ink')}>{d.slice(8)}</p>
              <p className="caps mt-2 text-[11px] text-muted">
                {formatDate(d, 'EEE, MMM')}
                {isToday && <span className="text-accent">, today</span>}
              </p>
            </div>
            <ul className="divide-y divide-line">
              {list.map((e) => (
                <li key={e.id}>
                  <Link to={e.link} className="flex items-start gap-3 py-2.5 transition-colors hover:bg-surface-2/60">
                    {e.type === 'MILESTONE' ? (
                      <Flag className="mt-0.5 size-4 shrink-0" style={{ color: e.projectColor }} aria-label="Milestone" />
                    ) : e.type === 'PROJECT_DEADLINE' ? (
                      <Target className="mt-0.5 size-4 shrink-0" style={{ color: e.projectColor }} aria-label="Project deadline" />
                    ) : (
                      <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ backgroundColor: e.projectColor }} aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-[14px] font-normal text-ink', e.completed && 'text-muted')}>{e.title}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                        {e.type === 'TASK' && e.status ? <StatusBadge status={e.status} /> : <span className="text-[12px] font-medium">{e.type === 'MILESTONE' ? 'Milestone' : 'Deadline'}</span>}
                        <span>{e.projectName}</span>
                        {e.overdue && <span className="font-medium text-danger">Overdue</span>}
                      </span>
                    </span>
                    {e.priority && <PriorityIcon priority={e.priority} />}
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}
