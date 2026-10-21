import { ArrowRightCircle, ArrowUp, MessageCircle, Route, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router';
import type { Task } from '@/api/types';
import { buttonClass } from '@/components/ui/buttonStyles';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { milestoneBlocker } from '@/features/delivery/deliveryPath';
import { sampleProjectData } from '@/features/public/sampleProject';
import { cn } from '@/lib/cn';
import { STATUS_LABEL } from '@/lib/constants';
import { todayIso } from '@/lib/dates';
import { useMediaQuery } from '@/lib/hooks';
import { FlurryFigure, type FlurryMood } from '../FlurryFigure';
import { FLURRY_MODES, type FlurryMode } from '../flurryPrefs';
import { nextTaskFor } from '../nextTask';
import { aimAt, besideBox, centre, flightAt, followStep, gazeOffset, perchBeside, planFlight, type Box, type Pt } from '../roam';

const SIZE = 64;
const ROAM_AFTER = 6000;
/** The person the sandbox speaks to: the sample's mobile developer. */
const AS = 'Rohan Mehta';

interface Note {
  id: string;
  title: string;
  text: string;
  /** Point at this task card. */
  target?: string;
  open?: boolean;
}

interface Line {
  who: 'you' | 'flurry';
  text: string;
  title?: string;
}

/**
 * A safe place to try Flurry, on the public "Meet Flurry" page: the same figure, moves and menu as
 * in the workspace, in a small frame with three of the sample project's tasks. Drag it (it trails
 * the pointer and settles where you let go), point at it (it turns to you), click it (its compact
 * menu), leave it alone (it roams between a few spots), or hide it (it retreats into the sidebar).
 * Every answer is worked out from the sample project's records, and labelled that way: there's no
 * AI model on this page.
 */
export function FlurrySandbox() {
  const reduce = useMediaQuery('(prefers-reduced-motion: reduce)');
  const narrow = !useMediaQuery('(min-width: 768px)');
  const data = useMemo(() => sampleProjectData(), []);
  const today = todayIso();
  const stage = useRef<HTMLDivElement>(null);
  const fig = useRef<HTMLDivElement>(null);
  const pos = useRef<Pt>({ x: 0, y: 0 });
  const [mode, setMode] = useState<FlurryMode>('roam');
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [landed, setLanded] = useState(false);
  const [flying, setFlying] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [aim, setAim] = useState<{ flip: boolean; aim: number; lookY: number } | null>(null);
  const [chat, setChat] = useState(false);
  const [lines, setLines] = useState<Line[]>([{ who: 'flurry', text: `Hi, ${AS.split(' ')[0]}. I answer from the sample project’s records. Try a question below.` }]);
  const [draft, setDraft] = useState('');
  const [hovered, setHovered] = useState(false);
  const [placed, setPlaced] = useState(false);
  /** "Drag me · click me", until the first time you do either. */
  const [hint, setHint] = useState(true);
  const lastInput = useRef(performance.now());
  const drag = useRef<{ id: number; start: Pt; grab: Pt; target: Pt; moved: boolean; raf: number; last: number } | null>(null);
  const flight = useRef(0);
  const suppressClick = useRef(false);

  const mine = data.tasks.filter((t) => t.assignee?.name === AS);
  const byKey = (k: string) => data.tasks.find((t) => t.key === k)!;
  const beta = data.milestones.find((m) => m.name === 'Beta build')!;
  const launch = data.milestones.find((m) => m.name === 'Launch')!;
  const cards = ['ONB-8', 'ONB-9', 'ONB-10'].map(byKey);

  // ------------------------------------------------------------------ geometry inside the frame

  const bounds = (): Box => {
    const el = stage.current;
    const w = el?.clientWidth ?? 800;
    const h = el?.clientHeight ?? 440;
    return { left: narrow ? 8 : 168, top: 12, right: w - 12, bottom: h - 12 };
  };
  const rectIn = (el: Element | null): Box | null => {
    const s = stage.current?.getBoundingClientRect();
    const r = el?.getBoundingClientRect();
    if (!s || !r) return null;
    return { left: r.left - s.left, top: r.top - s.top, right: r.right - s.left, bottom: r.bottom - s.top };
  };
  const apply = (p: Pt, tilt = 0) => {
    pos.current = p;
    const el = fig.current;
    if (!el) return;
    el.style.transform = `translate3d(${Math.round(p.x)}px, ${Math.round(p.y)}px, 0)`;
    el.style.setProperty('--tilt', `${tilt.toFixed(2)}deg`);
  };
  const spots = (): Pt[] => {
    const b = bounds();
    return [
      { x: b.right - SIZE, y: b.bottom - SIZE },
      { x: b.right - SIZE, y: b.top + 8 },
      { x: b.left + 8, y: b.bottom - SIZE },
      { x: (b.left + b.right) / 2 - SIZE / 2, y: b.bottom - SIZE },
    ];
  };
  const home = () => spots()[0];
  const fly = (to: Pt, after?: () => void) => {
    cancelAnimationFrame(flight.current);
    const from = pos.current;
    if (reduce || Math.hypot(to.x - from.x, to.y - from.y) < 2) {
      apply(to);
      after?.();
      return;
    }
    const f = planFlight(from, to, Math.random);
    const start = performance.now();
    setFlying(true);
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / f.duration);
      const at = flightAt(f, t);
      apply(at.p, at.tilt);
      if (t < 1) flight.current = requestAnimationFrame(tick);
      else {
        apply(to, 0);
        setFlying(false);
        after?.();
      }
    };
    flight.current = requestAnimationFrame(tick);
  };

  // Start at home, once the frame has a size.
  useEffect(() => {
    apply(home());
    setPlaced(true);
    const onResize = () => apply(home());
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(flight.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrow]);

  // Roam: only after a quiet spell, never while you point at it, use its menu, drag it or read a note.
  useEffect(() => {
    if (mode !== 'roam' || reduce) return;
    const t = window.setInterval(() => {
      if (performance.now() - lastInput.current < ROAM_AFTER || hovered || menuOpen || dragging || note || chat || flying) return;
      const here = pos.current;
      const options = spots().filter((p) => Math.hypot(p.x - here.x, p.y - here.y) > 60);
      fly(options[Math.floor(Math.random() * options.length)]);
      lastInput.current = performance.now();
    }, 1500);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, reduce, hovered, menuOpen, dragging, note, chat, flying]);

  // Its eyes follow the pointer inside the frame.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      lastInput.current = performance.now();
      if (reduce || aim) return;
      const s = el.getBoundingClientRect();
      const g = gazeOffset(centre(pos.current, { width: SIZE, height: SIZE }), { x: e.clientX - s.left, y: e.clientY - s.top });
      fig.current?.style.setProperty('--gx', `${g.x.toFixed(2)}px`);
      fig.current?.style.setProperty('--gy', `${g.y.toFixed(2)}px`);
    };
    el.addEventListener('pointermove', onMove);
    return () => el.removeEventListener('pointermove', onMove);
  }, [reduce, aim]);

  // Pointing at what the note is about.
  useEffect(() => {
    if (!note?.target) {
      setAim(null);
      return;
    }
    const t = window.setTimeout(
      () => {
        const r = rectIn(stage.current?.querySelector(`[data-sandbox-task="${note.target}"]`) ?? null);
        if (!r) return;
        setAim(aimAt(centre(pos.current, { width: SIZE, height: SIZE }), { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }));
      },
      reduce ? 0 : 1300,
    );
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note, reduce]);

  // ------------------------------------------------------------------ dragging

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault(); // the menu opens on click, so a press can become a drag
    if (e.button !== 0 || mode === 'hide') return;
    const s = stage.current!.getBoundingClientRect();
    const at = pos.current;
    drag.current = { id: e.pointerId, start: at, grab: { x: e.clientX - s.left - at.x, y: e.clientY - s.top - at.y }, target: at, moved: false, raf: 0, last: performance.now() };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const s = stage.current!.getBoundingClientRect();
    const b = { left: 4, top: 4, right: s.width - 4, bottom: s.height - 4 };
    const p = { x: e.clientX - s.left - d.grab.x, y: e.clientY - s.top - d.grab.y };
    d.target = { x: Math.min(Math.max(b.left, p.x), b.right - SIZE), y: Math.min(Math.max(b.top, p.y), b.bottom - SIZE) };
    if (!d.moved && Math.hypot(d.target.x - d.start.x, d.target.y - d.start.y) < 5) return;
    if (d.moved) return;
    d.moved = true;
    setHint(false);
    cancelAnimationFrame(flight.current);
    setFlying(false);
    setDragging(true);
    setMenuOpen(false);
    setNote(null);
    setAim(null);
    const tick = () => {
      const cur = drag.current;
      if (!cur) return;
      const t = performance.now();
      const step = reduce ? { p: cur.target, sway: 0 } : followStep(pos.current, cur.target, (t - cur.last) / 1000);
      cur.last = t;
      apply(step.p);
      fig.current?.style.setProperty('--flurry-sway', `${step.sway.toFixed(1)}deg`);
      cur.raf = requestAnimationFrame(tick);
    };
    d.raf = requestAnimationFrame(tick);
  };
  const endDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    cancelAnimationFrame(d.raf);
    lastInput.current = performance.now();
    if (!d.moved) return;
    suppressClick.current = true;
    setDragging(false);
    fig.current?.style.setProperty('--flurry-sway', '0deg');
    apply(d.target);
    if (!reduce) {
      setLanded(true);
      window.setTimeout(() => setLanded(false), 600);
    }
  };

  // ------------------------------------------------------------------ the menu's actions

  /** Go to the task's card (just below it, where there's room, so nothing is covered) and show the note. */
  const goBeside = (key: string, note: Note) => {
    const r = rectIn(stage.current?.querySelector(`[data-sandbox-task="${key}"]`) ?? null);
    const s = stage.current;
    setNote(note);
    if (!r || !s || mode === 'stay') return;
    const below = r.bottom + 12 + SIZE <= s.clientHeight - 8;
    const p = below ? { x: Math.min(Math.max(8, r.left + 16), s.clientWidth - SIZE - 8), y: r.bottom + 12 } : besideBox(r, { width: SIZE, height: SIZE }, { width: s.clientWidth, height: s.clientHeight }, 10, 8);
    fly(p);
  };
  const myNextTask = () => {
    const next = nextTaskFor(mine, data.dependencies);
    if (next.task) goBeside(next.task.key, { id: 'next', title: next.title, text: next.text, target: next.task.key, open: true });
    else setNote({ id: 'next', title: next.title, text: next.text });
  };
  const deliveryOutlook = () => {
    const b = milestoneBlocker(beta, data.tasks, data.dependencies, { today });
    if (!b) return setNote({ id: 'delivery', title: beta.name, text: `Everything in ${beta.name} is approved.` });
    const held = b.holdsUp.find((t) => cards.some((c) => c.key === t.key));
    goBeside(held?.key ?? b.task.key, { id: 'delivery', title: `${beta.name}: ${b.title}`, text: b.sentence, target: b.task.key, open: true });
  };
  const askFlurry = () => {
    setNote(null);
    setChat(true);
    window.setTimeout(() => {
      const panel = rectIn(stage.current?.querySelector('[data-sandbox-chat]') ?? null);
      const s = stage.current;
      if (panel && s && mode !== 'stay') fly(perchBeside(panel, { width: SIZE, height: SIZE }, { width: s.clientWidth, height: s.clientHeight }, 10, 8));
      stage.current?.querySelector<HTMLInputElement>('[data-sandbox-chat] input')?.focus();
    }, 30);
  };
  const choose = (m: FlurryMode) => {
    setMode(m);
    setNote(null);
    if (m === 'hide') {
      const item = rectIn(stage.current?.querySelector('[data-sandbox-sidebar-flurry]') ?? null);
      if (item) fly({ x: item.left - 4, y: (item.top + item.bottom) / 2 - SIZE / 2 });
    }
  };
  const callBack = () => {
    setMode('roam');
    window.setTimeout(() => fly(home()), 20);
  };

  // ------------------------------------------------------------------ the conversation (built-in answers)

  const answer = (q: string): Line => {
    const s = q.toLowerCase();
    if (/(next|what should i|start|work on)/.test(s)) {
      const n = nextTaskFor(mine, data.dependencies);
      return { who: 'flurry', title: n.title, text: n.text };
    }
    if (/(review|waiting|approve)/.test(s) && !/(can you|please)\s+approve/.test(s)) {
      const r = data.tasks.filter((t) => t.status === 'IN_REVIEW');
      return {
        who: 'flurry',
        title: r.length ? `${r.length} waiting for a review` : 'Nothing waiting for review',
        text: r.length ? `${r.map((t) => `${t.key} “${t.title}”`).join('; ')}. A manager reviews it against its criteria; I can’t approve work.` : 'No submitted work is waiting.',
      };
    }
    if (/(block|holding|late|launch|delay|in the way|stuck)/.test(s)) {
      const b = milestoneBlocker(launch, data.tasks, data.dependencies, { today });
      return { who: 'flurry', title: b ? `Launch: ${b.title}` : 'Nothing holds the launch up', text: b ? `${b.sentence.replace(/ Open it\?$/, '')}${b.kind === 'late' ? ' Why it’s late isn’t recorded.' : ''}` : 'Everything the launch waits on is approved.' };
    }
    if (/(assign|deadline|move the date|change the date)/.test(s)) return { who: 'flurry', text: 'I don’t assign people or change deadlines on my own. I can show you what a change would do, and you decide.' };
    return { who: 'flurry', text: 'On this page I only answer from the sample project’s records: ask what to do next, what’s holding up the launch, or what’s waiting for review.' };
  };
  const send = (q: string) => {
    const text = q.trim();
    if (!text) return;
    setLines((l) => [...l, { who: 'you' as const, text }, answer(text)].slice(-8));
    setDraft('');
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };

  // ------------------------------------------------------------------ drawing

  let shownMood: FlurryMood = 'idle';
  if (dragging) shownMood = 'dragged';
  else if (note && aim) shownMood = 'point';
  else if (menuOpen || hovered) shownMood = 'curious';
  else if (chat) shownMood = 'idle';
  const hidden = mode === 'hide' && !flying;
  const view = { width: stage.current?.clientWidth ?? 800, height: stage.current?.clientHeight ?? 440 };
  const noteLeft = pos.current.x + SIZE / 2 > view.width / 2;

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-canvas shadow-card" data-flurry-sandbox="">
      <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-2.5">
        <p className="text-[12.5px] font-medium text-muted">Sandbox: the sample project, as {AS}</p>
        <p className="text-[12px] text-muted">No AI model here: built-in answers from the sample’s records.</p>
      </div>
      <div ref={stage} className={cn('relative select-none', narrow ? 'h-[560px]' : 'h-[460px]')} data-sandbox-stage="">
        {/* A small workspace: the sidebar with Flurry's item, and three of the sample's tasks. */}
        {!narrow && (
          <div className="absolute inset-y-0 left-0 w-[156px] border-r border-line bg-surface px-2 py-3">
            {['Today', 'My work', 'Projects'].map((x) => (
              <p key={x} className="rounded-md px-2.5 py-1.5 text-[12.5px] text-ink-2">
                {x}
              </p>
            ))}
            <div className="absolute inset-x-2 bottom-3 border-t border-line pt-2">
              <div className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[12.5px] text-ink-2" data-sandbox-sidebar-flurry="">
                <FlurryFigure className="size-6 shrink-0" mood={mode === 'hide' ? 'sleep' : 'idle'} still={reduce} glow={false} mini />
                <span className="flex-1">Ask Flurry</span>
              </div>
              {mode === 'hide' && (
                <button type="button" onClick={callBack} className="mt-1 w-full rounded-md border border-line px-2 py-1 text-[12px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink" data-sandbox-call-back="">
                  Call back
                </button>
              )}
            </div>
          </div>
        )}
        <div className={cn('absolute grid gap-3', narrow ? 'inset-x-3 top-3' : 'top-6 right-6 left-[188px] grid-cols-3')}>
          {cards.map((t) => (
            <SandboxCard key={t.key} task={t} highlighted={note?.target === t.key} />
          ))}
        </div>

        {/* The click-to-talk panel. */}
        {chat && (
          <section
            className={cn('absolute z-10 flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-float', narrow ? 'inset-x-3 bottom-3 h-[300px]' : 'right-5 bottom-5 h-[300px] w-[360px]')}
            aria-label="Flurry, the sample conversation"
            data-sandbox-chat=""
          >
            <header className="flex items-center gap-2 border-b border-line px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold text-ink">Flurry</span>
                <span className="block text-[11.5px] text-muted">No AI model: built-in answers about the sample project</span>
              </span>
              <button type="button" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close the conversation" onClick={() => setChat(false)}>
                <X className="size-4" aria-hidden="true" />
              </button>
            </header>
            <div className="flex-1 space-y-2 overflow-y-auto px-3 py-2.5" role="log" aria-live="polite">
              {lines.map((l, i) => (
                <div key={i} className={cn('max-w-[88%] rounded-lg px-2.5 py-1.5 text-[12.5px] leading-snug', l.who === 'you' ? 'ml-auto bg-brand text-white dark:text-canvas' : 'bg-surface-2 text-ink')}>
                  {l.title && <p className="text-[11.5px] font-medium text-muted">{l.title}</p>}
                  <p>{l.text}</p>
                </div>
              ))}
              {lines.length === 1 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {['What should I do next?', 'What’s holding up the launch?', 'What’s waiting for review?'].map((q) => (
                    <button key={q} type="button" onClick={() => send(q)} className="rounded-full border border-line px-2.5 py-1 text-[12px] text-ink-2 hover:border-line-strong hover:text-ink" data-sandbox-suggestion="">
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-line px-2.5 py-2">
              <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask about the sample project" aria-label="Ask Flurry about the sample project" className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-accent" />
              <button type="submit" className={buttonClass('primary', 'icon-sm')} aria-label="Send" disabled={!draft.trim()}>
                <ArrowUp aria-hidden="true" />
              </button>
            </form>
          </section>
        )}

        {/* Flurry itself. */}
        <div
          ref={fig}
          className={cn('absolute top-0 left-0 z-20', !placed && 'invisible', hidden && 'pointer-events-none opacity-0')}
          style={{ width: SIZE, height: SIZE, ['--flurry-aim' as string]: `${aim?.aim ?? 0}deg`, ['--flurry-look-y' as string]: `${aim?.lookY ?? 0}px` }}
          onPointerEnter={(e) => e.pointerType !== 'touch' && setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          data-sandbox-flurry={shownMood}
          data-sandbox-mode={mode}
        >
          <Menu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
            <MenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  'relative block size-full touch-none rounded-full ring-line-strong transition-[box-shadow,background-color] duration-300 hover:bg-surface/50 hover:ring-1 data-[state=open]:bg-surface/60 data-[state=open]:ring-1',
                  dragging ? 'cursor-grabbing' : 'cursor-pointer',
                )}
                aria-label="Flurry: open its menu. Drag to move it."
                tabIndex={hidden ? -1 : 0}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onClick={(e) => {
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    e.preventDefault();
                    return;
                  }
                  lastInput.current = performance.now();
                  setHint(false);
                  setMenuOpen((o) => !o);
                }}
                data-sandbox-flurry-button=""
              >
                <span className="block size-full" style={{ transform: `rotate(var(--tilt, 0deg))${aim?.flip ? ' scaleX(-1)' : ''}` }}>
                  <FlurryFigure mood={shownMood} still={reduce} landed={landed} className={cn('size-full drop-shadow-[0_6px_10px_rgb(23_33_43/0.16)]', flying && 'flurry-flying')} />
                </span>
              </button>
            </MenuTrigger>
            <MenuContent align="end" side="top" className="w-[min(18rem,calc(100vw-24px))]">
              <MenuItem icon={<MessageCircle />} onSelect={askFlurry}>
                Ask Flurry
              </MenuItem>
              <MenuItem icon={<ArrowRightCircle />} onSelect={myNextTask}>
                My next task
              </MenuItem>
              <MenuItem icon={<Route />} onSelect={deliveryOutlook}>
                Delivery outlook
              </MenuItem>
              <MenuSeparator />
              <MenuLabel>Flurry should</MenuLabel>
              <MenuRadioGroup value={mode} onValueChange={(v) => choose(v as FlurryMode)} label="Where Flurry stays">
                {FLURRY_MODES.map((m) => (
                  <MenuRadioItem key={m.value} value={m.value} hint={m.hint}>
                    {m.label}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuContent>
          </Menu>
          {hint && !note && !menuOpen && !hidden && (
            <span className="pointer-events-none absolute right-full bottom-full mr-1 mb-1 rounded-md bg-ink px-2 py-1 text-[11.5px] font-medium whitespace-nowrap text-canvas shadow-pop" data-sandbox-hint="">
              Drag me, or click me
            </span>
          )}
          {note && (
            <section
              className={cn('absolute top-1 w-[min(280px,calc(100vw-48px))] rounded-xl border bg-surface px-3.5 py-3 text-left shadow-float', noteLeft ? 'right-full mr-3' : 'left-full ml-3', note.target ? 'border-warning/40' : 'border-line')}
              aria-label="Flurry’s note"
              data-sandbox-note={note.id}
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1" role="status">
                  <p className="text-[11.5px] font-medium text-muted">{note.title}</p>
                  <p className="mt-0.5 text-[13px] leading-snug text-ink">{note.text}</p>
                </div>
                <button type="button" onClick={() => setNote(null)} className="-mt-1 -mr-1.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close Flurry’s note">
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </div>
              {note.open && (
                <div className="mt-2.5 flex gap-2">
                  <Link to="/#product" className={buttonClass('primary', 'sm')}>
                    See it in the sample
                  </Link>
                  <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => setNote(null)}>
                    Not now
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
        <span className="sr-only" aria-live="polite">
          {mode === 'hide' ? 'Flurry is hidden in the sidebar. Use Call back to bring it out.' : ''}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line bg-surface px-4 py-2.5 text-[12px] text-muted">
        <span>Drag it: it trails your pointer, then settles where you let go.</span>
        <span>Click it: Ask Flurry, My next task, Delivery outlook.</span>
        <span>Leave it {ROAM_AFTER / 1000} seconds: it roams (in the app, after 30).</span>
      </div>
    </div>
  );
}

function SandboxCard({ task: t, highlighted }: { task: Task; highlighted: boolean }) {
  const late = t.status !== 'DONE' && t.dueDate !== null && t.dueDate < todayIso();
  return (
    <div className={cn('rounded-lg border bg-surface px-3 py-2.5 shadow-card transition-shadow', highlighted ? 'border-warning ring-2 ring-warning/25' : 'border-line')} data-sandbox-task={t.key}>
      <p className="text-[11.5px] font-medium text-muted tabular">{t.key}</p>
      <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug font-medium text-ink">{t.title}</p>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted">
        <span>{STATUS_LABEL[t.status]}</span>
        <span>{t.assignee?.name ?? 'Nobody yet'}</span>
        {late && <span className="font-medium text-danger">Late</span>}
      </p>
    </div>
  );
}
