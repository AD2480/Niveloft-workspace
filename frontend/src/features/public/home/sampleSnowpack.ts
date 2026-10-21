/**
 * The front page's reading of the sample project as a snowpack: every task in its layer (approved,
 * in review, in progress, not started), the late task holding the most work up (the weak layer),
 * and the few figures the page quotes. Worked out from the sample's records, so every figure on the
 * page is real; pure, so it's tested.
 */
import { weakTask, type BlockTask, type LayerKey, type SnowpackData } from '@/three/snowpack';
import { ONBOARDING_SAMPLE, type SampleSpec } from '../sampleProject';

export interface SampleSnowpack extends SnowpackData {
  tasks: (BlockTask & { owner: string | null })[];
  /** Work nobody owns yet (not started or in progress). */
  unowned: string[];
  people: number;
}

const LAYER_OF = { DONE: 'done', IN_REVIEW: 'review', IN_PROGRESS: 'progress', TODO: 'todo' } as const;

export function sampleSnowpack(spec: SampleSpec = ONBOARDING_SAMPLE): SampleSnowpack {
  const status = new Map(spec.tasks.map((t) => [t.n, (t.moves.length ? t.moves[t.moves.length - 1][1] : 'TODO') as keyof typeof LAYER_OF]));
  const waiters = new Map<number, number[]>();
  for (const t of spec.tasks) for (const w of t.waitsOn ?? []) waiters.set(w, [...(waiters.get(w) ?? []), t.n]);
  const heldUp = (n: number): number[] => {
    const out: number[] = [];
    const queue = [...(waiters.get(n) ?? [])];
    while (queue.length) {
      const m = queue.shift()!;
      if (out.includes(m) || status.get(m) === 'DONE') continue;
      out.push(m);
      queue.push(...(waiters.get(m) ?? []));
    }
    return out;
  };
  const tasks = spec.tasks.map((t) => {
    const s = status.get(t.n) ?? 'TODO';
    const layer = LAYER_OF[s];
    return {
      key: `${spec.key}-${t.n}`,
      title: t.title,
      layer,
      late: s !== 'DONE' && t.due !== null && t.due < 0 ? -t.due : 0,
      holdsUp: s === 'DONE' ? [] : heldUp(t.n).map((m) => `${spec.key}-${m}`),
      owner: t.who ? spec.people[t.who]?.name ?? null : null,
    };
  });
  const counts: Record<LayerKey, number> = { done: 0, review: 0, progress: 0, todo: 0 };
  for (const t of tasks) counts[t.layer]++;
  return {
    tasks,
    counts,
    weak: weakTask(tasks),
    unowned: tasks.filter((t) => !t.owner && (t.layer === 'todo' || t.layer === 'progress')).map((t) => t.key),
    people: Object.keys(spec.people).length,
  };
}
