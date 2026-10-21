/**
 * Pure helpers for task dependencies (finish-to-start: blocker → blocked).
 * Used by the task page, the board, the dependency map and the timeline.
 */
import type { Dependency, DependencyTask } from '@/api/types';

export interface DependencyIndex {
  /** taskId → dependencies where the task is the blocked one ("waiting on"). */
  blockersOf: Map<number, Dependency[]>;
  /** taskId → dependencies where the task is the blocker ("holding up"). */
  blocking: Map<number, Dependency[]>;
}

export function buildIndex(deps: readonly Dependency[]): DependencyIndex {
  const blockersOf = new Map<number, Dependency[]>();
  const blocking = new Map<number, Dependency[]>();
  for (const d of deps) {
    blockersOf.set(d.blocked.id, [...(blockersOf.get(d.blocked.id) ?? []), d]);
    blocking.set(d.blocker.id, [...(blocking.get(d.blocker.id) ?? []), d]);
  }
  return { blockersOf, blocking };
}

/** Unfinished tasks this task is waiting on. */
export function openBlockers(index: DependencyIndex, taskId: number): DependencyTask[] {
  return (index.blockersOf.get(taskId) ?? []).map((d) => d.blocker).filter((t) => t.status !== 'DONE');
}

function adjacency(deps: readonly Dependency[], reverse = false): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const d of deps) {
    const [from, to] = reverse ? [d.blocked.id, d.blocker.id] : [d.blocker.id, d.blocked.id];
    out.set(from, [...(out.get(from) ?? []), to]);
  }
  return out;
}

function reach(edges: Map<number, number[]>, start: number): Set<number> {
  const seen = new Set<number>();
  const stack = [...(edges.get(start) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(edges.get(n) ?? []));
  }
  return seen;
}

/** Every task that (transitively) waits on `taskId`. Such tasks can't become its blockers without a loop. */
export function downstream(deps: readonly Dependency[], taskId: number): Set<number> {
  return reach(adjacency(deps), taskId);
}

/** Every task `taskId` (transitively) waits on. */
export function upstream(deps: readonly Dependency[], taskId: number): Set<number> {
  return reach(adjacency(deps, true), taskId);
}

export interface GraphNode {
  task: DependencyTask;
  layer: number;
  row: number;
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: Dependency[];
  layers: number;
  rows: number;
}

/**
 * Left-to-right layered layout: a task's column is the length of the longest chain of
 * blockers in front of it (so every arrow points right). Rows within a column are ordered
 * by the average row of their blockers to reduce crossings, then by key.
 * Assumes no cycles (the server rejects them); any leftover nodes are placed in column 0.
 */
export function layoutGraph(deps: readonly Dependency[], options: { hideDone?: boolean } = {}): GraphLayout {
  const edges = options.hideDone ? deps.filter((d) => d.blocker.status !== 'DONE' && d.blocked.status !== 'DONE') : [...deps];
  const tasks = new Map<number, DependencyTask>();
  for (const d of edges) {
    tasks.set(d.blocker.id, d.blocker);
    tasks.set(d.blocked.id, d.blocked);
  }
  const preds = new Map<number, number[]>();
  const succs = new Map<number, number[]>();
  for (const d of edges) {
    preds.set(d.blocked.id, [...(preds.get(d.blocked.id) ?? []), d.blocker.id]);
    succs.set(d.blocker.id, [...(succs.get(d.blocker.id) ?? []), d.blocked.id]);
  }
  // Kahn's algorithm, tracking the longest path to each node.
  const indeg = new Map<number, number>();
  for (const id of tasks.keys()) indeg.set(id, preds.get(id)?.length ?? 0);
  const layer = new Map<number, number>();
  const queue = [...tasks.keys()].filter((id) => indeg.get(id) === 0);
  for (const id of queue) layer.set(id, 0);
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of succs.get(id) ?? []) {
      layer.set(next, Math.max(layer.get(next) ?? 0, (layer.get(id) ?? 0) + 1));
      indeg.set(next, (indeg.get(next) ?? 1) - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  }
  for (const id of tasks.keys()) if (!layer.has(id)) layer.set(id, 0);

  const layers = Math.max(0, ...layer.values()) + 1;
  const rowOf = new Map<number, number>();
  let rows = 0;
  for (let l = 0; l < layers; l++) {
    const ids = [...tasks.keys()].filter((id) => layer.get(id) === l);
    const bary = (id: number) => {
      const ps = (preds.get(id) ?? []).map((p) => rowOf.get(p)).filter((r): r is number => r !== undefined);
      return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Number.MAX_SAFE_INTEGER;
    };
    ids.sort((a, b) => bary(a) - bary(b) || tasks.get(a)!.key.localeCompare(tasks.get(b)!.key, undefined, { numeric: true }));
    ids.forEach((id, i) => rowOf.set(id, i));
    rows = Math.max(rows, ids.length);
  }
  const nodes = [...tasks.values()].map((task) => ({ task, layer: layer.get(task.id)!, row: rowOf.get(task.id)! }));
  return { nodes, edges, layers: tasks.size ? layers : 0, rows };
}

/**
 * The longest chain of unfinished tasks, counted in tasks (not time: Niveloft has no
 * durations yet, so this is deliberately not called a "critical path").
 */
export function longestOpenChain(deps: readonly Dependency[]): DependencyTask[] {
  const open = deps.filter((d) => d.blocker.status !== 'DONE' && d.blocked.status !== 'DONE');
  const tasks = new Map<number, DependencyTask>();
  for (const d of open) {
    tasks.set(d.blocker.id, d.blocker);
    tasks.set(d.blocked.id, d.blocked);
  }
  const succs = adjacency(open);
  const memo = new Map<number, number[]>();
  const visiting = new Set<number>();
  const best = (id: number): number[] => {
    const cached = memo.get(id);
    if (cached) return cached;
    if (visiting.has(id)) return [id]; // defensive: cycles are rejected by the server
    visiting.add(id);
    let chain: number[] = [id];
    for (const n of succs.get(id) ?? []) {
      const c = best(n);
      if (c.length + 1 > chain.length) chain = [id, ...c];
    }
    visiting.delete(id);
    memo.set(id, chain);
    return chain;
  };
  let longest: number[] = [];
  for (const id of tasks.keys()) {
    const c = best(id);
    if (c.length > longest.length) longest = c;
  }
  return longest.length > 1 ? longest.map((id) => tasks.get(id)!) : [];
}
