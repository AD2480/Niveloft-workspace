import { ChevronDown } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useAppSelector } from '@/app/store';
import { PublicPage } from '@/components/layout/PublicFrame';
import { scrollToSection } from '@/components/ScrollAids';
import { buttonClass } from '@/components/ui/buttonStyles';
import { FlurryFigure, FlurryPortrait } from '@/features/flurry/FlurryFigure';
import { RolePicker } from '@/features/roles/RolePicker';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/hooks';
import { dateRange } from '@/lib/forecastText';
import { whenIdle } from '@/three/capabilities';
import { LAYER_WORD, type LayerKey } from '@/three/snowpack';
import { FAQ_ENTRIES } from '../faq';
import { NO_CHANGES, sampleForecastShared } from '../sampleForecast';
import { ONBOARDING_SAMPLE } from '../sampleProject';
import { sampleSnowpack } from './sampleSnowpack';
import { SnowpackStage } from './SnowpackStage';

// The working sections load after the first screen has painted (see AfterFirstPaint).
const SampleWorkspace = lazy(() => import('../SampleWorkspace').then((m) => ({ default: m.SampleWorkspace })));
const ForecastPlayground = lazy(() => import('../ForecastPlayground').then((m) => ({ default: m.ForecastPlayground })));
const RoleViews = lazy(() => import('../RoleViews').then((m) => ({ default: m.RoleViews })));

const SWATCH: Record<LayerKey | 'weak', string> = {
  todo: 'var(--strata-todo)',
  progress: 'var(--strata-progress)',
  review: 'var(--strata-review)',
  done: 'var(--strata-done)',
  weak: 'var(--strata-weak)',
};

const HOME_QUESTIONS = ['what-is-projectflow', 'who-is-flurry', 'drag-to-done', 'need-ai', 'is-it-free'];
const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const say = (n: number) => words[n] ?? String(n);
const list = (keys: string[]) => (keys.length <= 1 ? keys.join('') : `${keys.slice(0, -1).join(', ')} and ${keys[keys.length - 1]}`);

/**
 * The front page.
 *
 * 1. The first screen: the promise, one action (sign up), and the sample project as a block of snowpack.
 * 2. Read it in layers: as the page scrolls, the block's layers lift apart and each is read, top
 *    down: fresh snow (not started), settling (in progress), waiting for a decision (in review),
 *    firm at the base (approved), and the weak layer (the late task holding the rest up).
 * 3. The product itself, working: the sample workspace, the forecast, the four views, Flurry.
 * 4. Questions, and the ways in.
 *
 * Every figure comes from the sample project's records. The 3D block is decoration over ordinary,
 * accessible page content; it loads after the first paint, has a still drawing before it (and
 * without WebGL), and stands still under reduced motion.
 */
export function HomeLanding() {
  const data = useMemo(() => sampleSnowpack(ONBOARDING_SAMPLE), []);
  const forecast = useMemo(() => sampleForecastShared(NO_CHANGES), []);
  const signedIn = useAppSelector((s) => s.auth.token !== null);
  // The words beside the block need about 1280 px; narrower screens stack them (the block stays at the top).
  const desktop = useMediaQuery('(min-width: 1280px)');
  const location = useLocation();
  // Where a layer is read: mid-screen beside the block on large screens; on phones, in the space below the block.
  // (Phones: between the block's panel and the floating buttons at the bottom of the screen.)
  const story = useStoryScroll(desktop ? (vh) => vh / 2 : (vh) => (64 + Math.max(280, vh * 0.42) + vh - 120) / 2);
  const weak = data.weak;
  const finish = forecast.forecast.project.finish;
  const likely = finish ? dateRange(forecast.model.originMs, finish) : null;
  const pct = forecast.forecast.project.pDeadline === null ? null : Math.round(forecast.forecast.project.pDeadline * 100);

  // Deep links (/#product, /#how, /#roles, /#flurry, /#questions, and the older /#demo) scroll to their section.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    const target = id === 'demo' ? 'product' : id;
    requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ block: 'start' }));
  }, [location.hash]);

  const steps: { key: LayerKey | 'weak'; title: string; meta: string; body: ReactNode }[] = [
    {
      key: 'todo',
      title: 'Fresh snow on top',
      meta: `${data.counts.todo} not started`,
      body: (
        <>
          Planned, and nobody has started yet. {data.unowned.length > 0 && <>{capital(say(data.unowned.length))} of them have no owner ({list(data.unowned)}), and Niveloft says so instead of guessing who should take them.</>}
        </>
      ),
    },
    {
      key: 'progress',
      title: 'Settling',
      meta: `${data.counts.progress} in progress`,
      body: <>Work under way. The forecast simulates each person’s real pace against their own estimates, not the dates people hope for, and says what it assumes.</>,
    },
    {
      key: 'review',
      title: 'Waiting for a decision',
      meta: `${data.counts.review} in review`,
      body: <>Done means reviewed: someone else approves the work against criteria written before it began. Dragging a card to Done doesn’t do it, and neither does the API.</>,
    },
    {
      key: 'done',
      title: 'Firm at the base',
      meta: `${data.counts.done} approved`,
      body: <>Settled work. Every change of state is recorded, so any past day can be replayed exactly as it was.</>,
    },
    {
      key: 'weak',
      title: 'The weak layer',
      meta: weak ? `${weak.key}, ${say(weak.late)} days late` : 'Nothing is holding work up',
      body: weak ? (
        <>
          “{data.tasks.find((t) => t.key === weak.key)?.title}” is holding up {list(weak.holdsUp)}. Of everything in the project, it’s the one thing to look at today.
        </>
      ) : (
        <>No late work is holding anything up.</>
      ),
    },
  ];

  return (
    <PublicPage overlay>
      <div className="relative" data-home-story="">
        {/* Large screens: the stage (the sky and the block) is pinned behind the first screen and the layers, the words scroll past on the left. */}
        {desktop && (
          // The stage sticks within this layer, which is exactly as tall as the story, so it never spills into the next section.
          <div className="absolute inset-0">
            <div className="sticky top-0 h-[100svh] overflow-hidden">
              <Sky />
              <SnowpackStage data={data} story={story.s} framing={{ x: -0.2, y: -0.02 }} onTask={() => scrollToSection('product')} className="absolute inset-0" />
              <div className="pointer-events-none absolute inset-y-0 left-0 w-[50%] bg-[linear-gradient(90deg,#e7eef4_0%,rgb(231_238_244/0.7)_55%,transparent)] dark:bg-[linear-gradient(90deg,#081019_0%,rgb(8_16_25/0.65)_55%,transparent)]" />
            </div>
          </div>
        )}
        {/* Phones and tablets: one flat sky, so the block's panel (the same colour) sits in it without an edge. */}
        {!desktop && <div className="pointer-events-none absolute inset-0 bg-[#e4ecf2] dark:bg-[#0a141d]" aria-hidden="true" />}

        {/* The words pass over the block; only the words themselves take the pointer, so the block
            behind them can still be pointed at, clicked and turned. */}
        <div className="pointer-events-none relative">
          {/* 1. The first screen. */}
          <section
            ref={story.anchor(0)}
            className={cn('mx-auto flex max-w-[1320px] flex-col px-4 sm:px-8', desktop ? 'min-h-[100svh] justify-center pt-24 pb-10' : 'pt-28 pb-6')}
            aria-labelledby="home-title"
            data-home-hero=""
          >
            <div className="pointer-events-auto max-w-[640px]">
              <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-[12.5px] font-medium text-ink-2 backdrop-blur-sm dark:bg-surface/50">
                <span className="size-1.5 rounded-full bg-strata-done" aria-hidden="true" />
                For small software and student teams
              </p>
              <h1 id="home-title" className="display-poster mt-6 text-[42px] text-ink sm:text-[60px] lg:text-[76px]">
                See what will finish, when, and what’s in the way.
              </h1>
              <p className="mt-6 max-w-[34rem] text-[17px] leading-relaxed text-ink-2 sm:text-[18.5px]">
                Niveloft reads a project the way a forecaster reads snow, in layers: what has settled, what is still settling, and the one weak layer that will hold everything up.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                {signedIn ? (
                  <Link to="/dashboard" className={buttonClass('primary', 'lg')} data-home-primary="">
                    Open Niveloft
                  </Link>
                ) : (
                  <Link to="/register" className={buttonClass('primary', 'lg')} data-home-primary="">
                    Create your free workspace
                  </Link>
                )}
                <button type="button" onClick={() => scrollToSection('product')} className={buttonClass('secondary', 'lg')} data-home-see="">
                  See it working
                </button>
              </div>
              <p className="mt-4 text-[13px] text-muted">Creating an account is free. Invite your team when you’re ready.</p>
            </div>
            <dl className="pointer-events-auto mt-10 grid max-w-[640px] grid-cols-3 gap-4 border-t border-line/80 pt-6 sm:gap-6 lg:mt-16" data-home-readings="">
              <div>
                <dt className="text-[12.5px] text-muted">Sample project</dt>
                <dd className="mt-1 text-[14px] font-medium text-balance text-ink">
                  {ONBOARDING_SAMPLE.tasks.length} tasks, {data.people} people
                </dd>
              </div>
              <div>
                <dt className="text-[12.5px] text-muted">Likely finish</dt>
                <dd className="mt-1 text-[14px] font-medium text-ink">{likely ?? 'Done'}</dd>
              </div>
              <div>
                <dt className="text-[12.5px] text-muted">On time</dt>
                <dd className="mt-1 text-[14px] font-medium text-ink">{pct === null ? 'No deadline' : `${pct}% chance`}</dd>
              </div>
            </dl>
          </section>

          {/* Phones and tablets: the stage follows the first screen and stays at the top; each layer's
              words come up from below, are read under the block, then slide away beneath it. */}
          {!desktop && (
            <div className="pointer-events-auto sticky top-16 z-20 h-[42svh] min-h-[280px] bg-[#e4ecf2] dark:bg-[#0a141d]">
              <SnowpackStage data={data} story={story.s} framing={{ x: 0.07, y: -0.06 }} onTask={() => scrollToSection('product')} className="absolute inset-0" />
              <div className="pointer-events-none absolute inset-x-0 top-full h-8 bg-[linear-gradient(180deg,#e4ecf2,transparent)] dark:bg-[linear-gradient(180deg,#0a141d,transparent)]" aria-hidden="true" />
            </div>
          )}

          {/* 2. Read it in layers. */}
          <section aria-labelledby="layers-title" className="relative z-10" data-home-layers="">
            <h2 id="layers-title" className="sr-only">
              The sample project, read in layers
            </h2>
            {steps.map((st, i) => (
              <div
                key={st.key}
                ref={desktop ? story.anchor(i + 1) : undefined}
                className={cn('mx-auto flex max-w-[1320px] px-4 sm:px-8', desktop ? 'min-h-[88svh] items-center' : 'min-h-[62svh] items-end pb-6')}
                data-home-step={st.key}
              >
                <article
                  ref={desktop ? undefined : story.anchor(i + 1)}
                  className={cn(
                    'pointer-events-auto w-full max-w-[440px] [&_h3]:transition-colors [&_h3]:duration-500 [&_p]:transition-colors [&_p]:duration-500',
                    // The layer being read is in full ink; the others step back to muted text (never so
                    // faint that they fall below the contrast text needs).
                    desktop ? (story.step === i + 1 ? '' : '[&_h3]:text-muted [&_p]:text-muted') : 'rounded-xl border border-line bg-surface/95 p-5 shadow-raised backdrop-blur-md dark:bg-surface/92',
                  )}
                  data-reading={desktop && story.step === i + 1 ? '' : undefined}
                >
                  <p className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
                    <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: SWATCH[st.key] }} aria-hidden="true" />
                    {st.key === 'weak' ? 'Late, and holding work up' : LAYER_WORD[st.key]}
                  </p>
                  <h3 className="display-wide mt-3 text-[28px] text-ink sm:mt-4 sm:text-[40px]">{st.title}</h3>
                  <p className={cn('mt-3 text-[15px] font-semibold', st.key === 'weak' ? 'text-danger' : 'text-ink')}>{st.meta}</p>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-2 sm:text-[15.5px]">{st.body}</p>
                  {st.key === 'weak' && (
                    <button type="button" onClick={() => scrollToSection('product')} className={buttonClass('primary', 'md', 'mt-6')}>
                      See it working
                    </button>
                  )}
                </article>
              </div>
            ))}
            <div ref={story.anchor(6)} className={desktop ? 'h-[40svh]' : 'h-[20svh]'} aria-hidden="true" />
          </section>
        </div>
      </div>

      {/* 3. The product, working. */}
      <Section
        id="product"
        title="One real project, start to finish."
        lede="The sample project in the real interface. Open a task, submit it for review, approve it, give the unowned work an owner. Blocked work can’t start, and nothing counts as done until someone else has reviewed it. Nothing is saved, and Reset puts it back."
      >
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-raised">
          <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2.5">
            <span className="size-2.5 rounded-full bg-line-strong" aria-hidden="true" />
            <span className="size-2.5 rounded-full bg-line-strong" aria-hidden="true" />
            <span className="size-2.5 rounded-full bg-line-strong" aria-hidden="true" />
            <span className="ml-3 truncate text-[12.5px] text-muted">Sample workspace: {ONBOARDING_SAMPLE.name}</span>
          </div>
          <div className="p-3 sm:p-5">
            <AfterFirstPaint minHeight={560}>
              <SampleWorkspace />
            </AfterFirstPaint>
          </div>
        </div>
        <ul className="mt-10 grid gap-8 md:grid-cols-3" aria-label="What you can rely on">
          {[
            ['Done means reviewed.', 'A task reaches Done only when someone else approves it against its criteria. Dragging it there, or a direct API call, is refused.'],
            ['Roles, checked on every request.', 'Owner, manager, member or viewer, per project. The server checks each one; the graph and Flurry only see what you can see.'],
            ['Estimates, labelled.', 'Anything about the future is a range from the records, marked as an estimate, with what it assumes.'],
          ].map(([t, x]) => (
            <li key={t} className="border-t border-line pt-4">
              <p className="text-[15px] font-semibold text-ink">{t}</p>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{x}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="how"
        tone="tinted"
        title="A finish date with its error bars showing."
        lede="Niveloft doesn’t ask an AI for a date. It simulates the open work from the records: each person’s real pace, what waits on what, and how long reviews take. Change an assumption and watch the window move."
      >
        <AfterFirstPaint minHeight={420}>
          <ForecastPlayground />
        </AfterFirstPaint>
      </Section>

      <Section id="roles" title="Four people, four questions." lede="A member wants to know what to work on next. A reviewer wants to know whose work is waiting on them. An owner wants to know what threatens the date. A client wants to know when to expect it. Each role opens on the view that answers its own question.">
        <AfterFirstPaint minHeight={600}>
          <RoleViews />
        </AfterFirstPaint>
      </Section>

      <Section id="flurry" tone="tinted" title="An assistant that says what it doesn’t know." lede="">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div>
            <p className="max-w-[60ch] text-[17px] leading-relaxed text-ink-2">
              Flurry is Niveloft’s project assistant: a small snow creature that lives at the edge of your pages. It plans a project from a brief, summarises progress and reviews blockers, and it explains the forecast rather than inventing one.
            </p>
            <ul className="mt-8 grid gap-x-8 gap-y-5 sm:grid-cols-2">
              {[
                ['Only what you can see', 'It answers from the records you already have access to, and links the tasks it used.'],
                ['Facts apart from guesses', 'It keeps what’s recorded, what’s estimated and what’s missing separate. It never makes up a date.'],
                ['Asks before it changes anything', 'It never approves work, assigns people or moves a deadline on its own; every change is previewed and can be undone.'],
                ['Always says it’s AI', 'Each answer says which model wrote it, or that none did.'],
              ].map(([t, x]) => (
                <li key={t}>
                  <p className="text-[14.5px] font-semibold text-ink">{t}</p>
                  <p className="mt-1 text-[14px] leading-relaxed text-muted">{x}</p>
                </li>
              ))}
            </ul>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link to="/flurry" className={buttonClass('primary', 'lg')} data-home-meet-flurry="">
                Meet Flurry
              </Link>
              <span className="inline-flex items-center gap-2 text-[13px] text-muted">
                <FlurryFigure className="size-6" glow={false} still mini /> In the app: click Flurry, or press Alt+A
              </span>
            </div>
          </div>
          <figure className="relative mx-auto w-full max-w-[360px]">
            <div className="absolute inset-[12%] rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--frost)_55%,transparent),transparent_70%)] blur-2xl" aria-hidden="true" />
            <FlurryPortrait size={480} className="relative h-auto w-full" />
          </figure>
        </div>
      </Section>

      <Section id="questions" title="What people ask before they trust it." lede="">
        <div className="max-w-[860px] divide-y divide-line border-y border-line">
          {HOME_QUESTIONS.map((q) => FAQ_ENTRIES.find((e) => e.id === q))
            .filter((e): e is NonNullable<typeof e> => e !== undefined)
            .map((e) => (
              <details key={e.id} className="disclosure group" data-home-question={e.id}>
                <summary className="flex items-start gap-4 py-5 transition-colors hover:text-accent">
                  <h3 className="min-w-0 flex-1 text-[16.5px] leading-snug font-medium text-ink">{e.question}</h3>
                  <ChevronDown className="disclosure-icon mt-0.5 size-5 shrink-0 text-muted" aria-hidden="true" />
                </summary>
                <div className="disclosure-body max-w-[70ch] space-y-2 pb-6 text-[15px] leading-relaxed text-ink-2">
                  {e.answer.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
              </details>
            ))}
        </div>
        <p className="mt-6 text-[14px] text-muted">
          More answers on the <Link to="/faq" className="font-medium text-accent hover:underline">questions page</Link>, and the whole idea in the{' '}
          <Link to="/introduction" className="font-medium text-accent hover:underline">
            introduction
          </Link>
          .
        </p>
      </Section>

      {/* 4. The ways in. */}
      <section id="begin" className="relative overflow-hidden border-t border-line bg-graphite text-[#e7eef4]" aria-labelledby="begin-title" data-home-begin="">
        <div className="absolute inset-0 bg-[radial-gradient(70%_80%_at_85%_10%,rgb(147_197_234/0.18),transparent_70%)]" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-[1320px] gap-12 px-4 py-24 sm:px-8 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:py-28">
          <div>
            <h2 id="begin-title" className="display-wide text-[40px] text-[#f2f5f8] sm:text-[56px]">
              Start with one project. Keep what works.
            </h2>
            <p className="mt-5 max-w-[46ch] text-[17px] leading-relaxed text-[#c3ceda]">
              Create a workspace for your team, plan your first project, and invite people when you’re ready. It’s free.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {signedIn ? (
                <Link to="/dashboard" className={buttonClass('primary', 'lg', 'bg-[#93c5ea] text-[#0a131b] hover:bg-[#b3d7f1]')}>
                  Open Niveloft
                </Link>
              ) : (
                <Link to="/register" className={buttonClass('primary', 'lg', 'bg-[#93c5ea] text-[#0a131b] hover:bg-[#b3d7f1]')}>
                  Create your free workspace
                </Link>
              )}
              <Link to="/login" className={buttonClass('outline', 'lg', 'border-[#344659] text-[#e7eef4] hover:bg-white/5 hover:border-[#5a7189]')}>
                Log in
              </Link>
            </div>
          </div>
          {!signedIn && (
            <div className="rounded-2xl border border-[#233140] bg-[#101b24] p-5 text-ink shadow-float sm:p-6 dark" data-home-roles="">
              <p className="mb-4 text-[14px] font-semibold text-[#e7eef4]">Or start from your role</p>
              <RolePicker />
            </div>
          )}
        </div>
      </section>
    </PublicPage>
  );
}

/**
 * The heavier sections (the sample workspace, the forecast, the role views) load and render once the
 * first screen has painted and the browser is idle, or as soon as they come near the screen,
 * whichever is first; at once when the address points into the page, so a link lands where it
 * should. Until then an empty box of about their height keeps the page's length.
 */
function AfterFirstPaint({ children, minHeight }: { children: ReactNode; minHeight: number }) {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.location.hash.length > 1);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (on) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setOn(true), { rootMargin: '800px 0px' });
    if (box.current) io.observe(box.current);
    const cancel = whenIdle(() => setOn(true), 2500);
    return () => {
      io.disconnect();
      cancel();
    };
  }, [on]);
  const hold = <div style={{ minHeight }} aria-hidden="true" />;
  return <div ref={box}>{on ? <Suspense fallback={hold}>{children}</Suspense> : hold}</div>;
}

/** The sky behind the first screen: first light (light theme), a clear night (dark). */
function Sky() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-0" aria-hidden="true">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#e7eef4_0%,#dfe8ef_45%,#d3dee7_100%)] dark:bg-[linear-gradient(180deg,#081019_0%,#0b1620_50%,#0f1c28_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(60%_55%_at_70%_58%,rgb(255_255_255/0.7),transparent_70%)] dark:bg-[radial-gradient(60%_55%_at_70%_58%,rgb(80_120_160/0.18),transparent_70%)]" />
    </div>
  );
}

function capital(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Section({ id, title, lede, tone, children }: { id: string; title: string; lede: string; tone?: 'tinted'; children: ReactNode }) {
  return (
    <section id={id} className={cn('scroll-mt-16 border-t border-line', tone === 'tinted' ? 'bg-surface-2/70 dark:bg-surface/40' : 'bg-canvas')} aria-labelledby={`${id}-title`} data-home-section={id}>
      <div className="mx-auto max-w-[1320px] px-4 py-20 sm:px-8 lg:py-28">
        <div className="max-w-[760px]">
          <h2 id={`${id}-title`} className="display-wide text-[34px] text-ink sm:text-[48px]">
            {title}
          </h2>
          {lede && <p className="mt-5 max-w-[64ch] text-[16.5px] leading-relaxed text-ink-2">{lede}</p>}
        </div>
        <div className="mt-12">{children}</div>
      </div>
    </section>
  );
}

/**
 * Where the scroll is in the story: 0 on the first screen, 1…5 on the five layers, 6 past them.
 * Measured from the centres of the sections themselves against a reading line (a height in the
 * window), so the block and the words always agree.
 */
function useStoryScroll(readingLine: (viewportHeight: number) => number) {
  const nodes = useRef<(HTMLElement | null)[]>([]);
  const [s, setS] = useState(0);
  const line = useRef(readingLine);
  line.current = readingLine;
  const anchor = useCallback(
    (i: number) => (el: HTMLElement | null) => {
      nodes.current[i] = el;
    },
    [],
  );
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const mid = window.scrollY + line.current(window.innerHeight);
      const centres = nodes.current.map((el) => (el ? el.getBoundingClientRect().top + window.scrollY + el.offsetHeight / 2 : NaN));
      let next = 0;
      if (centres.length && !centres.some(Number.isNaN)) {
        if (mid <= centres[0]) next = 0;
        else if (mid >= centres[centres.length - 1]) next = centres.length - 1;
        else {
          for (let i = 0; i < centres.length - 1; i++) {
            if (mid >= centres[i] && mid <= centres[i + 1]) {
              next = i + (mid - centres[i]) / Math.max(1, centres[i + 1] - centres[i]);
              break;
            }
          }
        }
      }
      setS((prev) => (Math.abs(prev - next) < 0.002 ? prev : next));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);
  const step = s < 0.55 || s >= 5.6 ? 0 : Math.min(5, Math.max(1, Math.round(s)));
  return { s, step, anchor };
}
