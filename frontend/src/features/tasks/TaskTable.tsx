import { ArrowDown, ArrowUp, ArrowUpDown, Flag, MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router';
import type { Task, TaskSort } from '@/api/types';
import { DueDate, PriorityBadge, PriorityIcon, ProjectMark, StatusBadge } from '@/components/domain';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/dates';

interface Props {
  tasks: Task[];
  sort: TaskSort;
  direction: 'asc' | 'desc';
  onSort: (sort: TaskSort, direction: 'asc' | 'desc') => void;
  showProject?: boolean;
  dimmed?: boolean;
}

function SortHeader({ label, field, sort, direction, onSort, className }: { label: string; field: TaskSort } & Pick<Props, 'sort' | 'direction' | 'onSort'> & { className?: string }) {
  const active = sort === field;
  const Icon = !active ? ArrowUpDown : direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th scope="col" className={cn('px-3 py-2.5 text-left', className)} aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(field, active && direction === 'asc' ? 'desc' : 'asc')}
        className={cn('inline-flex items-center gap-1 rounded text-[12px] font-medium transition-colors hover:text-accent', active ? 'text-ink' : 'text-muted')}
      >
        {label}
        <Icon className={cn('size-3.5', !active && 'opacity-50')} aria-hidden="true" />
      </button>
    </th>
  );
}

export function TaskTable({ tasks, sort, direction, onSort, showProject, dimmed }: Props) {
  const navigate = useNavigate();
  const open = (t: Task) => navigate(`/projects/${t.projectId}/tasks/${t.id}`);
  const sp = { sort, direction, onSort };

  return (
    <div className={cn('overflow-hidden rounded-xl border border-line bg-surface shadow-card transition-opacity', dimmed && 'opacity-70')}>
      {/* Desktop table */}
      <table className="hidden w-full text-[13px] md:table">
        <thead className="border-b border-line bg-surface-2/60">
          <tr>
            <SortHeader label="Task" field="title" {...sp} className="pl-4" />
            <SortHeader label="Status" field="position" {...sp} className="w-32" />
            <SortHeader label="Priority" field="priority" {...sp} className="w-28" />
            <th scope="col" className="w-44 px-3 py-2.5 text-left text-[12px] font-medium text-muted">
              Assignee
            </th>
            <SortHeader label="Due" field="dueDate" {...sp} className="w-36" />
            <SortHeader label="Updated" field="updatedAt" {...sp} className="w-28 pr-4" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {tasks.map((t) => (
            <tr key={t.id} data-task-key={t.key} className="group cursor-pointer transition-colors hover:bg-surface-2/60" onClick={() => open(t)}>
              <td className="max-w-0 py-2.5 pr-3 pl-4">
                <div className="flex items-start gap-2.5">
                  {showProject && <ProjectMark name={t.projectName} color={t.projectColor} size="sm" />}
                  <span className="mt-px w-16 shrink-0 font-mono text-xs text-muted">{t.key}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <a
                        data-kb-item=""
                        href={`/projects/${t.projectId}/tasks/${t.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          open(t);
                        }}
                        className={cn('truncate font-medium text-ink group-hover:text-accent', t.status === 'DONE' && 'text-muted')}
                      >
                        {t.title}
                      </a>
                      {t.commentCount > 0 && (
                        <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted" aria-label={`${t.commentCount} comments`}>
                          <MessageSquare className="size-3" aria-hidden="true" />
                          {t.commentCount}
                        </span>
                      )}
                    </div>
                    {(t.milestoneName || showProject) && (
                      <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted">
                        {showProject && <span className="mr-2 truncate">{t.projectName}</span>}
                        {t.milestoneName && (
                          <>
                            <Flag className="size-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">{t.milestoneName}</span>
                          </>
                        )}
                      </p>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-3 py-2.5">
                <StatusBadge status={t.status} late={t.overdue} />
              </td>
              <td className="px-3 py-2.5">
                <PriorityBadge priority={t.priority} />
              </td>
              <td className="px-3 py-2.5">
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar user={t.assignee} size="sm" />
                  <span className={cn('truncate', t.assignee ? 'text-ink-2' : 'text-subtle')}>{t.assignee?.name ?? 'Unassigned'}</span>
                </span>
              </td>
              <td className="px-3 py-2.5">
                <DueDate date={t.dueDate} done={t.status === 'DONE'} />
              </td>
              <td className="px-3 py-2.5 pr-4 text-xs whitespace-nowrap text-muted">{timeAgo(t.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile list */}
      <ul className="divide-y divide-line md:hidden">
        {tasks.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => open(t)} data-kb-item="" className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-2/60">
              <PriorityIcon priority={t.priority} className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-mono text-muted">
                  {t.key}
                  {showProject && <span className="ml-2">{t.projectName}</span>}
                </span>
                <span className={cn('block text-[13.5px] font-medium text-ink', t.status === 'DONE' && 'text-ink-2')}>{t.title}</span>
                <span className="mt-1.5 flex flex-wrap items-center gap-2">
                  <StatusBadge status={t.status} late={t.overdue} />
                  <DueDate date={t.dueDate} done={t.status === 'DONE'} className="text-xs" />
                </span>
              </span>
              <Avatar user={t.assignee} size="sm" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
