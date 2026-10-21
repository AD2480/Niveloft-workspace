import { Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { ProjectSummary } from '@/api/types';
import { HEALTH_COLOR, RoleBadge } from '@/components/domain';
import { Avatar } from '@/components/ui/Avatar';
import { lateOf, StrataBar, strataOf } from '@/components/ui/StrataBar';
import { cn } from '@/lib/cn';
import { HEALTH_LABEL, PROJECT_STATUS_LABEL } from '@/lib/constants';
import { daysUntil, formatDate } from '@/lib/dates';
import { useMediaQuery } from '@/lib/hooks';
import { isDarkTheme, lowPowerGuess, onThemeChange, webglAvailable, whenIdle } from '@/three/capabilities';
import { blockFrame, flatBlock, SLOT_BASE, SLOT_FILL, type FlatFace } from '@/three/portfolioBlocks';
import type { PortfolioBlock, PortfolioSnowpack } from '@/three/PortfolioSnowpack';
import type { LayerKey } from '@/three/snowpack';

const FILL: Record<FlatFace['fill'], string> = {
  done: 'var(--strata-done)',
  review: 'var(--strata-review)',
  progress: 'var(--strata-progress)',
  todo: 'var(--strata-todo)',
  weak: 'var(--strata-weak)',
  snow: 'var(--surface)',
  plinth: 'var(--surface-3)',
};

/**
 * Today's projects, each a card with its block of snowpack: approved work at the base, then in
 * review, in progress and not started on top; red is late work. Under the block, the same in words
 * and as a strata bar. The blocks are drawn by one canvas over the whole grid (three.js, loaded
 * after the page); until then, and without WebGL, each card shows the block drawn flat.
 */
export function ProjectSnowpacks({ projects, details = false }: { projects: ProjectSummary[]; /** The Projects page: a description, the team and your role on each card, three to a row. */ details?: boolean }) {
  const grid = useRef<HTMLUListElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<PortfolioSnowpack | null>(null);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [gl] = useState(() => typeof window !== 'undefined' && webglAvailable());
  const reduce = useMediaQuery('(prefers-reduced-motion: reduce)');
  const blocks = useMemo<PortfolioBlock[]>(() => projects.map((p) => ({ id: p.id, counts: strataOf(p.taskCounts), late: lateOf(p.taskCounts) })), [projects]);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const biggest = Math.max(1, ...projects.map((p) => p.taskCounts.total));

  useEffect(() => {
    if (!gl) return;
    let cancelled = false;
    let dispose: (() => void) | null = null;
    const boot = async () => {
      const { PortfolioSnowpack } = await import('@/three/PortfolioSnowpack');
      if (cancelled || !canvas.current || !grid.current) return;
      const host = grid.current;
      const s = new PortfolioSnowpack(canvas.current, { dark: isDarkTheme(), reducedMotion: reduce, lowPower: lowPowerGuess() });
      scene.current = s;
      const measure = () => {
        const r = host.getBoundingClientRect();
        const slots = [...host.querySelectorAll<HTMLElement>('[data-block-slot]')].map((el) => {
          const b = el.getBoundingClientRect();
          return { id: Number(el.dataset.blockSlot), x: b.left - r.left, y: b.top - r.top, w: b.width, h: b.height };
        });
        s.layout(slots, r.width, r.height);
      };
      measure();
      s.setBlocks(blocksRef.current);
      setReady(true);
      const ro = new ResizeObserver(measure);
      ro.observe(host);
      const themeOff = onThemeChange(() => s.setTheme(isDarkTheme()));
      dispose = () => {
        ro.disconnect();
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
      setReady(false);
    };
  }, [gl, reduce]);

  // New numbers (live updates): rebuild the blocks in place.
  useEffect(() => {
    scene.current?.setBlocks(blocks);
  }, [blocks]);
  useEffect(() => {
    scene.current?.setHover(hover);
  }, [hover]);

  return (
    // On phones the cards scroll sideways (the next one peeks in); from tablets up they're a grid.
    <div
      className="-mx-4 snap-x snap-mandatory scroll-pl-4 overflow-x-auto overscroll-x-contain px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:snap-none sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden"
      data-project-snowpacks-scroller=""
    >
      <ul
        ref={grid}
        className={cn('relative flex w-max gap-3 sm:grid sm:w-auto sm:grid-cols-2 sm:gap-4', details ? 'xl:grid-cols-3' : 'xl:grid-cols-4')}
        data-project-snowpacks=""
        data-ready={ready ? '' : undefined}
      >
        {projects.map((p) => {
          const days = p.deadline ? daysUntil(p.deadline) : null;
          const closed = p.status === 'COMPLETED' || p.status === 'ARCHIVED';
          const counts = strataOf(p.taskCounts);
          const late = lateOf(p.taskCounts);
          return (
            <li key={p.id} className="w-[78vw] max-w-[300px] min-w-0 shrink-0 snap-start sm:w-auto sm:max-w-none">
              <Link
                to={`/projects/${p.id}`}
                onMouseEnter={() => setHover(p.id)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(p.id)}
                onBlur={() => setHover(null)}
                className="group flex h-full flex-col rounded-xl border border-line bg-surface shadow-card transition-[border-color,box-shadow] duration-200 hover:border-line-strong hover:shadow-raised"
                data-project-tile={p.id}
                data-kb-item=""
              >
                <div className="bg-plate relative h-[176px] rounded-t-[inherit] border-b border-line/70" data-block-slot={p.id}>
                  <FlatBlock
                    counts={counts}
                    late={late}
                    biggest={biggest}
                    className={cn('absolute inset-0 size-full transition-opacity duration-500', ready ? 'opacity-0' : 'opacity-100')}
                  />
                  <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-surface/80 py-0.5 pr-2 pl-1.5 text-[12px] font-medium text-ink-2 backdrop-blur-sm dark:bg-surface-2/80">
                    <span
                      className="size-[7px] rounded-full"
                      style={{ backgroundColor: p.status === 'ACTIVE' || p.status === 'COMPLETED' ? HEALTH_COLOR[p.health] : 'var(--strata-todo)' }}
                      aria-hidden="true"
                    />
                    {p.status === 'ACTIVE' ? HEALTH_LABEL[p.health] : PROJECT_STATUS_LABEL[p.status]}
                  </span>
                  <span className="absolute top-3.5 right-3.5 text-[12px] font-medium text-muted tabular">{p.key}</span>
                </div>
                <div className="flex flex-1 flex-col p-4 pt-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="line-clamp-2 text-[14.5px] leading-snug font-semibold text-ink group-hover:text-brand-ink">{p.name}</h3>
                    <span className="reading shrink-0 pt-0.5 text-[19px] text-ink" aria-label={`${p.progress}% approved`}>
                      {p.progress}%
                    </span>
                  </div>
                  {details && <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted">{p.description || 'No description yet.'}</p>}
                  <StrataBar counts={counts} late={late} size="sm" className="mt-3" />
                  <p className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[12.5px] text-muted">
                    <span>
                      <span className="tabular">
                        {p.taskCounts.done} of {p.taskCounts.total}
                      </span>{' '}
                      approved
                      {p.taskCounts.overdue > 0 && !closed && <span className="font-medium text-danger">, {p.taskCounts.overdue} late</span>}
                    </span>
                    {p.deadline && (
                      <span className={cn(days !== null && days < 0 && p.status === 'ACTIVE' && 'text-danger')} title={formatDate(p.deadline)}>
                        {closed
                          ? `Ended ${formatDate(p.deadline, 'd MMM')}`
                          : days === null
                            ? ''
                            : days < 0
                              ? `Deadline passed ${formatDate(p.deadline, 'd MMM')}`
                              : days === 0
                                ? 'Due today'
                                : `Due ${formatDate(p.deadline, 'd MMM')}`}
                      </span>
                    )}
                  </p>
                  {details && (
                    <div className="mt-auto flex items-center gap-3 border-t border-line pt-3 text-[12.5px] text-muted [&:not(:first-child)]:mt-4">
                      <span className="inline-flex items-center gap-1.5" title={`Owner: ${p.owner.name}`}>
                        <Avatar user={p.owner} size="xs" />
                        <span className="truncate">{p.owner.name.split(' ')[0]}</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3.5" aria-hidden="true" />
                        <span className="tabular">{p.memberCount}</span>
                        <span className="sr-only">people</span>
                      </span>
                      <span className="ml-auto">
                        <RoleBadge role={p.myRole} />
                      </span>
                    </div>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
        {gl && <canvas ref={canvas} className="pointer-events-none absolute inset-0 size-full" aria-hidden="true" data-project-snowpacks-canvas="" />}
      </ul>
    </div>
  );
}

/** A project's block drawn flat, the way the 3D view draws it (while it loads, and without WebGL). */
function FlatBlock({ counts, late, biggest, className }: { counts: Record<LayerKey, number>; late: Partial<Record<LayerKey, number>>; biggest: number; className?: string }) {
  const faces = useMemo(() => flatBlock(counts, late, biggest).faces, [counts, late, biggest]);
  // The same scale and base line as the 3D view (see slotUnit): the plinth's front corner near the slot's foot.
  const { needH, below, span } = blockFrame();
  const h = needH / SLOT_FILL;
  const fill = (f: FlatFace) => {
    const base = FILL[f.fill];
    return f.shade === 1 ? `color-mix(in srgb, ${base} 80%, #0b1620)` : f.shade === 2 && f.fill !== 'snow' ? `color-mix(in srgb, ${base} 78%, #ffffff)` : base;
  };
  return (
    <svg
      className={className}
      viewBox={`${(-h / 2).toFixed(3)} ${(below + (1 - SLOT_BASE) * h - h).toFixed(3)} ${h.toFixed(3)} ${h.toFixed(3)}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <ellipse cx={0} cy={below * 0.35} rx={span * 0.62} ry={span * 0.2} fill="var(--ink)" opacity="0.06" />
      {faces.map((f, i) => (
        <polygon key={i} points={f.points.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(' ')} fill={fill(f)} stroke={fill(f)} strokeWidth={0.004} />
      ))}
    </svg>
  );
}
