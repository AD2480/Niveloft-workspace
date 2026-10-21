import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

/**
 * A preview that opens when you rest the pointer on something, or focus it with the keyboard, and
 * closes when you move away or press Escape: the way a linked page previews itself in a notes app.
 * It only shows information (nothing in it is a control), so it's announced as a description of
 * the thing it previews. On touch screens it doesn't open; a tap follows the link.
 */
export function HoverCard({
  children,
  content,
  delay = 380,
  className,
  width = 300,
}: {
  /** The thing being previewed (a link). */
  children: (props: {
    'aria-describedby'?: string;
    onPointerEnter: (e: React.PointerEvent) => void;
    onPointerLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
  }) => ReactElement;
  /** What the preview shows (null when there's nothing to show yet). */
  content: ReactNode | null;
  delay?: number;
  className?: string;
  width?: number;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const timer = useRef(0);
  const card = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const el = anchor.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const h = card.current?.offsetHeight ?? 140;
    const above = r.bottom + 8 + h > window.innerHeight - 8 && r.top - 8 - h > 8;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    setAt({ left, top: above ? r.top - 8 - h : r.bottom + 8, above });
  }, [width]);

  const show = (e?: React.PointerEvent) => {
    if (e && e.pointerType === 'touch') return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), 90);
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place, content]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onScroll = () => setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const trigger = children({
    'aria-describedby': open && content ? id : undefined,
    onPointerEnter: (e) => {
      anchor.current = e.currentTarget as HTMLElement;
      show(e);
    },
    onPointerLeave: hide,
    onFocus: () => {
      anchor.current = document.activeElement as HTMLElement;
      show();
    },
    onBlur: hide,
  });

  return (
    <>
      {trigger}
      {open &&
        content &&
        createPortal(
          <div
            ref={card}
            id={id}
            role="tooltip"
            onPointerEnter={() => window.clearTimeout(timer.current)}
            onPointerLeave={hide}
            className={cn('fixed z-[60] rounded-xl border border-line bg-surface p-3.5 text-left shadow-pop animate-fade-in dark:bg-surface-2', !at && 'invisible', className)}
            style={{ left: at?.left ?? 0, top: at?.top ?? 0, width }}
            data-hover-card=""
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
