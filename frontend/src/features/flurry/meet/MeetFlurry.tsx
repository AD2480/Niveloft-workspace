import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router';
import { buttonClass } from '@/components/ui/buttonStyles';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/hooks';
import { FlurryFigure, type FlurryMood } from '../FlurryFigure';
import { flightAt, planFlight, type Pt } from '../roam';
import { FlurrySandbox } from './FlurrySandbox';

/** Plays only while it's on screen (and never under reduced motion). */
function useOnScreen<T extends HTMLElement>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setOn(true);
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, on];
}

const SIZES = [120, 72, 56, 40, 32, 24, 16];

/**
 * The "Meet Flurry" page: the character first (how it looks at every size, its pose, how it floats,
 * how it reacts when carried, its menu and its conversation), then each behaviour, a sandbox to try
 * it, and the rules it keeps. Everything is the same component the workspace uses.
 */
export function MeetFlurry() {
  const reduce = useMediaQuery('(prefers-reduced-motion: reduce)');
  return (
    <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-10" data-meet-flurry="">
      {/* 1. Who it is. */}
      <header className="grid items-center gap-10 border-b border-line pt-14 pb-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:pt-20">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[12.5px] font-medium text-ink-2">
            <span className="size-1.5 rounded-full bg-[var(--frost)]" aria-hidden="true" />
            Niveloft’s project assistant
          </p>
          <h1 className="display-poster mt-6 text-[52px] text-ink sm:text-[76px]">Meet Flurry.</h1>
          <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-ink-2">
            A small snow creature that lives at the edge of your workspace. Calm, curious and quietly useful: it floats nearby, glances at the task you pick, and when you ask
            <em className="not-italic text-ink"> “What should I do next?”</em> it goes and shows you, from your project’s own records.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <a href="#try" className={buttonClass('primary', 'lg')} data-meet-try="">
              Try it below
            </a>
            <Link to="/#product" className={buttonClass('secondary', 'lg')}>
              See the whole product
            </Link>
          </div>
        </div>
        <Anatomy still={reduce} />
      </header>

      {/* 2. At every size. */}
      <section className="border-b border-line py-16" aria-labelledby="sizes-title">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="sizes-title" className="display-wide text-[32px] text-ink sm:text-[44px]">
              Recognisable at any size.
            </h2>
          </div>
          <p className="max-w-md text-[14.5px] leading-relaxed text-muted">A round body, a three-flame tuft and a tail: the outline alone says Flurry. Below 32 px it drops the shading and keeps a heavier outline.</p>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {(['light', 'dark'] as const).map((tone) => (
            <div key={tone} className={cn('flex flex-wrap items-end gap-6 rounded-2xl border px-7 py-7', tone === 'dark' ? 'border-[#233140] bg-[#0a131b]' : 'border-line bg-surface shadow-card')} data-meet-sizes={tone}>
              {SIZES.map((px) => (
                <figure key={px} className="flex flex-col items-center gap-2">
                  <FlurryFigure still glow={px >= 56} mini={px <= 32} style={{ width: px, height: px }} />
                  <figcaption className={cn('text-[11.5px] tabular-nums', tone === 'dark' ? 'text-[#97a6b5]' : 'text-muted')}>{px} px</figcaption>
                </figure>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* 3. Each behaviour. */}
      <section className="border-b border-line py-16" aria-labelledby="behaviour-title">
        <h2 id="behaviour-title" className="display-wide text-[32px] text-ink sm:text-[44px]">
          Alive, and never in the way.
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Behaviour title="Idle" text="Floats gently near a screen edge, looks around, and now and then settles on the sidebar.">
            <Stage>
              <div className="absolute right-4 bottom-4 size-16">
                <FlurryFigure still={reduce} className="size-full" />
              </div>
              <EdgeHint />
            </Stage>
          </Behaviour>
          <Behaviour title="Roaming" text="Moves between a few safe resting spots, only while you’re away from the keyboard and mouse.">
            <Stage>
              <RoamLoop still={reduce} />
            </Stage>
          </Behaviour>
          <Behaviour title="Dragged" text="Follows your pointer with a slight trail, arms up, then settles exactly where you let go.">
            <Stage>
              <Carried still={reduce} />
            </Stage>
          </Behaviour>
          <Behaviour title="Clicked" text="Turns towards you and opens a compact menu: Ask Flurry, My next task and Delivery outlook.">
            <Stage>
              <div className="absolute bottom-4 left-4 size-14">
                <FlurryFigure mood="curious" still={reduce} className="size-full" />
              </div>
              <div className="absolute right-3 bottom-4 w-[150px] rounded-[10px] border border-line bg-surface p-1 text-[11.5px] text-ink shadow-pop" aria-hidden="true">
                {['Ask Flurry', 'My next task', 'Delivery outlook'].map((x, i) => (
                  <p key={x} className={cn('rounded-md px-2 py-1', i === 0 && 'bg-surface-2')}>
                    {x}
                  </p>
                ))}
              </div>
            </Stage>
          </Behaviour>
          <Behaviour title="Working" text="A restrained thinking animation, only while a real request is being processed.">
            <Stage>
              <div className="absolute inset-0 m-auto size-20">
                <FlurryFigure mood="thinking" still={reduce} className="size-full" />
              </div>
            </Stage>
          </Behaviour>
          <Behaviour title="Task completed" text="A brief happy reaction when something you did worked, then back to idle.">
            <Stage>
              <Cycle still={reduce} moods={['success', 'idle']} ms={[1600, 2400]} />
            </Stage>
          </Behaviour>
          <Behaviour title="Attention needed" text="Raises a small indicator. Click it, and its menu says exactly what: the review or the blocker.">
            <Stage>
              <div className="absolute bottom-5 left-5 size-16">
                <FlurryFigure mood="attention" still={reduce} className="size-full" />
                <span className="absolute top-0 right-0 flex size-4 items-center justify-center rounded-full border-2 border-surface bg-warning text-[10px] leading-none font-bold text-white dark:text-canvas" aria-hidden="true">
                  !
                </span>
              </div>
              <p className="absolute top-4 right-3 w-[150px] rounded-lg border border-warning/40 bg-surface px-2.5 py-2 text-[11.5px] leading-snug text-ink shadow-float">
                <span className="block text-[10.5px] font-medium text-muted">Needs you</span>
                ONB-7 is waiting for your review.
              </p>
            </Stage>
          </Behaviour>
          <Behaviour title="Dismissed" text="Retreats into a small icon in the sidebar until you call it back.">
            <Stage>
              <div className="absolute inset-x-4 bottom-4 rounded-lg border border-line bg-surface p-2" aria-hidden="true">
                <div className="flex items-center gap-2 text-[12px] text-ink-2">
                  <FlurryFigure mood="sleep" still={reduce} glow={false} mini className="size-6 shrink-0" />
                  <span className="flex-1">Ask Flurry</span>
                  <span className="rounded-md border border-line px-1.5 py-0.5 text-[11px] font-medium">Call back</span>
                </div>
              </div>
            </Stage>
          </Behaviour>
        </div>
      </section>

      {/* 4. Try it. */}
      <section id="try" className="scroll-mt-24 border-b border-line py-16" aria-labelledby="try-title">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="try-title" className="display-wide text-[32px] text-ink sm:text-[44px]">
              Drag it. Click it. Ask it something.
            </h2>
          </div>
          <p className="max-w-md text-[14.5px] leading-relaxed text-muted">
            The same Flurry as in the workspace, in a small frame with three tasks from the sample project. “Delivery outlook” shows how it points out what holds a milestone up.
          </p>
        </div>
        <div className="mt-8">
          <FlurrySandbox />
        </div>
      </section>

      {/* 5. The rules. */}
      <section className="grid gap-12 py-16 lg:grid-cols-2" aria-labelledby="rules-title">
        <div>
          <h2 id="rules-title" className="display-wide text-[32px] text-ink sm:text-[44px]">
            The rules it keeps.
          </h2>
          <ul className="mt-6 space-y-3 text-[14.5px] leading-relaxed text-ink-2" data-meet-rules="">
            {[
              ['Pauses', 'while you type, drag tasks or use a menu.'],
              ['Keeps clear', 'of buttons, text fields, text and chart labels; if a page loads under it, it moves somewhere emptier.'],
              ['Yours to set', 'Roam, Stay here or Hide, its size, and how much it moves (Full, Calm or Off).'],
              ['Speaks when asked', 'notes are one or two sentences and appear when you ask. It speaks up on its own only if you turn that on.'],
              ['On phones', 'one fixed spot on the bottom edge, which expands into its menu when tapped.'],
              ['Inside Niveloft', 'it roams within the page. Roaming your desktop and other apps would take a separate desktop companion.'],
            ].map(([a, b]) => (
              <li key={a} className="flex gap-3 border-t border-line pt-3">
                <span className="w-36 shrink-0 font-semibold text-ink">{a}</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-7 shadow-card">
          <p className="text-[15px] font-semibold text-ink">What it never does</p>
          <ul className="mt-4 space-y-2.5 text-[14.5px] leading-relaxed text-ink-2">
            {['Approve work: only a reviewer can, against the task’s criteria.', 'Assign people or change deadlines on its own.', 'Claim to have opened a link or a file. It can’t.', 'Show you anything you aren’t allowed to see in the project.', 'Change anything without showing you the exact change first, and an Undo after.'].map((x) => (
              <li key={x} className="flex gap-2.5">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                {x}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-[13px] leading-relaxed text-muted">
            Its answers come from the records, with facts, estimates and what isn’t recorded kept apart. With an AI model connected it can word things better; without one, it says so and uses built-in answers.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/register" className={buttonClass('primary', 'md')}>
              Create your free workspace
            </Link>
            <Link to="/introduction#assistant" className={buttonClass('ghost', 'md')}>
              Read how it works
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

/** The character, large, with what makes it Flurry pointed out. */
function Anatomy({ still }: { still: boolean }) {
  const parts: { label: string; x: number; y: number; to: [number, number]; side: 'left' | 'right' }[] = [
    { label: 'A three-flame tuft', x: 92, y: 6, to: [70, 12], side: 'right' },
    { label: 'Two expressive eyes', x: 98, y: 40, to: [73, 57], side: 'right' },
    { label: 'Tiny arms', x: 98, y: 70, to: [103, 66], side: 'right' },
    { label: 'Rounded body', x: -2, y: 86, to: [32, 88], side: 'left' },
    { label: 'Soft icy-blue glow', x: -2, y: 30, to: [20, 48], side: 'left' },
  ];
  return (
    <figure className="relative mx-auto aspect-square w-full max-w-[min(440px,100%)]" data-meet-anatomy="">
      <div className="absolute inset-[14%]">
        <FlurryFigure still={still} className="size-full" />
      </div>
      <svg viewBox="0 0 120 120" className="pointer-events-none absolute inset-0 hidden size-full overflow-visible sm:block" aria-hidden="true">
        {parts.map((p) => {
          // The figure sits in the middle 72% of the box: map its drawing units into the box.
          const tx = 14 * 1.2 + p.to[0] * 0.72;
          const ty = 14 * 1.2 + p.to[1] * 0.72;
          const lx = p.side === 'right' ? Math.min(118, p.x) : Math.max(2, p.x + 22);
          return <path key={p.label} d={`M${tx} ${ty} L${lx} ${p.y}`} stroke="var(--line-strong)" strokeWidth={0.4} fill="none" />;
        })}
      </svg>
      <p className="absolute inset-x-0 -bottom-2 text-center text-[12px] text-muted sm:hidden" aria-hidden="true">
        A rounded body, two eyes, tiny arms and an icy-blue glow
      </p>
      {parts.map((p) => (
        <figcaption
          key={p.label}
          className={cn('absolute hidden -translate-y-1/2 rounded-full border border-line bg-surface/90 px-2.5 py-1 text-[12px] font-medium whitespace-nowrap text-ink-2 shadow-card backdrop-blur-sm sm:block', p.side === 'left' && 'text-right')}
          style={{ top: `${(p.y / 120) * 100}%`, ...(p.side === 'right' ? { left: `${(Math.min(118, p.x) / 120) * 100}%` } : { right: `${100 - ((p.x + 22) / 120) * 100}%` }) }}
        >
          {p.label}
        </figcaption>
      ))}
    </figure>
  );
}

function Behaviour({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card" data-meet-behaviour={title}>
      {children}
      <div className="border-t border-line px-4 py-4">
        <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
        <p className="mt-1 text-[13.5px] leading-snug text-muted">{text}</p>
      </div>
    </article>
  );
}

function Stage({ children }: { children: ReactNode }) {
  return (
    <div className="relative h-44 overflow-hidden bg-[radial-gradient(120%_90%_at_50%_0%,var(--surface-2),var(--canvas))]" aria-hidden="true">
      {children}
    </div>
  );
}

/** A faint page edge, so "near the edge" reads. */
function EdgeHint() {
  return (
    <>
      <div className="absolute inset-y-4 left-4 w-[55%] space-y-2">
        <div className="h-2 w-3/4 rounded bg-line" />
        <div className="h-2 w-1/2 rounded bg-line" />
        <div className="h-8 w-full rounded-md border border-line bg-surface" />
        <div className="h-8 w-full rounded-md border border-line bg-surface" />
      </div>
    </>
  );
}

/** Flying from spot to spot in a loop, banking into the turns. */
function RoamLoop({ still }: { still: boolean }) {
  const [box, on] = useOnScreen<HTMLDivElement>();
  const el = useRef<HTMLDivElement>(null);
  const [flying, setFlying] = useState(false);
  useEffect(() => {
    const host = box.current;
    const f = el.current;
    if (!host || !f) return;
    const w = host.clientWidth;
    const spots: Pt[] = [
      { x: 12, y: 92 },
      { x: w - 70, y: 84 },
      { x: w / 2 - 28, y: 12 },
    ];
    const put = (p: Pt, tilt = 0) => {
      f.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
      f.style.setProperty('--tilt', `${tilt}deg`);
    };
    put(spots[0]);
    if (still || !on) return;
    let i = 0;
    let raf = 0;
    let t = 0;
    const next = () => {
      const from = spots[i % spots.length];
      const to = spots[(i + 1) % spots.length];
      i++;
      const plan = planFlight(from, to, () => 0.6);
      const start = performance.now();
      setFlying(true);
      const tick = () => {
        const k = Math.min(1, (performance.now() - start) / plan.duration);
        const at = flightAt(plan, k);
        put(at.p, at.tilt);
        if (k < 1) raf = requestAnimationFrame(tick);
        else {
          setFlying(false);
          t = window.setTimeout(next, 1400);
        }
      };
      raf = requestAnimationFrame(tick);
    };
    t = window.setTimeout(next, 900);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [still, on, box]);
  return (
    <div ref={box} className="absolute inset-0">
      {[0, 1, 2].map((k) => (
        <span key={k} className="absolute size-1.5 rounded-full bg-line-strong" style={k === 0 ? { left: 40, bottom: 12 } : k === 1 ? { right: 40, bottom: 20 } : { left: '50%', top: 66 }} />
      ))}
      <div ref={el} className="absolute top-0 left-0 size-14">
        <span className="block size-full" style={{ transform: 'rotate(var(--tilt, 0deg))' }}>
          <FlurryFigure still={still} className={cn('size-full', flying && 'flurry-flying')} />
        </span>
      </div>
    </div>
  );
}

/** Carried: arms up, swaying with the pointer's movement. */
function Carried({ still }: { still: boolean }) {
  const [box, on] = useOnScreen<HTMLDivElement>();
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const f = el.current;
    if (!f || still || !on) return;
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      const x = Math.sin(t * 1.4) * 34;
      const vx = Math.cos(t * 1.4) * 34 * 1.4;
      f.style.transform = `translate3d(${x}px, ${Math.sin(t * 2.8) * 4}px, 0)`;
      f.style.setProperty('--flurry-sway', `${Math.max(-16, Math.min(16, -vx * 0.3)).toFixed(1)}deg`);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [still, on]);
  return (
    <div ref={box} className="absolute inset-0 flex items-center justify-center">
      <div ref={el} className="relative size-20">
        <FlurryFigure mood="dragged" still={still} className="size-full" />
        {/* The pointer holding it. */}
        <svg viewBox="0 0 24 24" className="absolute -top-1 left-1/2 size-6 translate-x-1 text-ink" aria-hidden="true">
          <path d="M5 3l14 7-6 1.6L10.6 18z" fill="var(--surface)" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

/** A mood that comes and goes (the happy reaction, then idle). */
function Cycle({ still, moods, ms }: { still: boolean; moods: FlurryMood[]; ms: number[] }) {
  const [box, on] = useOnScreen<HTMLDivElement>();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (still || !on) return;
    const t = window.setTimeout(() => setI((n) => (n + 1) % moods.length), ms[i % ms.length]);
    return () => window.clearTimeout(t);
  }, [i, still, on, moods.length, ms]);
  return (
    <div ref={box} className="absolute inset-0 m-auto size-20">
      <FlurryFigure mood={still ? moods[0] : moods[i]} still={still} className="size-full" />
    </div>
  );
}
