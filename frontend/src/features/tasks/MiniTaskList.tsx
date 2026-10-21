import { Link } from 'react-router';
import type { Task } from '@/api/types';
import { DueDate, PriorityIcon, ProjectMark } from '@/components/domain';
import { Avatar } from '@/components/ui/Avatar';

/** Compact list of tasks for dashboards and overview cards. */
export function MiniTaskList({ tasks, showProject, showAssignee }: { tasks: Task[]; showProject?: boolean; showAssignee?: boolean }) {
  return (
    <ul className="divide-y divide-line">
      {tasks.map((t) => (
        <li key={t.id}>
          <Link to={`/projects/${t.projectId}/tasks/${t.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-2/70">
            {showProject ? <ProjectMark name={t.projectName} color={t.projectColor} size="sm" /> : <PriorityIcon priority={t.priority} />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink">{t.title}</span>
              <span className="mt-0.5 flex min-w-0 gap-2 text-xs text-muted">
                <span className="shrink-0 tabular">{t.key}</span>
                {showProject && <span className="truncate">{t.projectName}</span>}
              </span>
            </span>
            <DueDate date={t.dueDate} done={t.status === 'DONE'} className="text-xs" showIcon={false} />
            {showAssignee && <Avatar user={t.assignee} size="sm" tooltip />}
          </Link>
        </li>
      ))}
    </ul>
  );
}
