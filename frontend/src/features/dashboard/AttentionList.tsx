import {
  Activity,
  Ban,
  CalendarClock,
  CalendarX2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileCheck2,
  Flag,
  Hourglass,
  Link2,
  RotateCcw,
  Scale,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { ApprovedItem, AttentionItem, AttentionKind, Severity } from '@/api/types';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/dates';

export const KIND_LABEL: Record<AttentionKind, string> = {
  REVIEW_WAITING: 'Review waiting',
  CHANGES_REQUESTED: 'Changes requested',
  OVERDUE: 'Overdue',
  DUE_SOON: 'Due soon',
  AWAITING_REVIEW: 'Waiting on reviewer',
  PROJECT_RISK: 'Project health',
  MILESTONE_RISK: 'Milestone',
  WORKLOAD: 'Workload',
  UNASSIGNED: 'Unassigned',
  BLOCKED: 'Blocked',
  BLOCKING: 'Holding up work',
};

const KIND_ICON: Record<AttentionKind, LucideIcon> = {
  REVIEW_WAITING: ClipboardCheck,
  CHANGES_REQUESTED: RotateCcw,
  OVERDUE: CalendarX2,
  DUE_SOON: CalendarClock,
  AWAITING_REVIEW: Hourglass,
  PROJECT_RISK: Activity,
  MILESTONE_RISK: Flag,
  WORKLOAD: Scale,
  UNASSIGNED: UserX,
  BLOCKED: Ban,
  BLOCKING: Link2,
};

const SEVERITY: Record<Severity, { label: string; note: string; dot: string; icon: string }> = {
  HIGH: { label: 'Now', note: 'Late work holding others up, and projects off track', dot: 'bg-danger', icon: 'bg-danger-soft text-danger' },
  MEDIUM: { label: 'Soon', note: 'Reviews waiting, late work, and risks building up', dot: 'bg-warning', icon: 'bg-warning-soft text-warning' },
  LOW: { label: 'Worth a look', note: 'Nothing urgent, but someone should decide', dot: 'bg-line-strong', icon: 'bg-surface-3 text-muted' },
};

/** How many items a group shows before "Show more". */
const PREVIEW = 4;

/** One item: what kind of rule fired, in which project, the reason in words, and the records behind it. */
function AttentionRow({ item }: { item: AttentionItem }) {
  const sev = SEVERITY[item.severity];
  const Icon = KIND_ICON[item.kind];
  return (
    <li>
      <Link to={item.link} className="group flex gap-3.5 px-4 py-4 transition-colors hover:bg-surface-2/70 sm:px-5" data-attention-kind={item.kind} data-kb-item="">
        <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', sev.icon)} aria-hidden="true">
          <Icon className="size-4" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-muted">
            <span className="font-medium text-ink-2">{KIND_LABEL[item.kind]}</span>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: item.projectColor }} aria-hidden="true" />
              <span className="truncate">{item.projectName}</span>
            </span>
          </span>
          <span className="mt-1 block text-[14.5px] leading-snug font-medium text-ink group-hover:text-brand-ink">{item.title}</span>
          <span className="mt-1 block max-w-3xl text-[13px] leading-relaxed text-muted">{item.reason}</span>
          {item.refs.length > 0 && (
            <span className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Records">
              {item.refs.map((r) => (
                <span key={r} className="rounded-md bg-surface-3/80 px-1.5 py-0.5 text-[12px] font-medium text-ink-2 tabular dark:bg-surface-3">
                  {r}
                </span>
              ))}
            </span>
          )}
        </span>
        <ChevronRight className="mt-2 size-4 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden="true" />
      </Link>
    </li>
  );
}

/** One severity group as a card: its rows, and the rest behind "Show more". */
function AttentionGroup({ severity, items }: { severity: Severity; items: AttentionItem[] }) {
  const [all, setAll] = useState(false);
  const sev = SEVERITY[severity];
  const shown = all ? items : items.slice(0, PREVIEW);
  const id = `attention-${severity.toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-xl border border-line bg-surface shadow-card" data-attention-group={severity}>
      <header className="flex items-center gap-2.5 border-b border-line px-4 py-3 sm:px-5">
        <span className={cn('size-2 rounded-full', sev.dot)} aria-hidden="true" />
        <h3 id={id} className="text-[14px] font-semibold text-ink">
          {sev.label}
        </h3>
        <span className="rounded-full bg-surface-3 px-2 text-[12px] leading-5 font-medium text-ink-2 tabular dark:bg-surface-3">{items.length}</span>
        <span className="ml-1 hidden truncate text-[12.5px] text-muted sm:inline">{sev.note}</span>
      </header>
      <ul className="divide-y divide-line">
        {shown.map((i) => (
          <AttentionRow key={i.id} item={i} />
        ))}
      </ul>
      {items.length > PREVIEW && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          className="flex w-full items-center justify-center gap-1.5 border-t border-line px-4 py-2.5 text-[13px] font-medium text-accent transition-colors hover:bg-surface-2"
        >
          {all ? 'Show fewer' : `Show ${items.length - PREVIEW} more`}
          <ChevronDown className={cn('size-4 transition-transform', all && 'rotate-180')} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

/** Attention items grouped Now / Soon / Worth a look. Order comes from the server (severity, then date). */
export function AttentionList({ items }: { items: AttentionItem[] }) {
  const groups = (['HIGH', 'MEDIUM', 'LOW'] as const).map((s) => ({ s, list: items.filter((i) => i.severity === s) })).filter((g) => g.list.length > 0);
  return (
    <div className="space-y-4">
      {groups.map(({ s, list }) => (
        <AttentionGroup key={s} severity={s} items={list} />
      ))}
    </div>
  );
}

/** "What evidence proves completion": recent approvals and what they were approved on. */
export function ApprovedList({ items }: { items: ApprovedItem[] }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((a) => (
        <li key={`${a.taskId}-${a.version}`}>
          <Link to={a.link} className="group flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2/70 sm:px-5" data-kb-item="">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium text-ink group-hover:text-brand-ink">{a.title}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-muted">
                <span className="mr-1 tabular">{a.taskKey}</span>
                <Avatar user={a.reviewer} size="xs" />
                <span>
                  {a.reviewer.name.split(' ')[0]} approved v{a.version} {timeAgo(a.approvedAt)}
                </span>
              </span>
              <span className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-ink-2">
                <FileCheck2 className="size-3.5 text-muted" aria-hidden="true" />
                {a.evidenceCount} {a.evidenceCount === 1 ? 'piece' : 'pieces'} of evidence
                {a.criteriaCount > 0 && `, ${a.criteriaCount} ${a.criteriaCount === 1 ? 'criterion' : 'criteria'} met`}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
