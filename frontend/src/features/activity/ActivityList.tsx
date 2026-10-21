import { type LucideIcon, ArrowRight, CalendarClock, CheckCircle2, CheckSquare, CirclePlus, FileCheck2, FileText, Flag, FolderPlus, Link2, ListChecks, Mail, MessageSquare, MoveRight, Pencil, RotateCcw, Send, Trash2, Unlink, UserMinus, UserPlus, UserRoundCog } from 'lucide-react';
import { Link } from 'react-router';
import type { Activity, ActivityType } from '@/api/types';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, timeAgo } from '@/lib/dates';

const ICON: Record<ActivityType, { icon: LucideIcon; tone: string }> = {
  PROJECT_CREATED: { icon: FolderPlus, tone: 'text-accent bg-brand-soft' },
  PROJECT_UPDATED: { icon: Pencil, tone: 'text-muted bg-surface-2' },
  TASK_CREATED: { icon: CirclePlus, tone: 'text-accent bg-brand-soft' },
  TASK_UPDATED: { icon: Pencil, tone: 'text-muted bg-surface-2' },
  TASK_STATUS_CHANGED: { icon: MoveRight, tone: 'text-info bg-info-soft' },
  TASK_ASSIGNED: { icon: UserPlus, tone: 'text-info bg-info-soft' },
  TASK_DELETED: { icon: Trash2, tone: 'text-danger bg-danger-soft' },
  CRITERIA_UPDATED: { icon: CheckSquare, tone: 'text-muted bg-surface-2' },
  CHECKLIST_UPDATED: { icon: ListChecks, tone: 'text-muted bg-surface-2' },
  DEPENDENCY_ADDED: { icon: Link2, tone: 'text-info bg-info-soft' },
  DEPENDENCY_REMOVED: { icon: Unlink, tone: 'text-muted bg-surface-2' },
  PLAN_APPLIED: { icon: CalendarClock, tone: 'text-warning bg-warning-soft' },
  COMMENT_ADDED: { icon: MessageSquare, tone: 'text-muted bg-surface-2' },
  SUBMISSION_CREATED: { icon: Send, tone: 'text-warning bg-warning-soft' },
  REVIEW_APPROVED: { icon: CheckCircle2, tone: 'text-success bg-success-soft' },
  REVIEW_CHANGES_REQUESTED: { icon: RotateCcw, tone: 'text-warning bg-warning-soft' },
  MEMBER_JOINED: { icon: UserPlus, tone: 'text-success bg-success-soft' },
  MEMBER_REMOVED: { icon: UserMinus, tone: 'text-danger bg-danger-soft' },
  MEMBER_ROLE_CHANGED: { icon: UserRoundCog, tone: 'text-info bg-info-soft' },
  INVITATION_SENT: { icon: Mail, tone: 'text-accent bg-brand-soft' },
  MILESTONE_CREATED: { icon: Flag, tone: 'text-accent bg-brand-soft' },
  MILESTONE_UPDATED: { icon: Flag, tone: 'text-muted bg-surface-2' },
  MILESTONE_DELETED: { icon: Flag, tone: 'text-danger bg-danger-soft' },
  DOCUMENT_SAVED: { icon: FileText, tone: 'text-muted bg-surface-2' },
  DOCUMENT_APPROVED: { icon: FileCheck2, tone: 'text-success bg-success-soft' },
  DOCUMENT_DELETED: { icon: FileText, tone: 'text-danger bg-danger-soft' },
};

const FIELD_LABEL: Record<string, string> = {
  status: 'Status',
  priority: 'Priority',
  assignee: 'Assignee',
  dueDate: 'Due date',
  criteria: 'Criteria',
  checklist: 'Checklist',
  dependency: 'Depends on',
  estimate: 'Estimate',
  milestone: 'Milestone',
  title: 'Title',
  role: 'Role',
};

/** Before → after values for a structured field change (idea from Plane's issue activity). */
function FieldChange({ field, oldValue, newValue }: { field: string; oldValue: string | null; newValue: string | null }) {
  const show = (v: string | null) => (v === null ? 'None' : field === 'dueDate' ? formatDate(v, 'd MMM yyyy') : v);
  return (
    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted">{FIELD_LABEL[field] ?? field}:</span>
      <span className="max-w-[16rem] truncate rounded-sm bg-surface-2 px-1.5 py-0.5 text-muted line-through decoration-subtle/70">{show(oldValue)}</span>
      <ArrowRight className="size-3 text-subtle" aria-label="changed to" />
      <span className="max-w-[16rem] truncate rounded-sm bg-surface-2 px-1.5 py-0.5 font-medium text-ink">{show(newValue)}</span>
    </p>
  );
}

interface Props {
  items: Activity[];
  showProject?: boolean;
  /** Link task keys to the task page. */
  linkTasks?: boolean;
  compact?: boolean;
}

/** Vertical timeline of activity entries. */
export function ActivityList({ items, showProject, linkTasks = true, compact }: Props) {
  return (
    <ol className="relative">
      {items.map((a, i) => {
        const { icon: Icon, tone } = ICON[a.type] ?? ICON.TASK_UPDATED;
        return (
          <li key={a.id} className={cn('relative flex gap-3', compact ? 'pb-4' : 'pb-5', i === items.length - 1 && 'pb-0')}>
            {i < items.length - 1 && <span className="absolute top-8 bottom-0 left-[15px] w-px bg-line" aria-hidden="true" />}
            <span className={cn('relative flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-surface', tone)}>
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-[13px] leading-snug text-ink-2">
                <Avatar user={a.actor} size="xs" className="mr-1.5 -mt-0.5 inline-flex align-middle ring-0" />
                <span className="font-medium text-ink">{a.actor.name}</span> {a.message}
                {linkTasks && a.taskId && a.taskKey && !a.message.includes(a.taskKey) && (
                  <>
                    {' '}
                    <Link to={`/projects/${a.projectId}/tasks/${a.taskId}`} className="font-mono text-xs text-accent hover:underline">
                      {a.taskKey}
                    </Link>
                  </>
                )}
              </p>
              {a.field && (a.oldValue || a.newValue) && <FieldChange field={a.field} oldValue={a.oldValue} newValue={a.newValue} />}
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                <time dateTime={a.createdAt} title={formatDateTime(a.createdAt)}>
                  {timeAgo(a.createdAt)}
                </time>
                {showProject && (
                  <Link to={`/projects/${a.projectId}`} className="hover:text-ink hover:underline">
                    {a.projectName}
                  </Link>
                )}
                {linkTasks && a.taskId && a.taskKey && a.message.includes(a.taskKey) && (
                  <Link to={`/projects/${a.projectId}/tasks/${a.taskId}`} className="text-accent hover:underline">
                    Open {a.taskKey}
                  </Link>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
