import { describe, expect, it } from 'vitest';
import type { Member, StatusChange, Task } from '@/api/types';
import { forecastProgress } from '@/lib/progressForecast';
import { buildProjectModel } from '@/three/projectModel';
import { blockerImpact, optionDelta, recoveryOptions } from './recovery';

const user = (id: number, name: string) => ({ id, name, email: `${id}@x.dev`, avatarColor: '#000' });
const asha = user(1, 'Asha Rao');
const ben = user(2, 'Ben Okafor');
const cleo = user(3, 'Cleo Park');
const member = (u: ReturnType<typeof user>, role: Member['role']): Member => ({ id: u.id, user: { ...u, jobTitle: null }, role, joinedAt: '', openTaskCount: 0 });
const members = [member(asha, 'MEMBER'), member(ben, 'MANAGER'), member(cleo, 'OWNER')];

function task(id: number, patch: Partial<Task>): Task {
  return {
    id, projectId: 1, projectKey: 'T', projectName: 'T', projectColor: '#000', key: `T-${id}`, title: `Task ${id}`, description: null,
    status: 'TODO', priority: 'MEDIUM', assignee: asha, reporter: cleo, dueDate: null, milestoneId: null, milestoneName: null, position: id,
    commentCount: 0, submissionCount: 0, overdue: false, createdAt: '2026-09-01T09:00:00Z', updatedAt: '2026-09-01T09:00:00Z', startedAt: null,
    completedAt: null, acceptanceCriteria: [], checklist: [], version: 3, estimateDays: 2, ...patch,
  } as Task;
}

/** Six approved tasks; T-7 (Asha, in progress, 4 days) holds up T-8 and T-9; T-10 is in review, submitted by Asha. */
function project(blockerPatch: Partial<Task> = {}) {
  const history: StatusChange[] = [];
  const tasks: Task[] = [];
  for (let i = 1; i <= 6; i++) {
    const who = i % 2 ? asha : ben;
    const s = `2026-09-${String(i * 2).padStart(2, '0')}T09:00:00Z`;
    const d = `2026-09-${String(i * 2 + 2).padStart(2, '0')}T16:00:00Z`;
    tasks.push(task(i, { assignee: who, status: 'DONE', startedAt: s, completedAt: d }));
    history.push({ taskId: i, from: 'TODO', to: 'IN_PROGRESS', at: s }, { taskId: i, from: 'IN_PROGRESS', to: 'IN_REVIEW', at: d.replace('16:', '09:') }, { taskId: i, from: 'IN_REVIEW', to: 'DONE', at: d });
  }
  const t7 = task(7, { status: 'IN_PROGRESS', estimateDays: 4, startedAt: '2026-10-15T09:00:00Z', ...blockerPatch });
  tasks.push(t7, task(8, { assignee: ben, estimateDays: 3 }), task(9, { assignee: ben, estimateDays: 3 }), task(10, { status: 'IN_REVIEW', startedAt: '2026-10-10T09:00:00Z' }));
  history.push({ taskId: 7, from: 'TODO', to: 'IN_PROGRESS', at: '2026-10-15T09:00:00Z' }, { taskId: 10, from: 'TODO', to: 'IN_PROGRESS', at: '2026-10-10T09:00:00Z' }, { taskId: 10, from: 'IN_PROGRESS', to: 'IN_REVIEW', at: '2026-10-13T09:00:00Z' });
  const dep = (blocked: number, blocker: number) => ({ id: blocked * 10 + blocker, blocker: { id: blocker, key: `T-${blocker}`, title: '', status: 'TODO' }, blocked: { id: blocked, key: `T-${blocked}`, title: '', status: 'TODO' }, createdAt: '' });
  const deps = [dep(8, 7), dep(9, 7), dep(9, 10)];
  const model = buildProjectModel({ now: new Date('2026-10-20T12:00:00Z'), projectStart: '2026-09-01', deadline: '2026-11-20', tasks, dependencies: deps as never, milestones: [], history, projection: null });
  const f = forecastProgress({ model, tasks, members });
  return { tasks, model, f, t7: tasks.find((t) => t.id === 7)!, t10: tasks.find((t) => t.id === 10)!, held: [tasks[7], tasks[8]] };
}

describe('blocker journey: cost and responses', () => {
  it('prices a blocker by the forecast with it done today, and a review by another week’s wait too', () => {
    const p = project();
    const work = blockerImpact(p.model, p.tasks, members, p.f, { task: p.t7 });
    expect(work.costDays).toBeGreaterThanOrEqual(0);
    expect(work.ifWaits).toBeNull();
    const review = blockerImpact(p.model, p.tasks, members, p.f, { task: p.t10 });
    expect(review.ifWaits).not.toBeNull();
    expect(review.waitDays).toBeGreaterThanOrEqual(0);
    // Decided today can't be later than as it stands; waiting a week can't be sooner.
    expect(review.ifDone.project.finish!.p50).toBeLessThanOrEqual(p.f.project.finish!.p50);
    expect(review.ifWaits!.project.finish!.p50).toBeGreaterThanOrEqual(p.f.project.finish!.p50);
  });

  it('offers a review decision only to someone who may make it, and asks the other reviewers by name', () => {
    const p = project();
    const impact = blockerImpact(p.model, p.tasks, members, p.f, { task: p.t10 });
    const base = { projectId: 1, model: p.model, tasks: p.tasks, members, forecast: p.f, blocker: { task: p.t10, kind: 'review' as const, holdsUp: [p.tasks[8]] }, impact, submitterId: asha.id, inReviewSince: 'Mon 13 Oct' };
    const asManager = recoveryOptions({ ...base, me: { id: ben.id, role: 'MANAGER' } });
    expect(asManager.map((o) => o.id)).toEqual(['review-now', 'ask-review']);
    expect(asManager[0].blockedReason).toBeNull();
    expect(asManager[0].action).toEqual({ type: 'open', to: '/projects/1/tasks/10/review' });
    const ask = asManager[1].action;
    expect(ask.type === 'comment' && ask.text).toBe('@Cleo Park T-10 has been waiting for a review since Mon 13 Oct, and T-9 waits on it. Could one of you review it?');
    const asSubmitter = recoveryOptions({ ...base, me: { id: asha.id, role: 'MEMBER' } });
    expect(asSubmitter[0].blockedReason).toBe('You submitted this work, so someone else has to review it.');
    expect(asSubmitter[1].action.type === 'comment' && asSubmitter[1].action.text.startsWith('@Ben Okafor @Cleo Park ')).toBe(true);
  });

  it('compares cutting scope, moving the work and asking its owner, with the person’s own permissions', () => {
    const p = project();
    const impact = blockerImpact(p.model, p.tasks, members, p.f, { task: p.t7 });
    const ctx = { projectId: 1, model: p.model, tasks: p.tasks, members, forecast: p.f, blocker: { task: p.t7, kind: 'in-progress' as const, holdsUp: p.held }, impact, submitterId: null, inReviewSince: null };
    const asBen = recoveryOptions({ ...ctx, me: { id: ben.id, role: 'MANAGER' } });
    expect(asBen.map((o) => o.kind)).toEqual(['cut-scope', 'cut-scope', 'reassign', 'reassign', 'ask-owner']);
    expect(asBen.slice(0, 2).map((o) => o.action)).toEqual([
      { type: 'estimate', taskId: 7, from: 4, days: 3 },
      { type: 'estimate', taskId: 7, from: 4, days: 2 },
    ]);
    expect(asBen.every((o) => o.blockedReason === null)).toBe(true);
    // A smaller estimate, with the same draws, can't make the finish later.
    for (const o of asBen.filter((x) => x.kind === 'cut-scope')) expect(optionDelta(p.model, p.f, o)!).toBeLessThanOrEqual(0);
    const owner = asBen.find((o) => o.kind === 'ask-owner')!;
    expect(owner.forecast).toBeNull();
    expect(owner.action.type === 'comment' && owner.action.text).toBe('@Asha Rao T-7 is holding up T-8 and T-9. What would help it finish sooner, and is anything in the way that isn’t recorded?');

    const asCleoViewer = recoveryOptions({ ...ctx, me: { id: 99, role: 'VIEWER' } });
    expect(asCleoViewer.find((o) => o.kind === 'cut-scope')!.blockedReason).toBe('Only managers, or the task’s owner or creator, can change its estimate.');
    expect(asCleoViewer.find((o) => o.kind === 'reassign')!.blockedReason).toBe('Only owners and managers can give work to someone else.');
    expect(asCleoViewer.find((o) => o.kind === 'ask-owner')!.blockedReason).toBe('Only members can write comments.');
  });

  it('lets a member take unowned work themselves', () => {
    const p = project({ assignee: null });
    const impact = blockerImpact(p.model, p.tasks, members, p.f, { task: p.t7 });
    const opts = recoveryOptions({ projectId: 1, model: p.model, tasks: p.tasks, members, forecast: p.f, blocker: { task: p.t7, kind: 'not-started', holdsUp: p.held }, impact, me: { id: asha.id, role: 'MEMBER' }, submitterId: null, inReviewSince: null });
    const take = opts.find((o) => o.kind === 'take-it')!;
    expect(take.title).toBe('Take T-7 yourself');
    expect(take.blockedReason).toBeNull();
    expect(opts.find((o) => o.kind === 'reassign')!.blockedReason).toBe('Only owners and managers can give work to someone else.');
    expect(opts.some((o) => o.kind === 'ask-owner')).toBe(false);
  });
});
