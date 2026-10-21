import { MessageSquare, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { toast } from 'sonner';
import { useAddCommentMutation, useCommentsQuery, useDeleteCommentMutation, useEditCommentMutation } from '@/api/endpoints';
import { getErrorMessage } from '@/api/errors';
import type { Comment, Role, Task } from '@/api/types';
import { useAppSelector } from '@/app/store';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { RichText } from '@/components/RichText';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { Skeleton } from '@/components/ui/Spinner';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { WritingField, WritingHint } from '@/features/refs/WritingField';
import { cn } from '@/lib/cn';
import { formatDateTime, timeAgo } from '@/lib/dates';
import { atLeast, can } from '@/lib/permissions';
import { useTrackedForm } from '@/lib/useTrackedForm';

const MAX = 2000;

function Composer({
  initial = '',
  onSubmit,
  onCancel,
  submitLabel,
  loading,
  autoFocus,
  projectId,
}: {
  initial?: string;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
  submitLabel: string;
  loading: boolean;
  autoFocus?: boolean;
  projectId: number;
}) {
  const [body, setBody] = useState(initial);
  const [preview, setPreview] = useState(false);
  const trimmed = body.trim();
  const submit = async () => {
    if (!trimmed || trimmed.length > MAX) return;
    if (await onSubmit(trimmed)) {
      setBody('');
      setPreview(false);
    }
  };
  return (
    <div className="space-y-2" data-comment-composer="">
      {preview ? (
        <div className="min-h-[88px] rounded-lg border border-line bg-surface-2/60 px-3 py-2.5" data-comment-preview="">
          {trimmed ? <RichText text={trimmed} projectId={projectId} size="sm" /> : <p className="text-[13px] text-muted">Nothing to preview yet.</p>}
        </div>
      ) : (
        <WritingField
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Write a comment… @ to mention, # to link a task"
          aria-label="Comment"
          autoFocus={autoFocus}
          projectId={projectId}
          onSubmitShortcut={() => void submit()}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setPreview((p) => !p)}
            className="text-[12.5px] font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline"
            aria-pressed={preview}
            data-comment-preview-toggle=""
          >
            {preview ? 'Write' : 'Preview'}
          </button>
          {body.length > MAX ? (
            <span className="text-xs text-danger tabular">{body.length - MAX} characters over the limit</span>
          ) : (
            <WritingHint className="hidden truncate md:block" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-[12px] text-muted lg:inline">⌘/Ctrl + Enter</span>
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={loading}>
              Cancel
            </Button>
          )}
          <Button size="sm" onClick={() => void submit()} loading={loading} disabled={!trimmed || trimmed.length > MAX}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CommentItem({ comment, task, role, highlighted }: { comment: Comment; task: Task; role: Role; highlighted: boolean }) {
  const me = useAppSelector((s) => s.auth.user?.id);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editComment, editState] = useEditCommentMutation();
  const [deleteComment, deleteState] = useDeleteCommentMutation();
  const mine = comment.author.id === me;
  const canDelete = mine || atLeast(role, 'MANAGER');

  return (
    <li
      id={`comment-${comment.id}`}
      className={cn('-mx-2 flex scroll-mt-28 gap-3 rounded-lg px-2 py-1.5 transition-colors duration-700', highlighted ? 'bg-brand-soft' : 'bg-transparent')}
      data-comment={comment.id}
    >
      <Avatar user={comment.author} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-ink">{comment.author.name}</span>
          <time className="text-xs text-muted" dateTime={comment.createdAt} title={formatDateTime(comment.createdAt)}>
            {timeAgo(comment.createdAt)}
          </time>
          {comment.updatedAt && <span className="text-xs text-subtle">(edited)</span>}
          {(mine || canDelete) && !editing && (
            <Menu>
              <MenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Comment actions">
                  <MoreHorizontal />
                </Button>
              </MenuTrigger>
              <MenuContent>
                {mine && (
                  <MenuItem icon={<Pencil />} onSelect={() => setEditing(true)}>
                    Edit
                  </MenuItem>
                )}
                {canDelete && (
                  <MenuItem icon={<Trash2 />} danger onSelect={() => setConfirming(true)}>
                    Delete
                  </MenuItem>
                )}
              </MenuContent>
            </Menu>
          )}
        </div>
        {editing ? (
          <div className="mt-2">
            <Composer
              projectId={task.projectId}
              initial={comment.body}
              submitLabel="Save"
              autoFocus
              loading={editState.isLoading}
              onCancel={() => setEditing(false)}
              onSubmit={async (body) => {
                try {
                  await editComment({ id: comment.id, taskId: task.id, body }).unwrap();
                  setEditing(false);
                  return true;
                } catch (e) {
                  toast.error(getErrorMessage(e));
                  return false;
                }
              }}
            />
          </div>
        ) : (
          <RichText text={comment.body} projectId={task.projectId} className="mt-1 text-[13.5px]" />
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete comment?"
        description="This comment will be permanently removed."
        confirmLabel="Delete"
        loading={deleteState.isLoading}
        onConfirm={async () => {
          try {
            await deleteComment({ id: comment.id, taskId: task.id, projectId: task.projectId }).unwrap();
            setConfirming(false);
            toast.success('Comment deleted');
          } catch (e) {
            toast.error(getErrorMessage(e));
          }
        }}
      />
    </li>
  );
}

export function CommentsPanel({ task, role }: { task: Task; role: Role }) {
  const { data, isLoading, isError, error, refetch } = useCommentsQuery(task.id);
  const [addComment, { isLoading: adding }] = useAddCommentMutation();
  const track = useTrackedForm('comment', can.comment(role));
  const { hash } = useLocation();
  const [highlighted, setHighlighted] = useState<number | null>(null);

  // A link to one comment (from the inbox, or "Mentioned in" on another task) scrolls to it and marks it for a moment.
  useEffect(() => {
    const id = Number(/^#comment-(\d+)$/.exec(hash)?.[1]);
    if (!id || !data?.some((c) => c.id === id)) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(`comment-${id}`)?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    setHighlighted(id);
    const t = window.setTimeout(() => setHighlighted(null), 2600);
    return () => window.clearTimeout(t);
  }, [hash, data]);

  return (
    <div className="space-y-6">
      {isLoading ? (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} title="Couldn’t load comments" />
      ) : data && data.length > 0 ? (
        <ul className="space-y-3">
          {data.map((c) => (
            <CommentItem key={c.id} comment={c} task={task} role={role} highlighted={highlighted === c.id} />
          ))}
        </ul>
      ) : (
        <EmptyState icon={MessageSquare} title="No comments yet" description="Ask a question or share an update with the team." compact />
      )}

      {can.comment(role) ? (
        <Composer
          projectId={task.projectId}
          submitLabel="Comment"
          loading={adding}
          onSubmit={async (body) => {
            track.submitted();
            try {
              await addComment({ taskId: task.id, projectId: task.projectId, body }).unwrap();
              track.succeeded();
              return true;
            } catch (e) {
              track.failed(e);
              toast.error(getErrorMessage(e));
              return false;
            }
          }}
        />
      ) : (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-center text-xs text-muted">Viewers can read comments but not post them.</p>
      )}
    </div>
  );
}
