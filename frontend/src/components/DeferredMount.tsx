import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Renders `children` only once the browser is idle after the first paint and the placeholder is
 * near the screen. Heavy extras (three.js exhibits) then never compete with the page's text for
 * the first seconds, which keeps first paint fast on phones.
 */
export function DeferredMount({ children, fallback, className }: { children: ReactNode; fallback?: ReactNode; className?: string }) {
  const [ready, setReady] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let idle = false;
    let near = typeof IntersectionObserver === 'undefined';
    const check = () => idle && near && setReady(true);
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const onIdle = () => {
      idle = true;
      check();
    };
    const id = w.requestIdleCallback ? w.requestIdleCallback(onIdle, { timeout: 1500 }) : window.setTimeout(onIdle, 600);
    let io: IntersectionObserver | undefined;
    if (!near && box.current) {
      io = new IntersectionObserver(
        ([e]) => {
          if (e.isIntersecting) {
            near = true;
            io?.disconnect();
            check();
          }
        },
        { rootMargin: '200px' },
      );
      io.observe(box.current);
    }
    return () => {
      if (w.cancelIdleCallback) w.cancelIdleCallback(id);
      else window.clearTimeout(id);
      io?.disconnect();
    };
  }, []);
  if (ready) return <>{children}</>;
  return (
    <div ref={box} className={className}>
      {fallback}
    </div>
  );
}
