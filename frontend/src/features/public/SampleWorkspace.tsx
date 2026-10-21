import { Check, ChevronLeft, CircleAlert, Link2, RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Task, TaskStatus } from '@/api/types';
import { DueDate, PriorityIcon, StatusBadge } from '@/components/domain';
import { StatusGlyph } from '@/components/glyphs';
import { LogoMark } from '@/components/layout/Logo';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { reviewBlockers, type BlockerFinding } from '@/features/assistant/flurryReports';
import { FlurryFigure } from '@/features/flurry/FlurryFigure';
import { cn } from '@/lib/cn';
import { PRIORITY_LABEL, STATUS_COLOR, STATUS_LABEL, TASK_STATUSES } from '@/lib/constants';
import { formatDate, todayIso } from '@/lib/dates';
import { readSession, writeSession } from '@/lib/storage';
import { ONBOARDING_SAMPLE, sampleProjectData } from './sampleProject';

type View = 'board' | 'list' | 'timeline';
/** What the visitor changed: status and owner per task id. Stored for this tab only. */
type Changes = Record<number, { status?: TaskStatus; owner?: number | null }>;

const STORE = 'projectflow.sample-workspace';
const PEOPLE = Object.values(ONBOARDING_SAMPLE.people);

function loadChanges(): Changes {
  try {
    return JSON.parse(readSession(STORE) ?? '{}') as Changes;
  } catch {
    return {};
  }
}

/**
 * The front page's sample workspace: "Launch the mobile onboarding update" in Niveloft's own
 * interface, fully interactive and clearly labelled. Visitors can switch between the board, the
 * list and the timeline (the same facts in each), filter by owner, open a task, move it through
 * the workflow (with the same rules as the app: blocked work can't start, only a review makes it
 * Done), give unowned work an owner, and reset everything. Flurry, alongside, reviews the
 * blockers from the current state, exactly as it does in the app. Nothing is sent anywhere; the
 * changes live in this browser tab.
 */
export function SampleWorkspace({ className }: { className?: string }) {
  const base = useMemo(() => sampleProjectData(), []);
  const [changes, setChanges] = useState<Changes>(loadChanges);
  const [view, setView] = useState<View>('board');
  const [owner, setOwner] = useState<number | 'all' | 'none'>('all');
  const [openId, setOpenId] = useState<number | null>(null);
  const [announce, setAnnounce] = useState('');
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => writeSession(STORE, Object.keys(changes).length ? JSON.stringify(changes) : null), [changes]);

  // The records with the visitor's changes applied (and blockers' states kept in step).
  const tasks: Task[] = useMemo(() => {
    const today = todayIso();
    return base.tasks.map((t) => {
      const c = changes[t.id];
      if (!c) return t;
      const status = c.status ?? t.status;
      const ownerId = c.owner === undefined ? (t.assignee?.id ?? null) : c.owner;
      const person = PEOPLE.find((p) => p.id === ownerId) ?? null;
      return {
        ...t,
        status,
        assignee: person ? { id: person.id, name: person.name, email: person.email, avatarColor: person.avatarColor } : null,
        overdue: status !== 'DONE' && t.dueDate !== null && t.dueDate < today,
      };
    });
  }, [base, changes]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const waitsOn = (t: Task) => base.dependencies.filter((d) => d.blocked.id === t.id).map((d) => byId.get(d.blocker.id)!);
  const holdsUp = (t: Task) => base.dependencies.filter((d) => d.blocker.id === t.id).map((d) => byId.get(d.blocked.id)!);
  const blockedBy = (t: Task) => (t.status === 'DONE' ? [] : waitsOn(t).filter((b) => b.status !== 'DONE'));

  const shown = tasks.filter((t) => owner === 'all' || (owner === 'none' ? !t.assignee : t.assignee?.id === owner));
  const done = tasks.filter((t) => t.status === 'DONE').length;
  // reviewBlockers reads each task's current status from `tasks`, so the visitor's changes count.
  const findings = useMemo(
    () => reviewBlockers({ project: { id: 0, name: ONBOARDING_SAMPLE.name, deadline: base.deadline, progress: 0, expectedProgress: null }, tasks, dependencies: base.dependencies, today: todayIso() }),
    [tasks, base],
  );

  const change = (t: Task, c: { status?: TaskStatus; owner?: number | null }, message: string) => {
    setChanges((all) => ({ ...all, [t.id]: { ...all[t.id], ...c } }));
    setAnnounce(message);
  };
  const reset = () => {
    setChanges({});
    setOwner('all');
    setAnnounce('The sample is back to how it started.');
  };
  const open = (t: Task, from: HTMLElement) => {
    returnFocus.current = from;
    setOpenId(t.id);
  };
  const close = () => setOpenId(null);
  // Once the panel has closed, focus goes back to what opened it.
  useEffect(() => {
    if (openId !== null || !returnFocus.current) return;
    const el = returnFocus.current;
    returnFocus.current = null;
    if (el.isConnected) el.focus();
    else document.querySelector<HTMLElement>('[data-sample-workspace] [role="tablist"] [aria-selected="true"]')?.focus();
  }, [openId]);
  const current = openId !== null ? (byId.get(openId) ?? null) : null;

  return (
    <div className={cn('relative overflow-hidden rounded-2xl border border-line bg-surface shadow-float', className)} data-sample-workspace="">
      {/* Window bar: the project, the sample label, views and reset. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line bg-surface-2/70 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <LogoMark className="size-6 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-ink">{ONBOARDING_SAMPLE.name}</p>
            <p className="text-[12px] text-muted">
              <span className="rounded-full bg-brand-soft px-1.5 py-px font-medium text-brand-ink">Sample workspace</span> Changes stay in this tab.
            </p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="View" className="flex rounded-lg border border-line bg-surface p-0.5">
            {(['board', 'list', 'timeline'] as View[]).map((v) => (
              <button
                key={v}
                role="tab"
                type="button"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cn('h-8 rounded-md px-3 text-[12.5px] font-medium capitalize transition-colors', view === v ? 'bg-brand text-white dark:text-canvas' : 'text-ink-2 hover:bg-surface-2')}
                data-sample-view={v}
              >
                {v}
              </button>
            ))}
          </div>
          <Button size="sm" variant="secondary" onClick={reset} disabled={Object.keys(changes).length === 0 && owner === 'all'} data-sample-reset="">
            <RotateCcw aria-hidden="true" /> Reset
          </Button>
        </div>
      </div>

      {/* Progress and owner filter. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="min-w-[180px]">
          <p className="text-[12px] text-muted">
            <span className="font-semibold text-ink tabular">{done}</span> of {tasks.length} approved
          </p>
          <div className="mt-1 h-1.5 w-44 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`${Math.round((done / tasks.length) * 100)}% approved`}>
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${(done / tasks.length) * 100}%` }} />
          </div>
        </div>
        {/* At least 300px wide, so on a phone the chips wrap onto their own line under the count. */}
        <div className="flex min-w-0 flex-[1_1_300px] flex-wrap items-center gap-1.5" role="group" aria-label="Filter by owner">
          <FilterChip active={owner === 'all'} onClick={() => setOwner('all')}>
            Everyone
          </FilterChip>
          {PEOPLE.map((p) => (
            <FilterChip key={p.id} active={owner === p.id} onClick={() => setOwner(owner === p.id ? 'all' : p.id)}>
              <span aria-hidden="true">
                <Avatar user={p} size="xs" className="ring-0" />
              </span>
              {p.name.split(' ')[0]}
            </FilterChip>
          ))}
          <FilterChip active={owner === 'none'} onClick={() => setOwner(owner === 'none' ? 'all' : 'none')}>
            No owner
          </FilterChip>
          {owner !== 'all' && (
            <button type="button" onClick={() => setOwner('all')} className="ml-1 text-[12px] font-medium text-accent hover:underline">
              Clear filter
            </button>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 p-3 sm:p-4" role="tabpanel" aria-label={`${view} view`}>
          {shown.length === 0 ? (
            <p className="px-2 py-10 text-center text-[13px] text-muted">Nothing matches this filter.</p>
          ) : view === 'board' ? (
            <div className="scrollbar-thin -mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
              {TASK_STATUSES.map((s) => {
                const col = shown.filter((t) => t.status === s);
                return (
                  <section key={s} className="w-[250px] shrink-0 rounded-xl bg-surface-2 p-2 lg:w-auto lg:min-w-0 lg:flex-1" aria-label={`${STATUS_LABEL[s]}, ${col.length}`}>
                    <h3 className="flex items-center gap-2 px-1.5 pt-1 pb-2 text-[12px] font-semibold text-ink-2">
                      <StatusGlyph status={s} /> {STATUS_LABEL[s]} <span className="font-normal text-muted tabular">{col.length}</span>
                    </h3>
                    <ul className="space-y-2">
                      {col.map((t) => (
                        <li key={t.id}>
                          <TaskCardButton task={t} blocked={blockedBy(t)} onOpen={open} selected={openId === t.id} />
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          ) : view === 'list' ? (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead className="bg-surface-2 text-[12px] text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Task
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Owner
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Status
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Priority
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Due
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.map((t) => (
                    <tr key={t.id} className="hover:bg-surface-2/60">
                      <td className="px-3 py-2">
                        <button type="button" onClick={(e) => open(t, e.currentTarget)} className="text-left text-ink hover:text-accent">
                          <span className="mr-2 font-mono text-[12px] text-muted">{t.key}</span>
                          {t.title}
                        </button>
                        {blockedBy(t).length > 0 && <BlockedNote blockers={blockedBy(t)} />}
                      </td>
                      <td className="px-3 py-2">{t.assignee ? <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><Avatar user={t.assignee} size="xs" /> {t.assignee.name.split(' ')[0]}</span> : <span className="text-warning">No owner</span>}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={t.status} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <PriorityIcon priority={t.priority} /> {PRIORITY_LABEL[t.priority]}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <DueDate date={t.dueDate} done={t.status === 'DONE'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Timeline tasks={shown} milestones={base.milestones} start={base.projectStart} end={base.deadline} onOpen={open} />
          )}
        </div>

        {/* Flurry, reviewing the sample's blockers from its current state. */}
        <aside className="border-t border-line bg-surface-2/50 p-4 lg:border-t-0 lg:border-l" aria-label="Flurry">
          <div className="flex items-center gap-2.5">
            <FlurryFigure className="size-10" glow={false} />
            <div>
              <p className="text-[13.5px] font-semibold text-ink">Flurry</p>
              <p className="text-[12px] text-muted">Review blockers, from these records</p>
            </div>
          </div>
          <FlurryFindings findings={findings} onOpen={(id, el) => open(byId.get(id)!, el)} />
        </aside>
      </div>

      {current && (
        <TaskPanel
          task={current}
          waitsOn={waitsOn(current)}
          holdsUp={holdsUp(current)}
          blockers={blockedBy(current)}
          onClose={close}
          onChange={(c, m) => change(current, c, m)}
          onOpen={(t) => setOpenId(t.id)}
        />
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors',
        active ? 'border-accent/50 bg-brand-soft text-brand-ink' : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

function BlockedNote({ blockers }: { blockers: Task[] }) {
  return (
    <span className="mt-1 flex items-center gap-1 text-[12px] text-warning">
      <Link2 className="size-3" aria-hidden="true" /> Waits on {blockers.map((b) => b.key).join(', ')}
    </span>
  );
}

function TaskCardButton({ task: t, blocked, onOpen, selected }: { task: Task; blocked: Task[]; onOpen: (t: Task, el: HTMLElement) => void; selected: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => onOpen(t, e.currentTarget)}
      className={cn(
        'w-full rounded-lg border bg-surface p-3 text-left shadow-card transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-line-strong hover:shadow-pop',
        selected ? 'border-accent ring-2 ring-accent/20' : 'border-line',
      )}
      data-sample-task={t.key}
    >
      <p className="flex items-center justify-between gap-2 font-mono text-[11.5px] text-muted">
        {t.key}
        <PriorityIcon priority={t.priority} className="size-3.5" />
      </p>
      <p className="mt-1 text-[13px] leading-snug font-medium text-ink">{t.title}</p>
      {blocked.length > 0 && <BlockedNote blockers={blocked} />}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        {t.assignee ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-ink-2">
            <Avatar user={t.assignee} size="xs" /> <span className="truncate">{t.assignee.name.split(' ')[0]}</span>
          </span>
        ) : (
          <span className="rounded-full border border-dashed border-warning/60 px-1.5 text-[12px] font-medium text-warning">No owner</span>
        )}
        <DueDate date={t.dueDate} done={t.status === 'DONE'} className="text-[12px]" />
      </div>
    </button>
  );
}

function FlurryFindings({ findings, onOpen }: { findings: BlockerFinding[]; onOpen: (id: number, el: HTMLElement) => void }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const shown = findings.filter((f) => !dismissed.has(f.id));
  if (!findings.length) return <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">Nothing is blocked, overdue or without an owner. Nice work.</p>;
  return (
    <ul className="mt-3 space-y-2.5">
      {shown.map((f) => (
        <li key={f.id} className="rounded-lg border border-line bg-surface p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[12.5px] leading-snug font-medium text-ink">{f.title}</p>
            <button type="button" className="-mt-0.5 -mr-1 flex size-6 shrink-0 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-ink" aria-label={`Dismiss: ${f.title}`} onClick={() => setDismissed((d) => new Set(d).add(f.id))}>
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-2">
            <span className="font-medium text-accent">Next move: </span>
            {f.suggestion}
          </p>
          <p className="mt-1.5 flex flex-wrap gap-x-2">
            {f.tasks.slice(0, 4).map((t) => (
              <button key={t.id} type="button" onClick={(e) => onOpen(t.id, e.currentTarget)} className="font-mono text-[12px] text-accent hover:underline" title={t.title}>
                {t.key}
              </button>
            ))}
          </p>
        </li>
      ))}
      {dismissed.size > 0 && (
        <li>
          <button type="button" className="text-[12px] text-muted hover:text-ink" onClick={() => setDismissed(new Set())}>
            Show dismissed
          </button>
        </li>
      )}
      <li className="text-[12px] leading-relaxed text-muted">Worked out from the sample’s due dates, owners and dependencies, the same way as in the app. No AI model is used here.</li>
    </ul>
  );
}

/** The next steps a task can take, with the same rules as the app (simplified: you play every role). */
function moves(t: Task, blockers: Task[]): { label: string; to: TaskStatus; primary?: boolean; note?: string }[] {
  switch (t.status) {
    case 'TODO':
      return [{ label: 'Start', to: 'IN_PROGRESS', primary: true, note: blockers.length ? `Waits on ${blockers.map((b) => b.key).join(', ')}, which ${blockers.length === 1 ? 'isn’t' : 'aren’t'} approved yet.` : undefined }];
    case 'IN_PROGRESS':
      return [
        { label: 'Submit for review', to: 'IN_REVIEW', primary: true },
        { label: 'Move back to To do', to: 'TODO' },
      ];
    case 'IN_REVIEW':
      return [
        { label: 'Approve', to: 'DONE', primary: true },
        { label: 'Request changes', to: 'IN_PROGRESS' },
      ];
    case 'DONE':
      return [{ label: 'Reopen', to: 'IN_PROGRESS' }];
  }
}

function TaskPanel({
  task: t,
  waitsOn,
  holdsUp,
  blockers,
  onClose,
  onChange,
  onOpen,
}: {
  task: Task;
  waitsOn: Task[];
  holdsUp: Task[];
  blockers: Task[];
  onClose: () => void;
  onChange: (c: { status?: TaskStatus; owner?: number | null }, message: string) => void;
  onOpen: (t: Task) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [t.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const next = moves(t, blockers);
  const blockedStart = t.status === 'TODO' && blockers.length > 0;
  return (
    <div className="absolute inset-0 z-10 flex justify-end bg-graphite/20 animate-fade-in" onClick={onClose} data-sample-panel="">
      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby="sample-task-title"
        className="scrollbar-thin h-full w-full overflow-y-auto border-l border-line bg-surface shadow-pop animate-slide-in-right sm:w-[400px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between gap-2 border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur">
          <button type="button" onClick={onClose} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[12.5px] text-muted hover:bg-surface-2 hover:text-ink">
            <ChevronLeft className="size-4" aria-hidden="true" /> Back to the sample
          </button>
          <span className="font-mono text-[12px] text-muted">{t.key}</span>
        </div>
        <div className="space-y-5 px-4 py-4">
          <div>
            <h3 id="sample-task-title" ref={heading} tabIndex={-1} className="text-[17px] leading-snug font-semibold text-ink focus:outline-none">
              {t.title}
            </h3>
            {t.description && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{t.description}</p>}
          </div>

          <section aria-label="Status" className="rounded-lg border border-line p-3">
            <div className="flex items-center justify-between gap-2">
              <StatusBadge status={t.status} />
              {t.overdue && (
                <span className="flex items-center gap-1 text-[12px] font-medium text-danger">
                  <CircleAlert className="size-3.5" aria-hidden="true" /> Overdue
                </span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {next.map((m) => (
                <Button
                  key={m.label}
                  size="sm"
                  variant={m.primary ? 'primary' : 'secondary'}
                  disabled={m.to === 'IN_PROGRESS' && blockedStart}
                  onClick={() => onChange({ status: m.to }, `${t.key} moved to ${STATUS_LABEL[m.to]}.`)}
                  data-sample-move={m.to}
                >
                  {m.to === 'DONE' && <Check aria-hidden="true" />}
                  {m.label}
                </Button>
              ))}
            </div>
            {next.some((m) => m.note) && <p className="mt-2 text-[12px] text-warning">{next.find((m) => m.note)?.note}</p>}
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              {t.status === 'IN_REVIEW'
                ? 'In the app a reviewer checks each criterion and the evidence, and can’t approve their own work. Here you play every role.'
                : 'Done is only reachable through a review, in the app and here.'}
            </p>
          </section>

          <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2.5 text-[13px]">
            <dt className="text-muted">Owner</dt>
            <dd>
              <label htmlFor="sample-owner" className="sr-only">
                Owner
              </label>
              <select
                id="sample-owner"
                value={t.assignee?.id ?? ''}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  const who = PEOPLE.find((p) => p.id === id);
                  onChange({ owner: id }, who ? `${t.key} is now owned by ${who.name}.` : `${t.key} has no owner.`);
                }}
                className={cn('w-full rounded-md border bg-surface px-2 py-1.5 text-[13px] focus:border-ink focus:outline-none', t.assignee ? 'border-line text-ink' : 'border-warning/60 text-warning')}
              >
                <option value="">No owner</option>
                {PEOPLE.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}, {p.role}
                  </option>
                ))}
              </select>
            </dd>
            <dt className="text-muted">Due</dt>
            <dd>
              <DueDate date={t.dueDate} done={t.status === 'DONE'} />
            </dd>
            <dt className="text-muted">Priority</dt>
            <dd className="inline-flex items-center gap-1 text-ink-2">
              <PriorityIcon priority={t.priority} /> {PRIORITY_LABEL[t.priority]}
            </dd>
            <dt className="text-muted">Milestone</dt>
            <dd className="text-ink-2">{t.milestoneName ?? '—'}</dd>
            <dt className="text-muted">Estimate</dt>
            <dd className="text-ink-2">{t.estimateDays ? `${t.estimateDays} working ${t.estimateDays === 1 ? 'day' : 'days'} left` : t.status === 'DONE' ? '—' : 'Not estimated'}</dd>
          </dl>

          {t.acceptanceCriteria.length > 0 && (
            <section>
              <h4 className="text-[12px] font-semibold text-muted">Acceptance criteria</h4>
              <ul className="mt-1.5 space-y-1.5 text-[13px] text-ink-2">
                {t.acceptanceCriteria.map((c) => (
                  <li key={c.id} className="flex gap-2">
                    <span className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border', t.status === 'DONE' ? 'border-success bg-success text-white' : 'border-line-strong')}>
                      {t.status === 'DONE' && <Check className="size-3" aria-hidden="true" />}
                    </span>
                    {c.text}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(waitsOn.length > 0 || holdsUp.length > 0) && (
            <section>
              <h4 className="text-[12px] font-semibold text-muted">Dependencies</h4>
              <ul className="mt-1.5 space-y-1.5 text-[13px]">
                {waitsOn.map((b) => (
                  <li key={`w${b.id}`}>
                    <span className="text-muted">Waits on </span>
                    <button type="button" className="text-ink hover:text-accent" onClick={() => onOpen(b)}>
                      <span className="font-mono text-[12px] text-muted">{b.key}</span> {b.title}
                    </button>{' '}
                    <span className={cn('text-[12px]', b.status === 'DONE' ? 'text-success' : 'text-warning')}>({STATUS_LABEL[b.status]})</span>
                  </li>
                ))}
                {holdsUp.map((b) => (
                  <li key={`h${b.id}`}>
                    <span className="text-muted">Holds up </span>
                    <button type="button" className="text-ink hover:text-accent" onClick={() => onOpen(b)}>
                      <span className="font-mono text-[12px] text-muted">{b.key}</span> {b.title}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

const DAY = 86_400_000;

/** The timeline: one bar per task from when it started (or was created) to its due date, by milestone, with today marked. */
function Timeline({ tasks, milestones, start, end, onOpen }: { tasks: Task[]; milestones: { id: number; name: string; dueDate: string }[]; start: string; end: string; onOpen: (t: Task, el: HTMLElement) => void }) {
  const t0 = new Date(`${start}T00:00:00`).getTime();
  const t1 = new Date(`${end}T00:00:00`).getTime() + DAY;
  const span = t1 - t0;
  const x = (iso: string) => Math.min(100, Math.max(0, ((new Date(iso.length > 10 ? iso : `${iso}T12:00:00`).getTime() - t0) / span) * 100));
  const today = x(new Date().toISOString());
  const weeks: string[] = [];
  for (let d = t0; d < t1; d += 7 * DAY) weeks.push(new Date(d).toISOString().slice(0, 10));
  const groups = milestones.map((m) => ({ m, items: tasks.filter((t) => t.milestoneId === m.id) })).filter((g) => g.items.length);
  return (
    <div className="scrollbar-thin overflow-x-auto" data-sample-timeline="">
      <div className="min-w-[760px]">
        <div className="relative ml-[220px] h-7 border-b border-line text-[12px] text-muted">
          {weeks.map((w) => (
            <span key={w} className="absolute top-1.5 -translate-x-1/2 whitespace-nowrap" style={{ left: `${x(w)}%` }}>
              {formatDate(w, 'd MMM')}
            </span>
          ))}
        </div>
        {groups.map(({ m, items }) => (
          <div key={m.id} className="mt-3">
            <p className="flex items-center gap-2 text-[12px] font-semibold text-ink-2">
              <span className="size-2.5 rotate-45 rounded-[2px] bg-accent" aria-hidden="true" /> {m.name}
              <span className="font-normal text-muted">due {formatDate(m.dueDate, 'd MMM')}</span>
            </p>
            <ul className="mt-1.5 space-y-1">
              {items.map((t) => {
                const from = x(t.startedAt ?? t.createdAt);
                const to = t.dueDate ? x(t.dueDate) : Math.min(100, from + 6);
                return (
                  <li key={t.id} className="grid grid-cols-[220px_1fr] items-center">
                    <button type="button" onClick={(e) => onOpen(t, e.currentTarget)} className="truncate pr-3 text-left text-[12.5px] text-ink hover:text-accent" title={t.title}>
                      <span className="mr-1.5 font-mono text-[11.5px] text-muted">{t.key}</span>
                      {t.title}
                    </button>
                    <div className="relative h-6">
                      <div className="absolute inset-y-0 w-px bg-accent/70" style={{ left: `${today}%` }} aria-hidden="true" />
                      <div
                        className={cn('absolute top-1 h-4 rounded-md', t.status === 'TODO' && 'border border-dashed border-line-strong bg-surface-2', t.overdue && 'ring-2 ring-danger ring-offset-1 ring-offset-surface')}
                        style={{ left: `${from}%`, width: `${Math.max(1.5, to - from)}%`, backgroundColor: t.status === 'TODO' ? undefined : STATUS_COLOR[t.status] }}
                        title={`${t.key}: ${STATUS_LABEL[t.status]}${t.dueDate ? `, due ${formatDate(t.dueDate, 'd MMM')}` : ''}`}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <p className="mt-3 ml-[220px] flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-px bg-accent" aria-hidden="true" /> Today
          </span>
          {(['IN_PROGRESS', 'IN_REVIEW', 'DONE'] as TaskStatus[]).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm" style={{ backgroundColor: STATUS_COLOR[s] }} aria-hidden="true" /> {STATUS_LABEL[s]}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-sm ring-2 ring-danger" aria-hidden="true" /> Overdue
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-sm border border-dashed border-line-strong" aria-hidden="true" /> Not started
          </span>
        </p>
      </div>
    </div>
  );
}
