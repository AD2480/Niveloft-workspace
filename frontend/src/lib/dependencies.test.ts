import { describe, expect, it } from 'vitest';
import type { Dependency, DependencyTask, TaskStatus } from '@/api/types';
import { buildIndex, downstream, layoutGraph, longestOpenChain, openBlockers, upstream } from './dependencies';

const t = (id: number, status: TaskStatus = 'TODO'): DependencyTask => ({
  id,
  key: `T-${id}`,
  title: `Task ${id}`,
  status,
  dueDate: null,
  assignee: null,
  overdue: false,
  startedAt: null,
  completedAt: null,
  milestoneId: null,
});
let seq = 0;
const dep = (a: DependencyTask, b: DependencyTask): Dependency => ({
  id: ++seq,
  projectId: 1,
  blocker: a,
  blocked: b,
  createdBy: { id: 1, name: 'A', email: 'a@x', avatarColor: '#000000' },
  createdAt: '2026-09-01T00:00:00Z',
});

//   1 → 2 → 4
//   1 → 3 → 4 → 5,  6(done) → 5
const [n1, n2, n3, n4, n5, n6] = [t(1, 'DONE'), t(2), t(3), t(4), t(5), t(6, 'DONE')];
const deps = [dep(n1, n2), dep(n1, n3), dep(n2, n4), dep(n3, n4), dep(n4, n5), dep(n6, n5)];

describe('dependencies', () => {
  it('indexes blockers and finds unfinished ones', () => {
    const idx = buildIndex(deps);
    expect(openBlockers(idx, 4).map((x) => x.id)).toEqual([2, 3]);
    expect(openBlockers(idx, 5).map((x) => x.id)).toEqual([4]);
    expect(openBlockers(idx, 2)).toEqual([]);
  });

  it('walks upstream and downstream', () => {
    expect([...downstream(deps, 2)].sort()).toEqual([4, 5]);
    expect([...upstream(deps, 4)].sort()).toEqual([1, 2, 3]);
  });

  it('lays out columns by the longest chain of blockers', () => {
    const g = layoutGraph(deps);
    const col = (id: number) => g.nodes.find((n) => n.task.id === id)!.layer;
    expect([col(1), col(2), col(3), col(4), col(5)]).toEqual([0, 1, 1, 2, 3]);
    expect(col(6)).toBe(0);
    for (const e of g.edges) expect(col(e.blocked.id)).toBeGreaterThan(col(e.blocker.id));
  });

  it('can hide finished work', () => {
    const g = layoutGraph(deps, { hideDone: true });
    expect(g.nodes.map((n) => n.task.id).sort()).toEqual([2, 3, 4, 5]);
  });

  it('reports the longest unfinished chain by task count', () => {
    expect(longestOpenChain(deps).map((x) => x.id)).toHaveLength(3);
    expect(longestOpenChain([])).toEqual([]);
  });
});
