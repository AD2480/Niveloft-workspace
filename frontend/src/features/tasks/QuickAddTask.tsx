import { Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useCreateTaskMutation } from '@/api/endpoints';
import { getErrorMessage, getFieldErrors } from '@/api/errors';
import type { ProjectDetail } from '@/api/types';
import { atLeast } from '@/lib/permissions';
import { useCurrentUserId } from '../projects/projectContext';

/**
 * Inline "quick add" at the bottom of a board column: type a title, press Enter,
 * keep typing the next one. Escape closes it. (Interaction idea from Plane's
 * quick-add; implementation is original.) Use the full "New task" dialog for
 * descriptions, due dates and milestones.
 */
export function QuickAddTask({ project, status }: { project: ProjectDetail; status: 'TODO' | 'IN_PROGRESS' }) {
  const me = useCurrentUserId();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [createTask, { isLoading }] = useCreateTaskMutation();
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const t = title.trim();
    if (t.length < 3) {
      setError('Title must be at least 3 characters.');
      return;
    }
    try {
      const task = await createTask({
        projectId: project.id,
        body: {
          title: t,
          description: null,
          priority: 'MEDIUM',
          status,
          // Members may only assign to themselves; managers leave it for triage.
          assigneeId: atLeast(project.myRole, 'MANAGER') ? null : me,
          dueDate: null,
          milestoneId: null,
          estimateDays: null,
        },
      }).unwrap();
      toast.success(`${task.key} created`);
      setTitle('');
      setError(null);
      inputRef.current?.focus();
    } catch (e) {
      setError(getFieldErrors(e).title ?? getErrorMessage(e));
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-full items-center gap-1.5 rounded-lg px-2 text-[13px] text-muted transition-colors hover:bg-surface-3/60 hover:text-ink"
      >
        <Plus className="size-4" aria-hidden="true" /> Add task
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="rounded-lg border border-line-strong bg-surface p-2 shadow-card"
    >
      <input
        ref={inputRef}
        autoFocus
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            setTitle('');
            setError(null);
          }
        }}
        onBlur={() => {
          if (!title.trim()) setOpen(false);
        }}
        disabled={isLoading}
        maxLength={200}
        placeholder="Task title, then Enter"
        aria-label="New task title"
        aria-invalid={!!error}
        className="w-full bg-transparent text-[13px] text-ink placeholder:text-subtle focus:outline-none"
      />
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : <p className="mt-1 text-[12px] text-subtle">Enter to add, Esc to close</p>}
    </form>
  );
}
