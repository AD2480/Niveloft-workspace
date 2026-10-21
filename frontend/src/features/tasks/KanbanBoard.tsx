import {
  closestCenter,
  defaultDropAnimationSideEffects,
  DndContext,
  DragOverlay,
  getFirstCollision,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Ban, CheckCircle2, ListTree, RotateCcw, Send } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useMoveTaskMutation } from '@/api/endpoints';
import { getErrorMessage } from '@/api/errors';
import type { ProjectDetail, ReviewDecision, Role, Task, TaskStatus } from '@/api/types';
import { StatusGlyph } from '@/components/glyphs';
import { cn } from '@/lib/cn';
import { STATUS_LABEL, TASK_STATUSES } from '@/lib/constants';
import { atLeast, can, statusChangeBlockedReason } from '@/lib/permissions';
import { useCurrentUserId } from '../projects/projectContext';
import { QuickAddTask } from './QuickAddTask';
import { SubmitWorkDialog } from './SubmitWorkDialog';
import { TaskCard } from './TaskCard';
import { TaskGroupsDialog } from './TaskGroupsDialog';

type Columns = Record<TaskStatus, number[]>;

const COLUMN_HINT: Record<TaskStatus, string> = {
  TODO: 'Planned work',
  IN_PROGRESS: 'Being worked on',
  IN_REVIEW: 'Submitted, awaiting review',
  DONE: 'Approved by a reviewer',
};

const colId = (s: TaskStatus) => `col:${s}`;

function buildColumns(tasks: Task[]): Columns {
  const cols: Columns = { TODO: [], IN_PROGRESS: [], IN_REVIEW: [], DONE: [] };
  [...tasks].sort((a, b) => a.position - b.position || a.id - b.id).forEach((t) => cols[t.status].push(t.id));
  return cols;
}

function findContainer(cols: Columns, id: UniqueIdentifier): TaskStatus | null {
  if (typeof id === 'string' && id.startsWith('col:')) return id.slice(4) as TaskStatus;
  return TASK_STATUSES.find((s) => cols[s].includes(id as number)) ?? null;
}

/**
 * What happens if the dragged task is released over a column. The board shows
 * this *while dragging* (idea from Plane's drag overlay), so users learn the
 * workflow rules before they drop rather than from an error afterwards.
 */
type DropRule =
  | { kind: 'same' | 'move'; message?: undefined }
  | { kind: 'submit'; message: string }
  | { kind: 'review'; decision: ReviewDecision; message: string }
  | { kind: 'blocked'; message: string };

function dropRule(task: Task, to: TaskStatus, role: Role, me: number, readOnly: boolean): DropRule {
  const from = task.status;
  if (from === to) return readOnly ? { kind: 'blocked', message: 'You have read-only access.' } : { kind: 'same' };
  if (readOnly) return { kind: 'blocked', message: 'You have read-only access.' };
  const tl = { status: from, assigneeId: task.assignee?.id ?? null, reporterId: task.reporter.id };
  const isOwnWork = task.assignee?.id === me;
  if (to === 'IN_REVIEW') {
    if (can.submitWork(role, tl, me)) return { kind: 'submit', message: 'Release to submit your work for review' };
    if (isOwnWork) return { kind: 'blocked', message: 'Only tasks that are to do or in progress can be submitted' };
    return { kind: 'blocked', message: task.assignee ? `Only ${task.assignee.name}, the assignee, can submit this task` : 'Assign this task first: only its assignee can submit it' };
  }
  if (from === 'IN_REVIEW') {
    if (!atLeast(role, 'MANAGER')) return { kind: 'blocked', message: 'Waiting for a reviewer’s decision' };
    if (isOwnWork) return { kind: 'blocked', message: 'You can’t review your own submission' };
    return to === 'DONE'
      ? { kind: 'review', decision: 'APPROVED', message: 'Release to open the review' }
      : { kind: 'review', decision: 'CHANGES_REQUESTED', message: 'Release to review and request changes' };
  }
  if (to === 'DONE') return { kind: 'blocked', message: statusChangeBlockedReason(from, to) ?? 'Needs reviewer approval' };
  if (!can.changeStatus(role, tl, me, to)) return { kind: 'blocked', message: `Only ${task.assignee ? `${task.assignee.name} (the assignee)` : 'its assignee'} or a Manager can move this task` };
  return { kind: 'move' };
}

const dropAnimation: DropAnimation = {
  duration: 180,
  easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.4' } } }),
};

interface KanbanBoardProps {
  project: ProjectDetail;
  /** Every task in the project. */
  tasks: Task[];
  /** Tasks currently visible after filters. */
  visible: Task[];
  onOpenTask: (task: Task) => void;
}

export function KanbanBoard({ project, tasks, visible, onOpenTask }: KanbanBoardProps) {
  const me = useCurrentUserId();
  const role = project.myRole;
  const [moveTask] = useMoveTaskMutation();
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const [columns, setColumns] = useState<Columns>(() => buildColumns(visible));
  const [activeId, setActiveId] = useState<number | null>(null);
  const [overStatus, setOverStatus] = useState<TaskStatus | null>(null);
  const [submitTask, setSubmitTask] = useState<Task | null>(null);
  const [listStatus, setListStatus] = useState<TaskStatus | null>(null);
  const navigate = useNavigate();
  const readOnly = !can.createTask(role) || project.status === 'ARCHIVED';

  const lastOverId = useRef<UniqueIdentifier | null>(null);
  const recentlyMovedToNewContainer = useRef(false);

  // Re-sync from server data whenever it changes and nothing is being dragged
  // (this also restores the original layout after a cancelled or refused drop).
  useEffect(() => {
    if (activeId === null) setColumns(buildColumns(visible));
  }, [visible, activeId]);

  useEffect(() => {
    requestAnimationFrame(() => {
      recentlyMovedToNewContainer.current = false;
    });
  }, [columns]);

  const active = activeId !== null ? byId.get(activeId) : undefined;
  const rules = useMemo(() => {
    if (!active) return null;
    return Object.fromEntries(TASK_STATUSES.map((s) => [s, dropRule(active, s, role, me, readOnly)])) as Record<TaskStatus, DropRule>;
  }, [active, role, me, readOnly]);

  /**
   * Collision detection for multiple sortable columns. Adapted from the
   * "MultipleContainers" example in dnd-kit (MIT, © Claudéric Demers):
   * prefer droppables under the pointer, fall back to rectangle intersection,
   * resolve a column hit to its closest card, and remember the last target so
   * the card doesn't flicker while columns re-measure after a move.
   */
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const pointerHits = pointerWithin(args);
      const intersections = pointerHits.length > 0 ? pointerHits : rectIntersection(args);
      let overId = getFirstCollision(intersections, 'id');
      if (overId != null) {
        if (typeof overId === 'string' && overId.startsWith('col:')) {
          const items = columns[overId.slice(4) as TaskStatus] ?? [];
          if (items.length > 0) {
            overId =
              closestCenter({
                ...args,
                droppableContainers: args.droppableContainers.filter((c) => c.id !== overId && items.includes(c.id as number)),
              })[0]?.id ?? overId;
          }
        }
        lastOverId.current = overId;
        return [{ id: overId }];
      }
      if (recentlyMovedToNewContainer.current) lastOverId.current = activeId;
      return lastOverId.current ? [{ id: lastOverId.current }] : [];
    },
    [activeId, columns],
  );

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  );

  const keyOf = (id: UniqueIdentifier) => byId.get(id as number)?.key ?? 'task';
  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `Picked up ${keyOf(a.id)}.`,
    onDragOver: ({ active: a, over }) => {
      const s = over ? findContainer(columns, over.id) : null;
      if (!s) return undefined;
      const rule = rules?.[s];
      return `${keyOf(a.id)} is over ${STATUS_LABEL[s]}.${rule?.message ? ` ${rule.message}.` : ''}`;
    },
    onDragEnd: ({ active: a, over }) => {
      const s = over ? findContainer(columns, over.id) : null;
      return s ? `${keyOf(a.id)} released over ${STATUS_LABEL[s]}.` : 'Drop cancelled.';
    },
    onDragCancel: ({ active: a }) => `Moving ${keyOf(a.id)} was cancelled.`,
  };

  const reset = () => {
    setActiveId(null);
    setOverStatus(null);
    lastOverId.current = null;
  };

  const handleDragStart = ({ active: a }: DragStartEvent) => setActiveId(a.id as number);

  const handleDragOver = ({ active: a, over }: DragOverEvent) => {
    const to = over ? findContainer(columns, over.id) : null;
    setOverStatus(to);
    if (!over || !to || !rules) return;
    // Only reflow cards for plain moves; submit/review/blocked columns show a message instead.
    if (rules[to].kind !== 'move' && rules[to].kind !== 'same') return;
    setColumns((cols) => {
      const from = findContainer(cols, a.id);
      if (!from || from === to) return cols;
      const overIndex = cols[to].indexOf(over.id as number);
      const insertAt = overIndex >= 0 ? overIndex : cols[to].length;
      recentlyMovedToNewContainer.current = true;
      return {
        ...cols,
        [from]: cols[from].filter((id) => id !== a.id),
        [to]: [...cols[to].slice(0, insertAt), a.id as number, ...cols[to].slice(insertAt)],
      };
    });
  };

  const handleDragEnd = ({ active: a, over }: DragEndEvent) => {
    const id = a.id as number;
    const task = byId.get(id);
    const to = over ? findContainer(columns, over.id) : null;
    const rule = to && rules ? rules[to] : null;
    reset();
    if (!task || !to || !over || !rule) return;

    if (rule.kind === 'submit') return setSubmitTask(task);
    // Reviews happen in the review workspace, where the evidence and criteria are side by side.
    if (rule.kind === 'review') {
      return navigate(`/projects/${task.projectId}/tasks/${task.id}/review${rule.decision === 'CHANGES_REQUESTED' ? '?intent=changes' : ''}`);
    }
    if (rule.kind === 'blocked') {
      if (to !== task.status) toast.error(rule.message);
      return;
    }

    // Final order of the destination column as the user sees it.
    let list = columns[to];
    const oldIndex = list.indexOf(id);
    const overIndex = list.indexOf(over.id as number);
    if (overIndex >= 0 && oldIndex !== overIndex) list = arrayMove(list, oldIndex, overIndex);
    const idx = list.indexOf(id);
    if (idx < 0) return;

    const original = buildColumns(visible)[task.status];
    if (to === task.status && original.indexOf(id) === idx) return; // dropped where it started

    // Send neighbours, not an index: the server computes a fractional position between them.
    moveTask({ id, projectId: project.id, status: to, previousTaskId: list[idx - 1] ?? null, nextTaskId: list[idx + 1] ?? null })
      .unwrap()
      .then(() => {
        if (task.status === 'DONE' && to !== 'DONE') toast.success(`${task.key} reopened`);
      })
      .catch((e) => toast.error(getErrorMessage(e)));
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={reset}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              'To pick up a task, press Space. Use the arrow keys to move it between columns, Space again to drop, or Escape to cancel. Press Enter to open the task.',
          },
        }}
      >
        <div className="scrollbar-thin -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0 lg:snap-none">
          {TASK_STATUSES.map((status) => (
            <Column
              key={status}
              project={project}
              status={status}
              ids={columns[status]}
              byId={byId}
              activeId={activeId}
              total={tasks.filter((t) => t.status === status).length}
              rule={rules?.[status] ?? null}
              isOver={overStatus === status}
              canAdd={!readOnly && (status === 'TODO' || status === 'IN_PROGRESS')}
              disabled={readOnly}
              onOpen={onOpenTask}
              onList={() => setListStatus(status)}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={dropAnimation}>{active ? <TaskCard task={active} overlay /> : null}</DragOverlay>
      </DndContext>

      <SubmitWorkDialog task={submitTask} open={submitTask !== null} onOpenChange={(o) => !o && setSubmitTask(null)} />
      <TaskGroupsDialog
        key={listStatus ?? 'none'}
        open={listStatus !== null}
        onOpenChange={(o) => !o && setListStatus(null)}
        title={listStatus ? `${STATUS_LABEL[listStatus]}, as a list` : ''}
        description="The cards in this column (with your filters), grouped and sorted by due date."
        tasks={listStatus ? columns[listStatus].map((id) => byId.get(id)).filter((t): t is Task => !!t) : []}
        listLink={listStatus ? `../tasks?status=${listStatus}` : undefined}
        onOpenTask={onOpenTask}
      />
    </>
  );
}

interface ColumnProps {
  project: ProjectDetail;
  status: TaskStatus;
  ids: number[];
  byId: Map<number, Task>;
  activeId: number | null;
  total: number;
  rule: DropRule | null;
  isOver: boolean;
  canAdd: boolean;
  disabled: boolean;
  onOpen: (task: Task) => void;
  onList: () => void;
}

const RULE_ICON = { submit: Send, review: CheckCircle2, blocked: Ban };

function Column({ project, status, ids, byId, activeId, total, rule, isOver, canAdd, disabled, onOpen, onList }: ColumnProps) {
  const { setNodeRef } = useDroppable({ id: colId(status) });
  const shown = ids.filter((id) => byId.has(id));
  const dragging = activeId !== null;
  const special = rule && (rule.kind === 'submit' || rule.kind === 'review' || rule.kind === 'blocked') ? rule : null;
  const Icon = special ? (special.kind === 'review' && special.decision === 'CHANGES_REQUESTED' ? RotateCcw : RULE_ICON[special.kind]) : null;

  return (
    <section
      aria-label={`${STATUS_LABEL[status]} column`}
      className={cn(
        'relative flex w-[85vw] max-w-[320px] shrink-0 snap-start flex-col rounded-xl bg-surface-2/70 ring-1 ring-line transition-opacity sm:w-[300px] lg:w-auto lg:max-w-none lg:min-w-[260px] lg:flex-1',
        dragging && special?.kind === 'blocked' && !isOver && 'opacity-55',
        isOver && rule?.kind === 'move' && 'ring-2 ring-brand/60',
      )}
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-1">
        <StatusGlyph status={status} />
        <h2 className="text-[13px] font-semibold text-ink">{STATUS_LABEL[status]}</h2>
        <span className="rounded-full bg-surface-3 px-1.5 text-xs font-medium text-muted tabular">{shown.length !== total ? `${shown.length}/${total}` : total}</span>
        <button
          type="button"
          onClick={onList}
          disabled={shown.length === 0}
          title="Show as a grouped list"
          aria-label={`Show ${STATUS_LABEL[status]} as a grouped list`}
          className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-3 hover:text-ink disabled:opacity-40"
        >
          <ListTree className="size-4" aria-hidden="true" />
        </button>
      </header>
      <p className="px-3 pb-2 text-[12px] text-muted">{COLUMN_HINT[status]}</p>

      <SortableContext id={colId(status)} items={shown} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex min-h-32 flex-1 flex-col gap-2 px-2 pb-2">
          {shown.map((id) => (
            <SortableTask key={id} task={byId.get(id)!} dimmed={activeId === id} disabled={disabled} onOpen={onOpen} />
          ))}
          {shown.length === 0 && !dragging && (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-line-strong/70 px-3 py-6 text-center text-xs text-muted">
              {status === 'IN_REVIEW' ? 'Drag a task here to submit it for review' : status === 'DONE' ? 'Approved tasks appear here' : 'No tasks'}
            </div>
          )}
        </div>
      </SortableContext>

      {canAdd && (
        <div className="px-2 pb-2">
          <QuickAddTask project={project} status={status as 'TODO' | 'IN_PROGRESS'} />
        </div>
      )}

      {/* Drop feedback while dragging over a column that doesn't simply reorder (Plane-style). */}
      {dragging && isOver && special && Icon && (
        <div
          role="status"
          className={cn(
            'pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 text-center text-[13px] font-medium backdrop-blur-[1px] animate-fade-in',
            special.kind === 'blocked' ? 'border-danger/50 bg-danger-soft/90 text-danger' : 'border-ink/40 bg-surface/90 text-ink',
          )}
        >
          <Icon className="size-5" aria-hidden="true" />
          {special.message}
        </div>
      )}
    </section>
  );
}

function SortableTask({ task, dimmed, disabled, onOpen }: { task: Task; dimmed: boolean; disabled: boolean; onOpen: (t: Task) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: task.id, disabled, data: { type: 'task', status: task.status } });
  return (
    <TaskCard
      ref={setNodeRef}
      task={task}
      dragging={dimmed}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-roledescription="Draggable task"
      aria-label={`${task.key}: ${task.title}. ${STATUS_LABEL[task.status]}.`}
      className={cn(disabled ? 'cursor-pointer' : 'cursor-grab touch-manipulation active:cursor-grabbing')}
      onClick={() => onOpen(task)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onOpen(task);
          return;
        }
        listeners?.onKeyDown?.(e);
      }}
    />
  );
}

