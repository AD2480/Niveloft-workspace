import { AtSign, BellOff, CalendarClock, CheckCheck, CheckCircle2, Mail, MailOpen, MessageSquare, MoreHorizontal, RotateCcw, Send, Trash2, UserPlus, UserRoundCog, type LucideIcon } from 'lucide-react';
import { Fragment, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  useDeleteNotificationMutation,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
  useMyInvitationsQuery,
  useNotificationsQuery,
  useUnreadCountQuery,
} from '@/api/endpoints';
import { getErrorMessage } from '@/api/errors';
import type { Invitation, Notification, NotificationCategory, NotificationType } from '@/api/types';
import { PageContainer } from '@/components/layout/AppShell';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { LastUpdated } from '@/components/ui/LastUpdated';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Spinner';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { InvitationRow } from '@/features/projects/InvitationList';
import { cn } from '@/lib/cn';
import { dayHeading, formatDateTime, timeAgo } from '@/lib/dates';
import { useDocumentTitle, useUrlState } from '@/lib/hooks';
import { format, parseISO } from 'date-fns';

const TYPE_ICON: Record<NotificationType, { icon: LucideIcon; tone: string }> = {
  TASK_ASSIGNED: { icon: UserPlus, tone: 'bg-info-soft text-info' },
  INVITATION: { icon: Mail, tone: 'bg-brand-soft text-accent' },
  SUBMISSION: { icon: Send, tone: 'bg-warning-soft text-warning' },
  REVIEW_APPROVED: { icon: CheckCircle2, tone: 'bg-success-soft text-success' },
  CHANGES_REQUESTED: { icon: RotateCcw, tone: 'bg-warning-soft text-warning' },
  COMMENT: { icon: MessageSquare, tone: 'bg-surface-3 text-ink-2' },
  MENTION: { icon: AtSign, tone: 'bg-brand-soft text-brand-ink' },
  ROLE_CHANGED: { icon: UserRoundCog, tone: 'bg-info-soft text-info' },
  PLAN_CHANGED: { icon: CalendarClock, tone: 'bg-warning-soft text-warning' },
};

const EMPTY: Record<NotificationCategory, string> = {
  ALL: 'You’ll be told here when you’re assigned work, mentioned, invited, or when work you’re part of is submitted or reviewed.',
  UNREAD: 'You’ve read everything.',
  MENTIONS: 'When someone @mentions you in a comment or a task description, it shows up here.',
  ASSIGNMENTS: 'No task assignments yet.',
  INVITATIONS: 'No project invitations.',
  SUBMISSIONS: 'No submissions waiting on you.',
  REVIEWS: 'No review decisions yet.',
};

const KEY = /(?<![A-Za-z0-9_-])([A-Z][A-Z0-9]{1,9}-\d{1,6})(?![A-Za-z0-9_-])/;

/** The sentence with task keys set in the ink colour, so the eye finds what it's about. */
function withKeys(text: string): ReactNode {
  return text.split(KEY).map((part, i) =>
    i % 2 ? (
      <span key={i} className="font-medium whitespace-nowrap text-ink tabular">
        {part}
      </span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** "Priya commented on ONB-10: “…”" → the sentence and the quoted words, shown apart. */
function splitQuote(message: string): { head: string; quote: string | null } {
  const m = /^([\s\S]*?):\s“([\s\S]*)”$/.exec(message);
  return m ? { head: m[1], quote: m[2] } : { head: message, quote: null };
}

/** Today's notifications say how long ago; older ones sit under their day, so the time of day is enough. */
function when(iso: string): string {
  return dayHeading(iso) === 'Today' ? timeAgo(iso) : format(parseISO(iso), 'HH:mm');
}

export function InboxPage() {
  useDocumentTitle('Inbox');
  const navigate = useNavigate();
  const [f, setF] = useUrlState({ category: 'ALL', page: '0' });
  const category = f.category as NotificationCategory;
  const { data, isLoading, isFetching, isError, error, refetch, fulfilledTimeStamp } = useNotificationsQuery({ category, page: Number(f.page), size: 20 });
  const [confirmAll, setConfirmAll] = useState(false);
  const { data: unread = 0 } = useUnreadCountQuery();
  const { data: invitations } = useMyInvitationsQuery();
  const [markRead] = useMarkNotificationReadMutation();
  const [markAll, markAllState] = useMarkAllNotificationsReadMutation();
  const [remove] = useDeleteNotificationMutation();
  const pendingInvites = new Map((invitations ?? []).map((i) => [i.id, i]));

  const markAllNow = () =>
    markAll()
      .unwrap()
      .then(() => {
        setConfirmAll(false);
        toast.success('All notifications marked as read');
      })
      .catch((e) => toast.error(getErrorMessage(e)));

  const open = (n: Notification) => {
    if (!n.read) void markRead({ id: n.id });
    if (n.link && n.type !== 'INVITATION') navigate(n.link);
  };

  // One list per day, newest first (the page already comes newest first).
  const days: { heading: string; items: Notification[] }[] = [];
  for (const n of data?.content ?? []) {
    const heading = dayHeading(n.createdAt);
    if (days.at(-1)?.heading === heading) days.at(-1)!.items.push(n);
    else days.push({ heading, items: [n] });
  }

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader
        title="Inbox"
        description={unread ? `${unread} unread` : 'You’re all caught up.'}
        actions={
          <>
            <LastUpdated at={fulfilledTimeStamp} onRefresh={refetch} refreshing={isFetching} className="mr-2" />
            <Button
              variant="secondary"
              leftIcon={<CheckCheck />}
              disabled={unread === 0}
              loading={markAllState.isLoading}
              // A few are marked at once; more than that asks first, since it can't be undone.
              onClick={() => (unread > 3 ? setConfirmAll(true) : void markAllNow())}
            >
              Mark all as read
            </Button>
          </>
        }
      />

      <div className="scrollbar-thin -mx-4 mt-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <Segmented
          label="Filter notifications"
          value={category}
          onChange={(c) => setF({ category: c, page: '0' })}
          options={[
            { value: 'ALL', label: 'All' },
            { value: 'UNREAD', label: 'Unread', count: unread || undefined },
            { value: 'MENTIONS', label: 'Mentions' },
            { value: 'ASSIGNMENTS', label: 'Assignments' },
            { value: 'REVIEWS', label: 'Reviews' },
            { value: 'SUBMISSIONS', label: 'Submissions' },
            { value: 'INVITATIONS', label: 'Invitations', count: invitations?.length || undefined },
          ]}
        />
      </div>

      <div className="mt-2">
        {isLoading ? (
          <div className="mt-6 space-y-px overflow-hidden rounded-xl border border-line">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-[68px] w-full rounded-none" />
            ))}
          </div>
        ) : isError || !data ? (
          <ErrorState error={error} onRetry={refetch} title="Couldn’t load notifications" className="mt-4" />
        ) : data.content.length === 0 ? (
          <EmptyState icon={BellOff} title={category === 'MENTIONS' ? 'No mentions' : 'No notifications'} description={EMPTY[category]} className="mt-4" />
        ) : (
          <>
            <div className={cn('transition-opacity', isFetching && 'opacity-70')} data-inbox="">
              {days.map((day) => (
                <section key={day.heading} className="mt-5">
                  <h2 className="mb-1.5 px-1 text-[12.5px] font-medium text-muted">{day.heading}</h2>
                  <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
                    {day.items.map((n) => (
                      <InboxRow
                        key={n.id}
                        n={n}
                        invite={n.invitationId ? pendingInvites.get(n.invitationId) : undefined}
                        onOpen={() => open(n)}
                        onToggleRead={() => void markRead({ id: n.id, read: !n.read })}
                        onDelete={() =>
                          remove(n.id)
                            .unwrap()
                            .catch((e) => toast.error(getErrorMessage(e)))
                        }
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <Pagination page={data.page} totalPages={data.totalPages} totalElements={data.totalElements} size={data.size} onPageChange={(p) => setF({ page: String(p) })} noun="notifications" />
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={`Mark all ${unread} as read?`}
        description="They’ll stay in your inbox, but you won’t be able to tell which ones you haven’t opened yet."
        confirmLabel="Mark all as read"
        tone="primary"
        loading={markAllState.isLoading}
        onConfirm={markAllNow}
      />
    </PageContainer>
  );
}

function InboxRow({ n, invite, onOpen, onToggleRead, onDelete }: { n: Notification; invite?: Invitation; onOpen: () => void; onToggleRead: () => void; onDelete: () => void }) {
  const { icon: Icon, tone } = TYPE_ICON[n.type] ?? TYPE_ICON.COMMENT;
  const { head, quote } = splitQuote(n.message);
  return (
    <li className="group relative flex items-start gap-3 py-3 pr-2 pl-2.5 transition-colors hover:bg-surface-2 sm:pr-3 sm:pl-3" data-notification={n.type} data-unread={n.read ? undefined : ''}>
      {/* Unread: a dot in its own column, so read and unread rows line up. */}
      <span className={cn('mt-[13px] size-1.5 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-brand')} aria-hidden="true" />
      <div className="relative mt-0.5 shrink-0">
        {n.actor ? <Avatar user={n.actor} size="md" /> : <span className="block size-8 rounded-full bg-surface-3" />}
        <span className={cn('absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full ring-2 ring-surface group-hover:ring-surface-2', tone)}>
          <Icon className="size-2.5" aria-hidden="true" strokeWidth={2.5} />
        </span>
      </div>
      <div className="min-w-0 flex-1">
        {/* The whole row opens it; the buttons on the right sit above this. */}
        <button type="button" onClick={onOpen} data-kb-item="" className="block w-full text-left outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-[var(--ring)]">
          <span className="flex items-baseline gap-3">
            <span className={cn('min-w-0 flex-1 truncate text-[13.5px]', n.read ? 'text-ink-2' : 'font-semibold text-ink')}>
              {n.title}
              {!n.read && <span className="sr-only"> (unread)</span>}
            </span>
            <time className="shrink-0 text-[12px] text-muted tabular" dateTime={n.createdAt} title={formatDateTime(n.createdAt)}>
              {when(n.createdAt)}
            </time>
          </span>
          <span className="mt-0.5 line-clamp-2 block text-[13px] text-ink-2 transition-colors group-hover:text-ink">{withKeys(head)}</span>
          {quote && <span className="mt-1.5 line-clamp-2 block border-l-2 border-line-strong pl-2.5 text-[13px] text-ink">{quote}</span>}
        </button>
        {invite && (
          <div className="relative z-10 mt-3 rounded-lg border border-line bg-surface p-3">
            <InvitationRow invitation={invite} compact />
          </div>
        )}
        {n.type === 'INVITATION' && !invite && <p className="mt-1 text-xs text-muted">This invitation has already been answered or revoked.</p>}
      </div>
      {/* With a mouse, quick actions appear over the end of the row; they take no room until then. */}
      <div className="absolute top-2 right-2 z-10 hidden items-center rounded-md bg-surface-2 opacity-0 shadow-[0_0_0_4px_var(--surface-2)] transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-fine:flex">
        <Button variant="ghost" size="icon-sm" aria-label={n.read ? 'Mark as unread' : 'Mark as read'} title={n.read ? 'Mark as unread' : 'Mark as read'} onClick={onToggleRead}>
          {n.read ? <Mail /> : <MailOpen />}
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Delete notification" title="Delete" onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>
      {/* On touch screens there's no hover, so the same actions sit in a menu. */}
      <div className="relative z-10 -my-1 hidden shrink-0 pointer-coarse:block">
        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Notification actions">
              <MoreHorizontal />
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem icon={n.read ? <Mail /> : <MailOpen />} onSelect={onToggleRead}>
              Mark as {n.read ? 'unread' : 'read'}
            </MenuItem>
            <MenuItem icon={<Trash2 />} danger onSelect={onDelete}>
              Delete
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </li>
  );
}
