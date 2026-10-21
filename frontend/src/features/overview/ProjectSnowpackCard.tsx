import { ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Dependency, Task, TaskStatus } from '@/api/types';
import { Skeleton } from '@/components/ui/Spinner';
import { SnowpackStage } from '@/features/public/home/SnowpackStage';
import { cn } from '@/lib/cn';
import { todayIso } from '@/lib/dates';
import { useMediaQuery } from '@/lib/hooks';
import { LAYER_WORD, type LayerKey } from '@/three/snowpack';
import { projectSnowpack } from './projectSnowpack';

const SWATCH: Record<LayerKey | 'weak', string> = {
  todo: 'var(--strata-todo)',
  progress: 'var(--strata-progress)',
  review: 'var(--strata-review)',
  done: 'var(--strata-done)',
  weak: 'var(--strata-weak)',
};

/** The layers top down, the way a snow pit is read, and the scroll-story step that lifts each one out. */
const ROWS: { key: LayerKey; status: TaskStatus; step: number }[] = [
  { key: 'todo', status: 'TODO', step: 1 },
  { key: 'progress', status: 'IN_PROGRESS', step: 2 },
  { key: 'review', status: 'IN_REVIEW', step: 3 },
  { key: 'done', status: 'DONE', step: 4 },
];

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
const tasksWord = (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`;

/**
 * The project as a block of snowpack, made from its own tasks: one slice per task in the layer of
 * its state, late tasks in red, and the weak layer (the late task holding the most work up) called
 * out. Beside it, the layers as a list: pointing at one lifts it out of the block, and each opens
 * its tasks. The block is decoration for screen readers; the list says the same in words.
 */
export function ProjectSnowpackCard({
  projectId,
  tasks,
  dependencies,
  loading,
  onOpen,
}: {
  projectId: number;
  tasks: Task[] | undefined;
  dependencies: Dependency[] | undefined;
  loading: boolean;
  /** Opens a layer's tasks (or the late ones) in a list. */
  onOpen: (what: TaskStatus | 'OVERDUE') => void;
}) {
  const navigate = useNavigate();
  const data = useMemo(() => projectSnowpack(tasks ?? [], dependencies ?? [], todayIso()), [tasks, dependencies]);
  const [story, setStory] = useState(0);
  const wide = useMediaQuery('(min-width: 1024px)');
  const total = data.tasks.length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const weak = data.weak;
  const point = (step: number) => ({
    onMouseEnter: () => setStory(step),
    onMouseLeave: () => setStory(0),
    onFocus: () => setStory(step),
    onBlur: () => setStory(0),
  });

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-card" aria-labelledby="snowpack-heading" data-project-snowpack="">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="bg-plate relative h-[300px] sm:h-[360px] lg:h-[430px]">
          {loading && !tasks ? (
            <Skeleton className="absolute inset-0 rounded-none opacity-60" />
          ) : total === 0 ? (
            <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-[13.5px] text-muted">
              No tasks yet. Each task you add becomes a slice of this block.
            </p>
          ) : (
            <SnowpackStage
              data={data}
              story={story}
              framing={{ x: 0, y: wide ? -0.03 : -0.05 }}
              layerLabels={false}
              ambient={false}
              markLate
              zoom={wide ? 1.22 : 1.08}
              onTask={(t) => t.id !== undefined && navigate(`/projects/${projectId}/tasks/${t.id}`)}
              className="absolute inset-0"
            />
          )}
          <p className="pointer-events-none absolute bottom-3 left-4 hidden text-[12px] text-muted sm:block">Drag to turn it. Click a slice to open its task.</p>
        </div>

        <div className="flex flex-col border-t border-line p-5 lg:border-t-0 lg:border-l">
          <h2 id="snowpack-heading" className="text-[15px] font-semibold text-ink">
            The snowpack
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted" data-snowpack-summary="">
            {loading && !tasks
              ? 'Reading the tasks…'
              : `One slice per task, in the layer of its state. ${
                  weak
                    ? `${weak.key} is the weak layer: ${days(weak.late)} late and holding up ${tasksWord(weak.holdsUp.length)}.`
                    : data.late
                      ? `${data.late === 1 ? 'One task is' : `${data.late} tasks are`} late, but nothing late holds other work up.`
                      : 'Nothing is late.'
                }`}
          </p>
          <ul className="mt-4 -mx-2 space-y-0.5" aria-label="Layers">
            {ROWS.map((r) => (
              <li key={r.key}>
                <button
                  type="button"
                  onClick={() => onOpen(r.status)}
                  {...point(r.step)}
                  className={cn('group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors', story === r.step ? 'bg-surface-2' : 'hover:bg-surface-2')}
                  data-snowpack-layer={r.key}
                >
                  <span className="size-3 shrink-0 rounded-[4px]" style={{ backgroundColor: SWATCH[r.key] }} aria-hidden="true" />
                  <span className="flex-1 text-[13.5px] font-medium text-ink">{LAYER_WORD[r.key]}</span>
                  <span className="text-[13.5px] font-semibold text-ink tabular">{data.counts[r.key]}</span>
                  <span className="w-10 text-right text-[12.5px] text-muted tabular">{pct(data.counts[r.key])}%</span>
                  <ChevronRight className="size-4 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden="true" />
                </button>
              </li>
            ))}
            <li className="mt-1 border-t border-line pt-1">
              <button
                type="button"
                onClick={() => onOpen('OVERDUE')}
                {...point(5)}
                className={cn('group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors', story === 5 ? 'bg-surface-2' : 'hover:bg-surface-2')}
                data-snowpack-layer="weak"
              >
                <span className="size-3 shrink-0 rounded-[4px]" style={{ backgroundColor: SWATCH.weak }} aria-hidden="true" />
                <span className="flex-1 text-[13.5px] font-medium text-ink">Late</span>
                <span className={cn('text-[13.5px] font-semibold tabular', data.late ? 'text-danger' : 'text-ink')}>{data.late}</span>
                <span className="w-10 text-right text-[12.5px] text-muted tabular">{pct(data.late)}%</span>
                <ChevronRight className="size-4 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden="true" />
              </button>
            </li>
          </ul>
          <p className="mt-auto pt-4 text-[12.5px] leading-relaxed text-muted">Point at a layer to lift it out of the block. Each opens its tasks, grouped and sorted.</p>
        </div>
      </div>
    </section>
  );
}
