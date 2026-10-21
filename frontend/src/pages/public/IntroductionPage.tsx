import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAppSelector } from '@/app/store';
import { PublicPage } from '@/components/layout/PublicFrame';
import { buttonClass } from '@/components/ui/buttonStyles';
import { PALETTE_SHORTCUT } from '@/components/CommandPalette';
import { FIRST_STEPS, INTRO_CHAPTERS as CHAPTERS, MODEL_GRAMMAR, ROLES, TASK_STAGES } from '@/features/public/content';
import { PermissionTable } from '@/features/public/PublicParts';
import { cn } from '@/lib/cn';
import { DeferredMount } from '@/components/DeferredMount';
import { usePageMeta } from '@/lib/pageMeta';

const SampleModelPanel = lazy(() => import('@/features/public/SampleModelPanel'));

/**
 * The introduction: a short, chaptered guide to how Niveloft works, with the live sample
 * model in the middle. New accounts land here once (`?welcome=1`) with a way straight into Today.
 */
export function IntroductionPage() {
  usePageMeta({ title: 'Introduction', path: '/introduction' });
  const [params] = useSearchParams();
  const user = useAppSelector((s) => s.auth.user);
  const signedIn = useAppSelector((s) => s.auth.token !== null);
  const welcome = params.get('welcome') === '1' && signedIn;
  const active = useActiveChapter();

  return (
    <PublicPage>
      <div className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-10">
        {welcome && (
          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-accent/30 bg-surface px-5 py-4 shadow-card" role="status">
            <p className="text-[14px] text-ink">Welcome{user ? `, ${user.name.split(' ')[0]}` : ''}. Your account is ready. Read on for five minutes, or go straight in.</p>
            <Link to="/dashboard" className={buttonClass('primary', 'sm')}>
              Go to Today
            </Link>
          </div>
        )}

        <header className="border-b border-line pt-12 pb-10 lg:pt-16">
          <h1 className="max-w-3xl display-wide text-[42px] leading-[1.03] text-ink sm:text-[58px]">How Niveloft works</h1>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-ink-2">
            Nine short chapters: who can do what, how a task becomes done, how to read the 3D model and its forecast, and what the AI assistant can and can’t do. About five minutes
            to read.
          </p>
        </header>

        <div className="grid gap-12 py-12 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
          <nav aria-label="Chapters" className="hidden lg:block">
            <ol className="sticky top-24 space-y-1 border-l border-line">
              {CHAPTERS.map((c, i) => (
                <li key={c.id}>
                  <a
                    href={`#${c.id}`}
                    aria-current={active === c.id ? 'location' : undefined}
                    className={cn(
                      '-ml-px flex gap-3 border-l py-1.5 pl-4 text-[13px] transition-colors',
                      active === c.id ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink',
                    )}
                  >
                    <span className="w-4 text-[12.5px] text-subtle tabular">{i + 1}</span>
                    {c.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="min-w-0 space-y-20">
            <Chapter id="idea" title="The idea">
              <Prose>
                <p>
                  Most tools show a project as a list of cards that are either open or closed. Niveloft keeps the record of how each task moved, and turns it into something you can
                  look at from any angle: a model where time runs left to right and every person has a lane.
                </p>
                <p>
                  It also changes what “done” means. A task is done when someone other than the person who did it has checked the evidence against criteria that were written before
                  the work started, and not a moment earlier.
                </p>
              </Prose>
              <ul className="mt-8 grid gap-px overflow-hidden rounded-xl border border-line bg-line shadow-card sm:grid-cols-3">
                {[
                  ['Recorded', 'Every status change is kept, so any past day can be rebuilt.'],
                  ['Proven', 'Done is reached only through an approved review.'],
                  ['Explained', 'Every alert and estimate says where it comes from.'],
                ].map(([t, d]) => (
                  <li key={t} className="bg-surface p-5">
                    <p className="text-[16px] font-semibold text-ink">{t}</p>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{d}</p>
                  </li>
                ))}
              </ul>
            </Chapter>

            <Chapter id="roles" title="Projects and roles">
              <Prose>
                <p>
                  Everything happens inside a project. Whoever creates one becomes its owner and invites the rest of the team by email, each with one of four roles. The server
                  checks the role on every request, so hiding a button is never the only protection.
                </p>
              </Prose>
              <dl className="mt-8 grid gap-x-10 gap-y-5 sm:grid-cols-2">
                {ROLES.map((r) => (
                  <div key={r.role} className="border-t border-line pt-4">
                    <dt className="text-[16px] font-semibold text-ink">{r.label}</dt>
                    <dd className="mt-1 text-[13px] leading-relaxed text-muted">{r.summary}</dd>
                  </div>
                ))}
              </dl>
              <PermissionTable className="mt-8" />
            </Chapter>

            <Chapter id="life-of-a-task" title="The life of a task">
              <Prose>
                <p>
                  A task moves through four stages. The first two you can move between yourself; the last two can only be reached through a submission and a review. Each stage has
                  its own colour and layer, the same in every list, chart and 3D view.
                </p>
              </Prose>
              <TaskLife className="mt-8" />
            </Chapter>

            <Chapter id="evidence" title="Evidence and review">
              <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line shadow-card md:grid-cols-2">
                <div className="bg-surface p-6">
                  <p className="text-[13px] font-semibold text-ink">A submission holds</p>
                  <ul className="mt-3 space-y-2 text-[13.5px] leading-relaxed text-ink-2">
                    <li>Notes for the reviewer: what was done and how to check it.</li>
                    <li>Links: a repository, a deployment or any other page.</li>
                    <li>Files: screenshots and documents.</li>
                    <li>A snapshot of the acceptance criteria at that moment, so later edits don’t change what was asked.</li>
                  </ul>
                </div>
                <div className="bg-surface p-6">
                  <p className="text-[13px] font-semibold text-ink">A review decides</p>
                  <ul className="mt-3 space-y-2 text-[13.5px] leading-relaxed text-ink-2">
                    <li>Met or not met, for every criterion, with an optional note on each.</li>
                    <li>Approve only when every criterion is met.</li>
                    <li>Request changes, with written feedback. The next submission becomes version 2, shown next to what was asked in version 1.</li>
                    <li>Every version and every decision stays on the task.</li>
                  </ul>
                </div>
              </div>
              <p className="mt-5 max-w-2xl text-[13px] leading-relaxed text-muted">
                Niveloft stores links and files but never opens or judges them; the reviewer does. The optional AI assistant doesn’t open them either: it only sees their names and
                addresses, and says so.
              </p>
            </Chapter>

            <Chapter id="model" title="Reading the model">
              <Prose>
                <p>
                  Every project has a Graph chapter, in 2D and in 3D. Below is the 3D view with a sample project: a four-person team six weeks into a seven-week plan. Drag the
                  model to turn it, press Play, or drag the scrubber to move through time.
                </p>
              </Prose>
              <div className="mt-8">
                <DeferredMount className="h-[720px] overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                  <Suspense fallback={<div className="h-[720px] rounded-xl border border-line bg-surface" />}>
                    <SampleModelPanel analysis={false} chart={false} viewClassName="min-h-[600px] sm:min-h-[660px]" />
                  </Suspense>
                </DeferredMount>
              </div>
              <dl className="mt-8 grid gap-x-10 border-t border-line sm:grid-cols-2">
                {MODEL_GRAMMAR.map(([term, meaning]) => (
                  <div key={term} className="grid grid-cols-[110px_minmax(0,1fr)] gap-4 border-b border-line py-3">
                    <dt className="pt-0.5 text-[13px] font-medium text-ink">{term}</dt>
                    <dd className="text-[13px] leading-relaxed text-muted">{meaning}</dd>
                  </div>
                ))}
              </dl>
            </Chapter>

            <Chapter id="forecast" title="History and forecast">
              <Prose>
                <p>
                  Inside the app, each project’s Overview and Model pages have a history-and-forecast graph. It counts the project’s tasks day by day: the solid line is every task
                  that existed, the green line the ones approved. Up to the Today rule, both come from the record. Beyond it, the lines are dashed: that’s the scheduler’s estimate.
                  On the Graph page’s 3D model the graph moves with the replay, and dragging it moves the replay.
                </p>
                <p>
                  The scheduler is deliberately simple and repeatable. It works in working days, Monday to Friday. Each person does one task at a time, and a task starts after
                  everything it waits on is finished. Work without an estimate is assumed to take one day, and the analysis says how many tasks that applies to. The same records
                  always give the same estimate. Under Schedule → What if, you can try reassignments, time off and new estimates before changing anything.
                </p>
                <p>
                  Beside the graph, an <em className="not-italic text-ink">analysis</em> lists what the numbers say: the estimated finish against the deadline, overdue work and
                  what it holds up, submissions waiting for review, rework and each person’s open work. Every line is marked Recorded or Estimate, and it’s computed, not written by
                  AI, so it’s always there.
                </p>
              </Prose>
            </Chapter>

            <Chapter id="assistant" title="Flurry, the AI assistant">
              <Prose>
                <p>
                  <em className="not-italic text-ink">Flurry</em>, Niveloft’s AI project assistant, floats in the corner of every page inside the app (click it, choose Ask Flurry
                  in the sidebar, or press Alt+A). It starts with three things: <em className="not-italic text-ink">Plan a project</em> turns a brief into draft tasks you review
                  before anything is created, <em className="not-italic text-ink">Summarise progress</em> keeps facts, estimates and what the records don’t show apart, and{' '}
                  <em className="not-italic text-ink">Review blockers</em> finds late work that holds others up, work without an owner and long review waits. “Will we make the
                  deadline?”, “What’s at risk?” and “What should I work on next?” are answered at once from the records, without AI, and say so.
                </p>
                <p>
                  It also manages tasks for you, with your say-so. “Create a task to write release notes, high priority, due Friday” becomes a filled-in task form, and “Start
                  LIB-8” becomes a confirm button. Nothing changes until you press it, and voice can prepare a change but never confirm one.
                </p>
                <p>
                  Any other question goes to an AI model, which answers from that project’s records and the scheduler’s estimate. It may suggest a task or a start the same way, for
                  you to confirm. Voice uses the browser’s own speech recognition (Chrome, Edge, Safari). There’s a microphone button, and an optional “Hey Flurry” wake phrase.
                  It’s off until you turn it on, listens only while the tab is visible, and always shows when it’s listening.
                </p>
              </Prose>
              <ul className="mt-6 grid gap-px overflow-hidden rounded-xl border border-line bg-line shadow-card sm:grid-cols-2">
                {[
                  ['Only what you can see', 'The server gathers the records, after checking you’re a member of the project. Nothing from other projects is included.'],
                  [
                    'Says what it doesn’t know',
                    'It’s instructed to say when the records don’t cover something and to list that separately, so “unknown” isn’t passed off as “no”.',
                  ],
                  ['Shows its sources', 'Answers cite the tasks they rely on, as links you can check. Citations of tasks that don’t exist are dropped.'],
                  ['Changes nothing', 'It only reads: it has no way to approve, assign or reschedule work. It isn’t given evidence links or files, so it can’t vouch for them.'],
                  ['Keys stay on the server', 'The AI provider’s key is set on the backend and never reaches the browser.'],
                  ['Honest when it’s off', 'Without a provider set up, the panel says the assistant isn’t available. It never shows a made-up answer.'],
                ].map(([t, d]) => (
                  <li key={t} className="bg-surface p-5">
                    <p className="text-[14px] font-medium text-ink">{t}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted">{d}</p>
                  </li>
                ))}
              </ul>
            </Chapter>

            <Chapter id="first-steps" title="Your first ten minutes">
              <ol className="border-t border-line">
                {FIRST_STEPS.map((s, i) => (
                  <li key={s.title} className="grid grid-cols-[48px_minmax(0,1fr)] gap-4 border-b border-line py-4 sm:grid-cols-[48px_220px_minmax(0,1fr)]">
                    <span className="reading text-[24px] text-brand">{i + 1}</span>
                    <span className="text-[15px] font-semibold text-ink">{s.title}</span>
                    <span className="col-start-2 text-[13px] leading-relaxed text-muted sm:col-start-3">{s.text}</span>
                  </li>
                ))}
              </ol>
            </Chapter>

            <Chapter id="keyboard" title="Keyboard and access">
              <dl className="grid gap-x-10 border-t border-line sm:grid-cols-2">
                {[
                  [PALETTE_SHORTCUT, 'Search tasks and projects, or run a command, from anywhere.'],
                  ['Arrow keys', 'In the model, move between tasks; Enter shows details, Escape clears.'],
                  ['P', 'In the model, play or pause the replay.'],
                  ['Alt+A', 'Open Flurry from any page in the app, or jump into it; press it again inside to close it.'],
                  ['Space, arrows', 'On the board, pick up a card, move it and put it down.'],
                  ['Reduced motion', 'If your system asks for less motion, nothing turns or animates by itself.'],
                  ['Without 3D', 'Every 3D view has a text version: the timeline, the dependency list and the analysis.'],
                ].map(([k, d]) => (
                  <div key={k} className="grid grid-cols-[110px_minmax(0,1fr)] gap-4 border-b border-line py-3">
                    <dt>
                      <kbd className="rounded-md border border-line-strong bg-surface px-1.5 py-0.5 font-sans text-[12px] text-ink shadow-[0_1px_0_var(--line-strong)]">{k}</kbd>
                    </dt>
                    <dd className="text-[13px] leading-relaxed text-muted">{d}</dd>
                  </div>
                ))}
              </dl>
            </Chapter>

            <section className="rounded-2xl border border-line bg-surface p-8 shadow-card sm:p-10">
              <p className="display-wide text-[30px] leading-tight text-ink sm:text-[38px]">That’s all you need to start.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                {signedIn ? (
                  <Link to="/dashboard" className={buttonClass('primary', 'lg')}>
                    Go to Today
                  </Link>
                ) : (
                  <>
                    <Link to="/register" className={buttonClass('primary', 'lg')}>
                      Create an account
                    </Link>
                    <Link to="/login" className={buttonClass('secondary', 'lg')}>
                      Sign in
                    </Link>
                  </>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </PublicPage>
  );
}

function Chapter({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <h2 id={`${id}-title`} className="display-wide text-[30px] leading-tight text-ink sm:text-[36px]">
        {title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Prose({ children }: { children: ReactNode }) {
  return <div className="max-w-2xl space-y-4 text-[15px] leading-[1.7] text-ink-2">{children}</div>;
}

/** The four stages as tabs; each shows who acts, what's required and what comes next. */
function TaskLife({ className }: { className?: string }) {
  const [i, setI] = useState(0);
  const stage = TASK_STAGES[i];
  const move = (next: number) => {
    const n = (next + TASK_STAGES.length) % TASK_STAGES.length;
    setI(n);
    document.getElementById(`stage-tab-${n}`)?.focus();
  };
  return (
    <div className={cn('overflow-hidden rounded-xl border border-line bg-surface shadow-card', className)}>
      <div role="tablist" aria-label="Stages of a task" className="grid grid-cols-2 border-b border-line sm:grid-cols-4">
        {TASK_STAGES.map((s, k) => (
          <button
            key={s.status}
            id={`stage-tab-${k}`}
            type="button"
            role="tab"
            aria-selected={i === k}
            aria-controls="stage-panel"
            tabIndex={i === k ? 0 : -1}
            onClick={() => setI(k)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') move(k + 1);
              else if (e.key === 'ArrowLeft') move(k - 1);
              else if (e.key === 'Home') move(0);
              else if (e.key === 'End') move(TASK_STAGES.length - 1);
            }}
            className={cn(
              'flex items-center gap-3 border-b-2 px-5 py-4 text-left transition-colors not-last:border-r not-last:border-r-line',
              i === k ? 'border-b-accent bg-surface text-ink' : 'border-b-transparent bg-surface-2/60 text-muted hover:text-ink',
            )}
          >
            <span className="inline-block size-3 shrink-0 rounded-[4px]" style={{ background: `var(${s.cssVar})` }} aria-hidden="true" />
            <span className="block text-[14px] font-medium">{s.label}</span>
          </button>
        ))}
      </div>
      <div id="stage-panel" role="tabpanel" aria-labelledby={`stage-tab-${i}`} className="grid gap-6 p-6 md:grid-cols-3">
        <StageFact label="Who" text={stage.who} />
        <StageFact label="What it needs" text={stage.needs} />
        <StageFact label="What happens next" text={stage.next} />
        <p className="text-[12px] text-muted md:col-span-3">
          Its colour: <span className="text-ink">{stage.material}</span>.
        </p>
      </div>
    </div>
  );
}

function StageFact({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-[13px] font-semibold text-ink">{label}</p>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">{text}</p>
    </div>
  );
}

/** Which chapter is in view, for the index. */
function useActiveChapter(): string {
  const [active, setActive] = useState<string>(CHAPTERS[0].id);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const visible = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting);
        const first = CHAPTERS.find((c) => visible.get(c.id));
        if (first) setActive(first.id);
      },
      { rootMargin: '-20% 0px -60% 0px' },
    );
    for (const c of CHAPTERS) {
      const el = document.getElementById(c.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);
  return active;
}
