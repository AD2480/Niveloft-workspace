import { Link, useLocation } from 'react-router';
import { useAppSelector } from '@/app/store';
import { PublicPage } from '@/components/layout/PublicFrame';
import { buttonClass } from '@/components/ui/buttonStyles';
import { FlurryFigure } from '@/features/flurry/FlurryFigure';
import { usePageMeta } from '@/lib/pageMeta';

/** Any address that isn't a page. The host also answers it with HTTP 404 (see vercel.json). */
export function PublicNotFoundPage() {
  usePageMeta({ title: 'Page not found', description: 'This page doesn’t exist or has moved.', noindex: true });
  const signedIn = useAppSelector((s) => s.auth.token !== null);
  const { pathname } = useLocation();
  return (
    <PublicPage>
      <section className="mx-auto grid max-w-[1360px] items-center gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:px-10 lg:py-28">
        <div>
          <p className="eyebrow">Error 404</p>
          <h1 className="mt-5 max-w-3xl display-wide text-[44px] leading-[1.02] text-ink sm:text-[64px]">There’s nothing at this address.</h1>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-ink-2">
            <code className="break-all bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-ink">{pathname}</code> doesn’t exist or has moved. If you followed a link here, it may
            be out of date.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link to={signedIn ? '/dashboard' : '/'} className={buttonClass('primary', 'lg')}>
              {signedIn ? 'Go to Today' : 'Go to the front page'}
            </Link>
            <Link to="/introduction" className="text-[14px] text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
              Read the introduction
            </Link>
          </div>
        </div>
        {/* Flurry, looking around for the page too. */}
        <div className="relative mx-auto hidden size-[260px] lg:block" aria-hidden="true">
          <div className="bg-plate absolute inset-x-6 bottom-2 h-10 rounded-[50%] opacity-70 blur-md" />
          <FlurryFigure mood="curious" className="absolute inset-0 size-full" />
        </div>
      </section>
    </PublicPage>
  );
}
