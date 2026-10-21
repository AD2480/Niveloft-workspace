import { ArrowUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Scrolls to the top (smoothly unless the visitor asked for less motion) and moves focus there. */
export function scrollToTop(focusTarget = 'main'): void {
  window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  const el = document.getElementById(focusTarget);
  if (el) {
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  }
}

/** Scrolls a section into view (below the sticky header) and moves keyboard focus to it. */
export function scrollToSection(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
  if (window.location.hash !== `#${id}`) window.history.replaceState(window.history.state, '', `#${id}`);
}

/** Calls back (at most once per frame) when the page scrolls or its size changes. */
function useScrollFrame(onFrame: () => void) {
  const cb = useRef(onFrame);
  cb.current = onFrame;
  useEffect(() => {
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        cb.current();
      });
    };
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // Pages grow as their data loads; recompute then too.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    ro?.observe(document.body);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
    };
  }, []);
}

/**
 * A round "back to top" button that appears after scrolling down more than a screen. It sits
 * above the floating Contact button or Flurry, so they never overlap.
 */
export function BackToTop({ className }: { className?: string }) {
  const [show, setShow] = useState(false);
  useScrollFrame(() => setShow(window.scrollY > window.innerHeight * 1.2));
  return (
    <button
      type="button"
      onClick={() => scrollToTop()}
      data-print="hide"
      data-back-to-top=""
      aria-label="Back to top"
      title="Back to top"
      tabIndex={show ? 0 : -1}
      aria-hidden={!show}
      className={cn(
        'fixed right-4 bottom-24 z-30 flex size-11 items-center justify-center rounded-full border border-line-strong bg-surface text-ink shadow-pop',
        'transition-[opacity,transform,border-color,background-color] duration-200 hover:-translate-y-0.5 hover:border-ink hover:bg-surface-2 active:translate-y-0 sm:right-6 sm:bottom-28',
        show ? 'opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
        className,
      )}
    >
      <ArrowUp className="size-4" aria-hidden="true" />
    </button>
  );
}

/**
 * A 2px reading-progress bar along the bottom edge of the sticky header. It only appears on pages
 * long enough to need it, and it also gives the header a soft shadow once the page has scrolled.
 */
export function ScrollProgress() {
  const wrap = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  useScrollFrame(() => {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    const long = max > window.innerHeight * 0.6;
    const p = long ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    if (bar.current) bar.current.style.transform = `scaleX(${p})`;
    if (wrap.current) {
      wrap.current.style.opacity = long ? '1' : '0';
      wrap.current.dataset.progress = String(Math.round(p * 100));
      const header = wrap.current.closest('header');
      if (header) header.dataset.scrolled = window.scrollY > 4 ? 'true' : 'false';
    }
  });
  return (
    <div ref={wrap} aria-hidden="true" data-print="hide" data-scroll-progress="" className="pointer-events-none absolute inset-x-0 -bottom-px h-[2px] opacity-0 transition-opacity">
      <div ref={bar} className="h-full origin-left bg-accent" style={{ transform: 'scaleX(0)' }} />
    </div>
  );
}
