import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/hooks';
import type { SnowpackAnchor, SnowpackScene } from '@/three/SnowpackScene';
import { LAYER_WORD, type LayerKey, type SnowpackData } from '@/three/snowpack';
import { spreadLabels, stillModel, type StillModel } from '@/three/snowpackFrame';
import { isDarkTheme, lowPowerGuess, onThemeChange, webglAvailable, whenIdle } from '@/three/capabilities';

const SWATCH: Record<LayerKey, string> = {
  todo: 'var(--strata-todo)',
  progress: 'var(--strata-progress)',
  review: 'var(--strata-review)',
  done: 'var(--strata-done)',
};

/**
 * The stage for the front page's snowpack: the canvas (three.js, loaded after the first paint), the
 * layer labels that follow the block, a tooltip for the slice under the pointer, and a still drawing
 * before the scene is ready (and for browsers without WebGL). Decoration: the same facts are in the
 * page's words, so the whole stage is hidden from screen readers.
 */
type StageTask = SnowpackData['tasks'][number];

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
const tasksWord = (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`;

export function SnowpackStage({
  data,
  story,
  framing,
  className,
  onTask,
  layerLabels = true,
  ambient = true,
  markLate = false,
  zoom = 1,
}: {
  data: SnowpackData;
  story: number;
  framing: { x: number; y: number };
  className?: string;
  onTask?: (task: StageTask) => void;
  /** The labels that follow the layers (off where the layers are listed beside the block). */
  layerLabels?: boolean;
  /** Snow falling and a slow sway (off in the workspace). */
  ambient?: boolean;
  /** Draw every late task red, not only the weak layer. */
  markLate?: boolean;
  /** Closer (above 1) or further (below 1) than the default framing. */
  zoom?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const scene = useRef<SnowpackScene | null>(null);
  const labels = useRef(new Map<string, HTMLDivElement>());
  /** Moves a label to its anchor; the weak layer's box slides sideways to stay inside the stage. */
  const place = (a: { id: string; x: number; y: number }) => {
    const el = labels.current.get(a.id);
    if (!el) return;
    el.style.transform = `translate3d(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px, 0)`;
    if (a.id !== 'weak') return;
    const tag = el.querySelector<HTMLElement>('[data-weak-box]');
    const width = box.current?.clientWidth ?? 0;
    if (!tag || !width) return;
    const w = tag.offsetWidth;
    const left = a.x - w / 2;
    const shift = Math.min(Math.max(left, 8), Math.max(8, width - w - 8)) - left;
    tag.style.setProperty('--shift', `${shift.toFixed(1)}px`);
  };
  const [ready, setReady] = useState(false);
  const [noGl] = useState(() => typeof window !== 'undefined' && !webglAvailable());
  const [hover, setHover] = useState<{ task: StageTask; x: number; y: number } | null>(null);
  const compact = !useMediaQuery('(min-width: 768px)');
  const reduce = useMediaQuery('(prefers-reduced-motion: reduce)');
  const drag = useRef<{ x: number; moved: boolean; id: number } | null>(null);
  const storyRef = useRef(story);
  storyRef.current = story;
  const framingRef = useRef(framing);
  framingRef.current = framing;
  const signature = useMemo(() => `${data.tasks.map((t) => `${t.key}:${t.layer}:${t.late > 0 ? 1 : 0}`).join('|')}#${data.weak?.key ?? ''}`, [data]);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [dark, setDark] = useState(isDarkTheme);
  const lateKeys = useMemo(() => (markLate ? data.tasks.filter((t) => t.late > 0).map((t) => t.key) : []), [data, markLate]);

  // The stage's size and the theme, for the still drawing (the scene keeps its own).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize((cur) => (cur && Math.abs(cur.w - e.contentRect.width) < 0.5 && Math.abs(cur.h - e.contentRect.height) < 0.5 ? cur : { w: e.contentRect.width, h: e.contentRect.height })));
    ro.observe(el);
    const off = onThemeChange(() => setDark(isDarkTheme()));
    return () => {
      ro.disconnect();
      off();
    };
  }, []);

  // The still: the settled block projected with the scene's own camera, so one fades into the other in place.
  const still = useMemo(
    () => (size && size.w > 0 && size.h > 0 ? stillModel(data.tasks, { weakKey: data.weak?.key ?? null, lateKeys, dark, size, framing, zoom, compact }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature, lateKeys, dark, size, framing.x, framing.y, zoom, compact],
  );

  // Until the scene draws (and without WebGL), the labels sit where the still puts them.
  useLayoutEffect(() => {
    if (ready || !still) return;
    for (const a of spreadLabels(still.anchors)) place(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still, ready]);

  // Build the scene once the page has painted (three.js is a separate download).
  useEffect(() => {
    if (noGl) return;
    let cancelled = false;
    let dispose: (() => void) | null = null;
    const boot = async () => {
      const { SnowpackScene } = await import('@/three/SnowpackScene');
      if (cancelled || !canvas.current || !box.current) return;
      const s = new SnowpackScene(canvas.current, {
        tasks: data.tasks,
        weakKey: data.weak?.key ?? null,
        lateKeys,
        ambient,
        zoom,
        // The still is already showing the settled block; the scene starts settled too.
        intro: false,
        dark: isDarkTheme(),
        compact,
        lowPower: lowPowerGuess(),
        reducedMotion: reduce,
        framing: framingRef.current,
        onAnchors: (anchors: SnowpackAnchor[]) => {
          for (const a of spreadLabels(anchors)) place(a);
        },
      });
      scene.current = s;
      const r = box.current.getBoundingClientRect();
      s.resize(r.width, r.height);
      s.setStory(storyRef.current);
      s.start();
      setReady(true);
      const ro = new ResizeObserver(([e]) => s.resize(e.contentRect.width, e.contentRect.height));
      ro.observe(box.current);
      const io = new IntersectionObserver(([e]) => s.setVisible(e.isIntersecting), { threshold: 0 });
      io.observe(box.current);
      const themeOff = onThemeChange(() => s.setTheme(isDarkTheme()));
      dispose = () => {
        ro.disconnect();
        io.disconnect();
        themeOff();
        s.dispose();
      };
    };
    const cancelIdle = whenIdle(() => void boot());
    return () => {
      cancelled = true;
      cancelIdle();
      dispose?.();
      scene.current = null;
    };
    // The scene is rebuilt only when the tasks themselves change (a task moves layer, or turns late);
    // theme, story and size are passed to it as they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noGl, compact, reduce, signature]);

  useEffect(() => {
    scene.current?.setStory(story);
  }, [story]);
  useEffect(() => {
    scene.current?.setFraming(framing);
  }, [framing.x, framing.y]); // eslint-disable-line react-hooks/exhaustive-deps

  const local = (e: ReactPointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return; // touch scrolls the page
    drag.current = { x: e.clientX, moved: false, id: e.pointerId };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = scene.current;
    if (!s || e.pointerType === 'touch') return;
    const d = drag.current;
    if (d && (e.buttons & 1) === 1) {
      const dx = e.clientX - d.x;
      if (Math.abs(dx) > 3) d.moved = true;
      if (d.moved) {
        (e.currentTarget as HTMLElement).setPointerCapture?.(d.id);
        s.turnBy(dx * 0.006);
        d.x = e.clientX;
        setHover(null);
        return;
      }
    }
    const p = local(e);
    const task = s.pick(p.x, p.y) as StageTask | null;
    setHover(task ? { task, x: p.x, y: p.y } : null);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved && hover && onTask) onTask(hover.task);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const weak = data.weak;
  return (
    <div
      ref={box}
      className={cn('relative size-full select-none [container-type:size]', hover ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing', className)}
      aria-hidden="true"
      data-snowpack-stage=""
      data-ready={ready ? '' : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => {
        setHover(null);
        scene.current?.pick(-9999, -9999);
      }}
    >
      {/* The still: the block drawn flat, until the scene is ready (and without WebGL). */}
      {still && <SnowpackStill model={still} size={size!} className={cn('absolute inset-0 transition-opacity duration-700', ready ? 'opacity-0' : 'opacity-100')} />}
      <canvas ref={canvas} className={cn('absolute inset-0 size-full transition-opacity duration-700', ready ? 'opacity-100' : 'opacity-0')} data-snowpack-canvas="" />

      {/* Labels that follow the layers. */}
      <div className={cn('pointer-events-none absolute inset-0 transition-opacity duration-500', ready || still ? 'opacity-100' : 'opacity-0')}>
        {layerLabels && (['todo', 'progress', 'review', 'done'] as LayerKey[]).map((k) => (
          <div
            key={k}
            ref={(el) => {
              if (el) labels.current.set(k, el);
            }}
            className="absolute top-0 left-0 will-change-transform"
            data-snowpack-label={k}
          >
            <span className="absolute top-0 left-0 h-px w-7 -translate-y-1/2 bg-ink/35" />
            <span className="absolute top-0 left-7 flex -translate-y-1/2 items-center gap-1.5 rounded-full border border-line/80 bg-surface/85 py-1 pr-2.5 pl-2 text-[12px] font-medium whitespace-nowrap text-ink shadow-card backdrop-blur-sm dark:bg-surface-2/85">
              <span className="size-2 rounded-[3px]" style={{ backgroundColor: SWATCH[k] }} />
              {LAYER_WORD[k]}
              <span className="tabular text-muted">{data.counts[k]}</span>
            </span>
          </div>
        ))}
        {weak && (
          <div
            ref={(el) => {
              if (el) labels.current.set('weak', el);
            }}
            className="absolute top-0 left-0 will-change-transform"
            style={{ ['--lead' as string]: compact ? 'min(24cqh, 112px)' : 'min(27cqh, 250px)' }}
            data-snowpack-label="weak"
          >
            {/* A leader straight up from the red slice to a label above the block. */}
            <span className="absolute top-0 left-0 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-strata-weak shadow-card" />
            <span className="absolute bottom-0 left-0 w-px -translate-x-1/2 bg-strata-weak/80" style={{ height: 'var(--lead)' }} />
            <span
              className="absolute left-0 translate-x-[calc(-50%_+_var(--shift,0px))] rounded-lg bg-[#c33a25] px-3 py-2 text-center text-[12.5px] leading-tight font-semibold whitespace-nowrap text-white shadow-raised"
              data-weak-box=""
              style={{ bottom: 'var(--lead)' }}
            >
              {weak.key}, {days(weak.late)} late
              <span className="mt-0.5 block text-[12px] font-medium text-white/85">The weak layer: holding up {tasksWord(weak.holdsUp.length)}</span>
            </span>
          </div>
        )}
      </div>

      {hover && (
        <div className="pointer-events-none absolute z-10 max-w-[260px] rounded-lg border border-line bg-surface px-3 py-2 shadow-pop dark:bg-surface-2" style={{ left: hover.x + 14, top: hover.y + 14 }} data-snowpack-tooltip="">
          <p className="flex flex-wrap items-center gap-x-2 text-[12px] font-medium text-muted">
            <span className="tabular">{hover.task.key}</span>
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-[3px]" style={{ backgroundColor: SWATCH[hover.task.layer] }} />
              {LAYER_WORD[hover.task.layer]}
            </span>
            {hover.task.late > 0 && <span className="text-danger">{days(hover.task.late)} late</span>}
          </p>
          <p className="mt-0.5 text-[13px] leading-snug font-medium text-ink">{hover.task.title}</p>
          {hover.task.owner !== undefined && <p className="mt-0.5 text-[12px] text-muted">{hover.task.owner ?? 'Nobody owns it yet'}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * The block as a flat drawing (SVG): the same tasks, layers and camera as the 3D scene, in flat
 * shapes, with the late slices in red. Shown while three.js loads, and instead of it without WebGL.
 */
export function SnowpackStill({ model, size, className }: { model: StillModel; size: { w: number; h: number }; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={className} width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} data-snowpack-still="">
      <defs>
        <filter id={`still-blur-${id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={Math.max(6, size.w / 90)} />
        </filter>
      </defs>
      <polygon points={model.shadow} className="fill-[#1d2d3c] opacity-[0.12] dark:fill-black dark:opacity-40" filter={`url(#still-blur-${id})`} />
      {model.polygons.map((p, i) => (
        <polygon key={i} points={p.points} fill={p.fill} stroke={p.fill} strokeWidth={0.7} strokeLinejoin="round" />
      ))}
      {model.seams.map((l, i) => (
        <polyline key={i} points={l.points} fill="none" stroke={l.stroke} strokeWidth={l.width} strokeLinecap="round" />
      ))}
      {/* The top twice: first a little larger, to close the hairlines between the patches, then
          exactly, with the seams in among them so a nearer hill hides the stretch behind it. */}
      <g strokeWidth={1.4} strokeLinejoin="round">
        {model.top.map((p, i) => (
          <polygon key={i} points={p.points} fill={p.fill} stroke={p.fill} />
        ))}
      </g>
      <g strokeLinecap="round">
        {model.topItems.map((p, i) => (p.fill ? <polygon key={i} points={p.points} fill={p.fill} /> : <polyline key={i} points={p.points} fill="none" stroke={p.stroke} strokeWidth={p.width} />))}
      </g>
    </svg>
  );
}
