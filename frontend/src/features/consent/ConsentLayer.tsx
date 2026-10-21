import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { ANALYTICS, ANALYTICS_CONFIGURED } from '@/config';
import { trackPage } from '@/features/analytics/analytics';
import { applyStoredConsent, closeCookieSettings, decideConsent, useConsent } from './consent';

/** Names of the analytics this copy would load, for the banner and settings. */
export function analyticsNames(): string {
  const names = [ANALYTICS.vercel && 'Vercel Web Analytics', ANALYTICS.ga4 && 'Google Analytics'].filter(Boolean) as string[];
  return names.join(' and ');
}

/**
 * The cookie banner (only when this copy has analytics to ask about) and the cookie settings
 * dialog (always available from the footer). Rejecting is as easy as accepting.
 */
export function ConsentLayer() {
  const { choice, settingsOpen } = useConsent();
  const location = useLocation();

  useEffect(() => applyStoredConsent(), []);
  // Google Analytics page views follow the route; Vercel's script tracks them itself.
  useEffect(() => trackPage(location.pathname), [location.pathname]);

  return (
    <>
      {ANALYTICS_CONFIGURED && choice === null && !settingsOpen && <ConsentBanner />}
      <CookieSettings open={settingsOpen} analyticsOn={choice?.analytics ?? false} />
    </>
  );
}

function ConsentBanner() {
  return (
    <section
      role="region"
      aria-label="Cookie choice"
      data-print="hide"
      className="fixed inset-x-3 bottom-3 z-40 rounded-xl border border-line-strong bg-surface p-4 shadow-pop sm:inset-x-auto sm:left-4 sm:bottom-4 sm:max-w-md sm:p-5 lg:left-[calc(var(--app-sidebar,0px)+1rem)]"
    >
      <p className="text-[13.5px] font-medium text-ink">Can we count your visit?</p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">
        We’d like to use {analyticsNames()} to see which pages people use, so we can improve them. It’s off unless you say yes. Staying signed in and your
        settings use essential storage, which is always on.{' '}
        <Link to="/privacy#cookies" className="text-ink underline decoration-line-strong underline-offset-2 transition-colors hover:text-accent hover:decoration-accent">
          Privacy policy
        </Link>
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => decideConsent(false)}>
          No, thanks
        </Button>
        <Button onClick={() => decideConsent(true)}>Yes, that’s fine</Button>
      </div>
    </section>
  );
}

function CookieSettings({ open, analyticsOn }: { open: boolean; analyticsOn: boolean }) {
  const [analytics, setAnalytics] = useState(analyticsOn);
  useEffect(() => {
    if (open) setAnalytics(analyticsOn);
  }, [open, analyticsOn]);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && closeCookieSettings()}
      title="Cookie settings"
      description="Choose what this site may store in your browser. You can change this at any time."
      footer={
        <>
          <Button variant="secondary" onClick={closeCookieSettings}>
            Cancel
          </Button>
          <Button onClick={() => decideConsent(ANALYTICS_CONFIGURED && analytics)}>Save my choice</Button>
        </>
      }
    >
      <ul className="divide-y divide-line text-[13px]">
        <li className="flex items-start gap-3 pb-4">
          <input type="checkbox" checked disabled className="mt-0.5 size-4" id="consent-essential" aria-describedby="consent-essential-desc" />
          <div>
            <label htmlFor="consent-essential" className="font-medium text-ink">
              Essential (always on)
            </label>
            <p id="consent-essential-desc" className="mt-1 leading-relaxed text-muted">
              Keeps you signed in, remembers your theme and view settings, and remembers this choice. Nothing here tracks you.
            </p>
          </div>
        </li>
        <li className="flex items-start gap-3 pt-4">
          <input
            type="checkbox"
            id="consent-analytics"
            className="mt-0.5 size-4 accent-[var(--accent)]"
            checked={ANALYTICS_CONFIGURED && analytics}
            disabled={!ANALYTICS_CONFIGURED}
            onChange={(e) => setAnalytics(e.target.checked)}
            aria-describedby="consent-analytics-desc"
          />
          <div>
            <label htmlFor="consent-analytics" className="font-medium text-ink">
              Analytics
            </label>
            <p id="consent-analytics-desc" className="mt-1 leading-relaxed text-muted">
              {ANALYTICS_CONFIGURED
                ? `${analyticsNames()} counts page views, with project and task numbers removed from addresses. ${ANALYTICS.ga4 ? 'Google Analytics sets cookies; turning this off removes them.' : 'Vercel Web Analytics sets no cookies.'}`
                : 'This site doesn’t use analytics, so there’s nothing to turn on.'}
            </p>
          </div>
        </li>
      </ul>
    </Dialog>
  );
}
