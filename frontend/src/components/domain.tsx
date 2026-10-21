import { AlertCircle, CalendarClock } from 'lucide-react';
import type { Health, Priority, ProjectStatus, Role, TaskStatus } from '@/api/types';
import { cn } from '@/lib/cn';
import {
  HEALTH_LABEL,
  PRIORITY_LABEL,
  PROJECT_STATUS_LABEL,
  ROLE_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
} from '@/lib/constants';
import { daysUntil, formatDueDate } from '@/lib/dates';
import { PriorityGlyph, StatusGlyph } from './glyphs';
import { Badge, type Tone } from './ui/Badge';

export function StatusDot({ status, className }: { status: TaskStatus; className?: string }) {
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', className)} style={{ backgroundColor: STATUS_COLOR[status] }} aria-hidden="true" />;
}

/** A task's state: its core-sample glyph (filling as the work settles) and the word beside it. */
export function StatusBadge({ status, late = false }: { status: TaskStatus; late?: boolean }) {
  return (
    <span className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full bg-surface-3/70 pr-2 pl-1.5 text-[12px] leading-none font-medium whitespace-nowrap text-ink-2 dark:bg-surface-3" data-status={status}>
      <StatusGlyph status={status} late={late} className="size-3.5" />
      {STATUS_LABEL[status]}
      {late && <span className="sr-only">, late</span>}
    </span>
  );
}

/** Priority as filled bars (urgent knocked out of a red tile). Named for screen readers. */
export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  return <PriorityGlyph priority={priority} className={cn('size-3.5', className)} />;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className="inline-flex items-center gap-1 text-[13px] text-ink-2">
      <PriorityIcon priority={priority} />
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

const HEALTH_TONE: Record<Health, Tone> = { NOT_STARTED: 'neutral', ON_TRACK: 'success', AT_RISK: 'warning', OFF_TRACK: 'danger', COMPLETED: 'brand' };

export function HealthBadge({ health, className }: { health: Health; className?: string }) {
  return (
    <Badge tone={HEALTH_TONE[health]} className={className}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {HEALTH_LABEL[health]}
    </Badge>
  );
}

export const HEALTH_COLOR: Record<Health, string> = {
  NOT_STARTED: 'var(--strata-todo)',
  ON_TRACK: 'var(--strata-done)',
  AT_RISK: 'var(--strata-review)',
  OFF_TRACK: 'var(--strata-weak)',
  COMPLETED: 'var(--brand)',
};

const ROLE_TONE: Record<Role, Tone> = { OWNER: 'brand', MANAGER: 'info', MEMBER: 'neutral', VIEWER: 'neutral' };

export function RoleBadge({ role }: { role: Role }) {
  return <Badge tone={ROLE_TONE[role]}>{ROLE_LABEL[role]}</Badge>;
}

const PROJECT_STATUS_TONE: Record<ProjectStatus, Tone> = { ACTIVE: 'success', ON_HOLD: 'warning', COMPLETED: 'brand', ARCHIVED: 'neutral' };

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge tone={PROJECT_STATUS_TONE[status]}>{PROJECT_STATUS_LABEL[status]}</Badge>;
}

/** The project's colour as a small tile with its initial (a soft top light, like a glazed chip). */
export function ProjectMark({ name, color, size = 'md', className }: { name: string; color: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const s = { sm: 'size-5 text-[10.5px] rounded-[6px]', md: 'size-8 text-[13px] rounded-[9px]', lg: 'size-11 text-[17px] rounded-[12px]' }[size];
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25),inset_0_-1px_0_rgb(0_0_0/0.12)]', s, className)}
      style={{ backgroundColor: color, backgroundImage: 'linear-gradient(180deg, rgb(255 255 255 / 0.16), rgb(255 255 255 / 0) 60%)' }}
      aria-hidden="true"
    >
      {name.trim()[0]?.toUpperCase() ?? '?'}
    </span>
  );
}

/** Due date with colour coding: red if overdue, amber if due within 2 days. */
export function DueDate({ date, done, className, showIcon = true }: { date: string | null; done?: boolean; className?: string; showIcon?: boolean }) {
  if (!date) return <span className={cn('text-[13px] text-subtle', className)}>No due date</span>;
  const n = daysUntil(date);
  const tone = done ? 'text-muted' : n < 0 ? 'text-danger font-medium' : n <= 2 ? 'text-warning font-medium' : 'text-ink-2';
  const Icon = !done && n < 0 ? AlertCircle : CalendarClock;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[13px] whitespace-nowrap', tone, className)} title={date}>
      {showIcon && <Icon className="size-3.5" aria-hidden="true" />}
      {formatDueDate(date)}
      {!done && n < 0 && <span className="sr-only">(overdue)</span>}
    </span>
  );
}

