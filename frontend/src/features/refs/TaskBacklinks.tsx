import { Link2 } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useTaskMentionsQuery } from '@/api/endpoints';
import type { Task, TaskMention } from '@/api/types';
import { StatusGlyph } from '@/components/glyphs';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/States';
import { formatDateTime, timeAgo } from '@/lib/dates';

/** The excerpt with this task's key marked, so you see at a glance what was said about it. */
function marked(text: string, key: string): ReactNode {
  // The key on its own, not inside a longer one (ONB-1 in ONB-10).
  const parts = text.split(new RegExp(`(?<![A-Za-z0-9_-])${key.replace(/[-]/g, '\\-')}(?![A-Za-z0-9_-])`));
  return parts.map((p, i) => (
    <Fragment key={i}>
      {p}
      {i < parts.length - 1 && <mark className="rounded-[3px] bg-brand-soft px-0.5 font-medium text-brand-ink">{key}</mark>}
    </Fragment>
  ));
}

function where(m: TaskMention) {
  return m.source === 'COMMENT' ? `${m.author ? `${m.author.name.split(' ')[0]}’s` : 'A'} comment` : 'Description';
}

/**
 * Backlinks: the other tasks whose description or comments name this task by its key, from the
 * projects you're on (the server leaves out anything you can't open).
 */
export function TaskBacklinks({ task }: { task: Task }) {
  const { data, isLoading, isError, refetch } = useTaskMentionsQuery(task.id);
  return (
    <Card data-backlinks="">
      <CardHeader title={<>Mentioned in{data && data.length > 0 && <span className="ml-1.5 font-normal text-muted tabular">{data.length}</span>}</>} />
      <CardBody>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : isError || !data ? (
          <p className="text-[13px] text-muted">
            Couldn’t check where {task.key} is mentioned.{' '}
            <button type="button" className="font-medium text-accent hover:underline" onClick={() => void refetch()}>
              Try again
            </button>
          </p>
        ) : data.length === 0 ? (
          <EmptyState
            icon={Link2}
            title="Not mentioned anywhere yet"
            description={`Write ${task.key} in another task or a comment, or type # and pick it, and it will be listed here.`}
          />
        ) : (
          <ul className="-my-2 divide-y divide-line">
            {data.map((m) => (
              <li key={`${m.source}-${m.commentId ?? m.taskId}`} className="py-2.5" data-backlink={m.source}>
                <div className="flex min-w-0 items-center gap-2 text-[13px]">
                  <StatusGlyph status={m.taskStatus} />
                  <Link
                    to={`/projects/${m.projectId}/tasks/${m.taskId}${m.commentId ? `#comment-${m.commentId}` : ''}`}
                    className="flex min-w-0 items-baseline gap-2 text-ink hover:text-accent"
                  >
                    <span className="shrink-0 text-muted tabular">{m.taskKey}</span>
                    <span className="truncate font-medium">{m.taskTitle}</span>
                  </Link>
                  <span className="ml-auto flex shrink-0 items-baseline gap-2 pl-2 text-[12px] text-muted">
                    <span className="hidden sm:inline">{m.projectId === task.projectId ? where(m) : `${where(m)} in ${m.projectName}`}</span>
                    <time dateTime={m.at} title={formatDateTime(m.at)} className="tabular">
                      {timeAgo(m.at)}
                    </time>
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 pl-[22px] text-[13px] leading-relaxed text-ink-2">{marked(m.excerpt, task.key)}</p>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
