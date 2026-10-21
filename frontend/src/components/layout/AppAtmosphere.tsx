import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useMediaQuery } from '@/lib/hooks';
import { readJson, writeStorage } from '@/lib/storage';

/**
 * The light behind every signed-in page: a faint wash of cold light from the top of the window (always,
 * decoration only), and, if you turn it on in Settings → Appearance, a light snowfall behind
 * everything (cards and panels cover it). Both are faint enough not to change how readable anything
 * is; the snow stands still under reduced motion and stops in hidden tabs.
 */

const KEY = 'projectflow.atmosphere';
const listeners = new Set<() => void>();
let cached: boolean | null = null;

function readOn(): boolean {
  if (cached === null) cached = readJson<{ snow?: boolean }>(KEY)?.snow === true;
  return cached;
}

/** Whether the snowfall is shown (per browser; off unless turned on). */
export function useAtmosphere(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    readOn,
    () => false,
  );
  return [
    on,
    (next) => {
      cached = next;
      writeStorage(KEY, JSON.stringify({ snow: next }));
      for (const l of listeners) l();
    },
  ];
}

interface Flake {
  x: number;
  y: number;
  r: number;
  vy: number;
  sway: number;
  phase: number;
  a: number;
}

export function AppAtmosphere() {
  const [on] = useAtmosphere();
  const reduce = useMediaQuery('(prefers-reduced-motion: reduce)');
  const compact = !useMediaQuery('(min-width: 768px)');
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const g = el?.getContext('2d');
    if (!on || !el || !g) return;
    let w = 0;
    let h = 0;
    let flakes: Flake[] = [];
    let raf = 0;
    let last = 0;
    let odd = false;
    const count = compact ? 32 : 70;
    const seed = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      flakes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.7 + Math.random() * 1.8,
        vy: 9 + Math.random() * 22,
        sway: 6 + Math.random() * 16,
        phase: Math.random() * Math.PI * 2,
        a: 0.35 + Math.random() * 0.65,
      }));
    };
    const draw = (t: number) => {
      const dark = document.documentElement.classList.contains('dark');
      g.clearRect(0, 0, w, h);
      // Faint on purpose: behind text it must never cost contrast.
      g.fillStyle = dark ? 'rgb(226 236 245)' : 'rgb(27 75 115)';
      const alpha = dark ? 0.14 : 0.08;
      for (const f of flakes) {
        const x = f.x + Math.sin(t / 1000 + f.phase) * f.sway;
        g.globalAlpha = f.a * alpha;
        g.beginPath();
        g.arc(x, f.y, f.r, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    };
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      // Half the frame rate is plenty for snow.
      odd = !odd;
      if (odd) return;
      const dt = Math.min(0.1, (t - (last || t)) / 1000);
      last = t;
      for (const f of flakes) {
        f.y += f.vy * dt;
        if (f.y > h + 4) {
          f.y = -4;
          f.x = Math.random() * w;
        }
      }
      draw(t);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      last = 0;
      if (reduce || document.hidden) draw(0);
      else raf = requestAnimationFrame(tick);
    };
    const onResize = () => {
      seed();
      start();
    };
    const onVisibility = () => (document.hidden ? cancelAnimationFrame(raf) : start());
    seed();
    start();
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    // The theme changes the flakes' colour.
    const themeWatch = new MutationObserver(() => reduce && draw(0));
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      themeWatch.disconnect();
    };
  }, [on, reduce, compact]);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true" data-print="hide" data-app-atmosphere="">
      {/* Cold light from above, strongest behind the page title, fading out long before the content. */}
      <div className="absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(900px_420px_at_72%_-120px,color-mix(in_srgb,var(--frost)_26%,transparent),transparent_70%)] dark:bg-[radial-gradient(900px_420px_at_72%_-120px,color-mix(in_srgb,var(--frost)_16%,transparent),transparent_70%)]" />
      {on && <canvas ref={canvas} className="absolute inset-0 size-full" data-app-snow="" />}
    </div>
  );
}
