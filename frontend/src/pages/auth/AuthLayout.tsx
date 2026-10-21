import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { PublicHeader } from '@/components/layout/PublicFrame';
import { BackendStatus } from '@/features/auth/BackendStatus';
import { FloatingContact } from '@/features/contact/FloatingContact';
import { sampleSnowpack } from '@/features/public/home/sampleSnowpack';
import { ONBOARDING_SAMPLE } from '@/features/public/sampleProject';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/hooks';
import { LAYER_WORD, READING_ORDER } from '@/three/snowpack';

// The stage brings three.js, so it loads after the form is already usable.
const SnowpackStage = lazy(() => import('@/features/public/home/SnowpackStage').then((m) => ({ default: m.SnowpackStage })));

const SWATCH = { todo: 'var(--strata-todo)', progress: 'var(--strata-progress)', review: 'var(--strata-review)', done: 'var(--strata-done)' } as const;

/**
 * Sign-in and registration. On large screens the left half is an example project as a block of
 * snowpack (the front page's centrepiece): whole when signing in, and on the sign-up page lifting
 * apart to show each state work passes through. The right half is the form. On small screens only
 * the form is shown, under the same public header as the front page.
 */
export function AuthLayout({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
  exhibit = 'model',
}: {
  eyebrow: string;
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  /** 'model': the block, whole; 'stages': its layers, one at a time; 'none': just the form (pages reached from emails). */
  exhibit?: 'model' | 'stages' | 'none';
}) {
  // The exhibit only exists on large screens; don't download three.js or start WebGL on phones.
  const wide = useMediaQuery('(min-width: 1024px)') && exhibit !== 'none';
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <a
        href="#main"
        data-print="hide"
        className="sr-only z-[100] rounded-md bg-brand px-3 py-2 text-[13px] font-medium text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3 dark:text-canvas"
      >
        Skip to content
      </a>
      <PublicHeader />
      <main id="main" className={exhibit === 'none' ? 'flex flex-1' : 'grid flex-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]'}>
        {wide && <Exhibit kind={exhibit === 'stages' ? 'stages' : 'model'} />}

        <section className={cn('flex flex-col items-center justify-center px-5 py-12 sm:px-10', exhibit === 'none' ? 'flex-1' : 'bg-surface dark:bg-surface/60')}>
          <div className={cn('w-full max-w-[400px]', exhibit === 'none' && 'rounded-2xl border border-line bg-surface p-7 shadow-raised sm:p-9')}>
            {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
            <h1 className="text-[32px] text-ink sm:text-[34px]">{title}</h1>
            {subtitle && <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{subtitle}</p>}
            <div className="mt-8">
              <BackendStatus />
              {children}
            </div>
            <div className="mt-8 border-t border-line pt-6 text-[14px] text-muted">{footer}</div>
            <p className="mt-5 flex flex-wrap gap-x-4 text-[12.5px] text-muted">
              <Link to="/privacy" className="inline-block py-1.5 hover:text-ink">
                Privacy policy
              </Link>
              <Link to="/terms" className="inline-block py-1.5 hover:text-ink">
                Terms and conditions
              </Link>
              <Link to="/faq" className="inline-block py-1.5 hover:text-ink">
                Help and FAQ
              </Link>
            </p>
          </div>
        </section>
      </main>
      <FloatingContact />
    </div>
  );
}

/** An example project as a block of snowpack, with a line about what it shows. */
function Exhibit({ kind }: { kind: 'model' | 'stages' }) {
  const data = useMemo(() => sampleSnowpack(ONBOARDING_SAMPLE), []);
  const reduce = useMediaQuery('(prefers-reduced-motion: reduce)');
  // On the sign-up page the layers lift apart and each is read in turn, every few seconds.
  const [step, setStep] = useState(kind === 'stages' && !reduce ? 1 : 0);
  useEffect(() => {
    if (kind !== 'stages' || reduce) return;
    const id = window.setInterval(() => setStep((s) => (s % 4) + 1), 3600);
    return () => window.clearInterval(id);
  }, [kind, reduce]);
  const reading = step ? READING_ORDER[step - 1] : null;
  return (
    <section className="relative flex min-h-0 flex-col overflow-hidden border-r border-line px-10 pt-12 pb-10 xl:px-14" aria-label="About Niveloft" data-auth-exhibit={kind}>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#e7eef4_0%,#dfe8ef_50%,#d3dee7_100%)] dark:bg-[linear-gradient(180deg,#081019_0%,#0b1620_50%,#0f1c28_100%)]" aria-hidden="true" />
      <div className="relative">
        <p className="text-[13px] font-medium text-ink-2">{kind === 'model' ? 'How Niveloft reads a project' : 'How work moves'}</p>
        <h2 className="display-wide mt-4 max-w-xl text-[40px] text-ink xl:text-[48px]">{kind === 'model' ? 'See what will finish, and what’s in the way.' : 'Every task settles, layer by layer.'}</h2>
      </div>
      <div className="relative -mx-10 mt-2 min-h-[420px] flex-1 xl:-mx-14">
        <Suspense fallback={null}>
          <SnowpackStage data={data} story={step} framing={{ x: 0, y: 0.04 }} className="absolute inset-0" />
        </Suspense>
      </div>
      <div className="relative">
        {kind === 'stages' ? (
          <ol className="grid grid-cols-4 gap-3" aria-label="The four states of a task">
            {(['todo', 'progress', 'review', 'done'] as const).map((k) => (
              <li key={k} className={cn('border-t-2 pt-2 text-[12.5px] transition-colors', reading === k ? 'border-ink text-ink' : 'border-line-strong/60 text-muted')}>
                <span className="flex items-center gap-1.5 font-medium">
                  <span className="size-2 rounded-[3px]" style={{ backgroundColor: SWATCH[k] }} aria-hidden="true" />
                  {LAYER_WORD[k]}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
        <p className="mt-4 max-w-xl text-[13px] leading-relaxed text-muted">
          {kind === 'model'
            ? `Each layer is a state and each slice a task, here from an example project, “${ONBOARDING_SAMPLE.name}”. The red slice is ${data.weak?.key ?? 'the late task'}: late, and holding ${data.weak?.holdsUp.length ?? 'other'} tasks up.`
            : 'Criteria are written before work starts, evidence is submitted, and someone else approves it. That is the only way a task becomes done.'}
        </p>
      </div>
    </section>
  );
}
