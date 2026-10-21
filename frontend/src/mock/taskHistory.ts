import type { MockDb, ProjectRow } from './schema';

/**
 * The task-history file for training a deadline forecast, as the server writes it
 * (TaskHistoryExport.java; the ml/ kit reads it): dates, estimates, priorities, dependencies and
 * counts, with people as p1, p2, … and nothing anyone wrote. Version 1 of the format.
 */
export const TASK_HISTORY_COLUMNS = [
  'project',
  'task',
  'status',
  'priority',
  'estimate_days',
  'person',
  'created_at',
  'started_at',
  'blockers_approved_at',
  'last_review_at',
  'approved_at',
  'due_date',
  'waits_on',
  'holds_up',
  'criteria',
  'checklist',
  'description_chars',
  'submissions',
  'changes_requested',
] as const;

/** An instant the way the server writes it (Java's Instant: no milliseconds when they're zero). */
const instant = (iso: string | null | undefined): string => (iso ? new Date(iso).toISOString().replace('.000Z', 'Z') : '');

export function taskHistoryCsv(db: MockDb, project: ProjectRow): string {
  const tasks = db.tasks.filter((t) => t.projectId === project.id).sort((a, b) => a.number - b.number);
  const byId = new Map(db.tasks.map((t) => [t.id, t]));
  const deps = db.dependencies.filter((d) => d.projectId === project.id);
  const people = new Map<number, string>();
  const rows = tasks.map((t) => {
    const person = t.assigneeId === null ? '' : (people.get(t.assigneeId) ?? (people.set(t.assigneeId, `p${people.size + 1}`), people.get(t.assigneeId)!));
    const approved = t.status === 'DONE' ? t.completedAt : null;
    const blockers = deps
      .filter((d) => d.blockedTaskId === t.id)
      .map((d) => byId.get(d.blockerTaskId))
      .filter((b) => b !== undefined);
    const blockersApproved =
      blockers.length && blockers.every((b) => b.status === 'DONE' && b.completedAt)
        ? blockers
            .map((b) => b.completedAt!)
            .sort((a, b) => Date.parse(a) - Date.parse(b))
            .at(-1)!
        : null;
    const lastReview = db.statusEvents
      .filter((e) => e.taskId === t.id && e.to === 'IN_REVIEW' && (!approved || Date.parse(e.at) <= Date.parse(approved)))
      .map((e) => e.at)
      .sort((a, b) => Date.parse(a) - Date.parse(b))
      .at(-1);
    const subs = db.submissions.filter((s) => s.taskId === t.id);
    const changes = db.reviews.filter((r) => r.decision === 'CHANGES_REQUESTED' && subs.some((s) => s.id === r.submissionId)).length;
    return [
      project.key,
      `${project.key}-${t.number}`,
      t.status,
      t.priority,
      t.estimateDays === null ? '' : String(t.estimateDays),
      person,
      instant(t.createdAt),
      instant(t.startedAt),
      instant(blockersApproved),
      instant(lastReview),
      instant(approved),
      t.dueDate ?? '',
      String(blockers.length),
      String(deps.filter((d) => d.blockerTaskId === t.id).length),
      String(db.criteria.filter((c) => c.taskId === t.id).length),
      String(db.checklistItems.filter((c) => c.taskId === t.id).length),
      String(t.description?.length ?? 0),
      String(subs.length),
      String(changes),
    ].join(',');
  });
  return [TASK_HISTORY_COLUMNS.join(','), ...rows].join('\n') + '\n';
}
