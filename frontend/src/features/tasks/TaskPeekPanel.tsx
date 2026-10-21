import * as RD from '@radix-ui/react-dialog';
import { Maximize2, X } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { TaskDetailView } from '@/pages/project/TaskDetailPage';
import { useProjectContext } from '../projects/projectContext';

/**
 * Task details in a side panel over the board, driven by the URL
 * (`/projects/:projectId/board/tasks/:taskId`). The board, its filters and
 * scroll position stay in place, and the URL can be shared or reloaded.
 * Interaction adapted from jira_clone's routed issue modal and Plane's
 * "peek overview"; implementation is original.
 */
export function TaskPeekPanel() {
  const { taskId } = useParams();
  const { project } = useProjectContext();
  const navigate = useNavigate();
  const location = useLocation();
  const boardUrl = `/projects/${project.id}/board${location.search}`;
  const close = () => navigate(boardUrl);

  return (
    <RD.Root open onOpenChange={(o) => !o && close()}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-black/25 animate-fade-in" />
        <RD.Content
          className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[720px] flex-col border-l border-line bg-canvas shadow-pop focus:outline-none"
          style={{ animation: 'slide-in-right 220ms cubic-bezier(0.16, 1, 0.3, 1)' }}
          aria-describedby={undefined}
        >
          <RD.Title className="sr-only">Task details</RD.Title>
          <div className="scrollbar-thin flex-1 overflow-y-auto">
            <TaskDetailView
              taskId={Number(taskId)}
              variant="panel"
              onDeleted={close}
              headerExtra={
                <>
                  <Tooltip content="Open full page">
                    <Link
                      to={`/projects/${project.id}/tasks/${taskId}`}
                      aria-label="Open full page"
                      className="inline-flex size-8 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                    >
                      <Maximize2 className="size-4" />
                    </Link>
                  </Tooltip>
                  <RD.Close asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Close panel">
                      <X />
                    </Button>
                  </RD.Close>
                </>
              }
            />
          </div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
