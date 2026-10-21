import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { useProjectQuery } from '@/api/endpoints';
import { AssistantPanel } from '@/features/assistant/AssistantPanel';
import { AssistantProvider } from '@/features/assistant/AssistantProvider';
import { ProjectFormDialog } from '@/features/projects/ProjectFormDialog';
import { useLiveUpdates } from '@/features/live/useLiveUpdates';
import { cn } from '@/lib/cn';
import { CommandPalette } from '../CommandPalette';
import { PrintHeader } from '../PrintHeader';
import { BackToTop } from '../ScrollAids';
import { FlurryCompanion } from '@/features/flurry/FlurryCompanion';
import { KeyboardShortcuts } from '@/features/keyboard/KeyboardShortcuts';
import { PageSpinner } from '../ui/Spinner';
import { AppAtmosphere } from './AppAtmosphere';
import { AppSidebar, AppTopBar, PRIMARY_NAV, SIDEBAR_WIDTH } from './AppSidebar';

/**
 * The frame around every signed-in page: a stable sidebar (a drawer on smaller screens), a slim
 * top bar that names the current place, the page, Flurry (roaming until it's called), and the
 * front page's weather faintly behind it all.
 */
export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [creating, setCreating] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const live = useLiveUpdates();
  const main = useRef<HTMLElement>(null);

  // Page-wide layers (the cookie question) sit beside the sidebar, not over it.
  useEffect(() => {
    document.documentElement.style.setProperty('--app-sidebar', `${SIDEBAR_WIDTH}px`);
    return () => {
      document.documentElement.style.removeProperty('--app-sidebar');
    };
  }, []);

  // ⌘K / Ctrl+K anywhere; "/" when not typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // After navigating, move focus to the new page's heading so screen readers announce it and
  // keyboard users start at the top. Filters and tabs that only change ?query don't count.
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    const id = window.setTimeout(() => {
      const heading = main.current?.querySelector<HTMLElement>('h1');
      const target = heading ?? main.current;
      if (!target) return;
      if (heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }, 80);
    return () => window.clearTimeout(id);
  }, [location.pathname]);

  return (
    <AssistantProvider>
    <div className="min-h-dvh">
      <AppAtmosphere />
      <a
        href="#main"
        data-print="hide"
        className="caps sr-only z-[100] rounded-md bg-brand px-3 py-2 text-white dark:text-canvas focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <AppSidebar onOpenSearch={() => setPaletteOpen(true)} onNewProject={() => setCreating(true)} live={live} />
      {/* When Flurry is pinned beside the page (large screens), the page makes room for it rather than being covered. */}
      <div
        className="flex min-h-dvh flex-col transition-[padding] duration-200 lg:pr-[var(--flurry-dock,0px)] lg:pl-[var(--sidebar-width)]"
        style={{ ['--sidebar-width' as string]: `${SIDEBAR_WIDTH}px` }}
      >
        <AppTopBar onOpenSearch={() => setPaletteOpen(true)} live={live}>
          <PlaceTrail />
        </AppTopBar>
        <main id="main" ref={main} className="flex-1 focus:outline-none [&_h1:focus]:outline-none" tabIndex={-1}>
          <div className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-10">
            <PrintHeader />
          </div>
          <Suspense fallback={<PageSpinner />}>
            <Outlet />
          </Suspense>
          {/* Room to scroll the last row of a page clear of Flurry in the corner. */}
          <div className="h-20" aria-hidden="true" data-print="hide" />
        </main>
      </div>
      <ProjectFormDialog open={creating} onOpenChange={setCreating} onSaved={(p) => navigate(`/projects/${p.id}`)} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onNewProject={() => setCreating(true)} />
      <KeyboardShortcuts />
      <BackToTop />
      <FlurryCompanion />
      <AssistantPanel />
    </div>
    </AssistantProvider>
  );
}

/** Standard page padding and max width, aligned with the top bar. */
export function PageContainer({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn('mx-auto w-full px-4 pt-6 pb-8 sm:px-6 lg:px-10 lg:pt-8', wide ? 'max-w-[1600px]' : 'max-w-[1360px]', className)}>{children}</div>;
}

const PLACE_LABELS: Record<string, string> = {
  ...Object.fromEntries(PRIMARY_NAV.map((n) => [n.to, n.label])),
  '/settings': 'Settings',
  '/arena': 'AI arena',
  '/site-health': 'Site health',
};

/** Where you are, in the top bar: the place, and inside a project its name. */
function PlaceTrail() {
  const { pathname } = useLocation();
  const projectId = Number(/^\/projects\/(\d+)/.exec(pathname)?.[1] ?? NaN);
  const { data: project } = useProjectQuery(projectId, { skip: !Number.isFinite(projectId) });
  const place = PLACE_LABELS['/' + (pathname.split('/')[1] ?? '')];
  if (!place) return null;
  return (
    <nav aria-label="You are here" className="flex min-w-0 items-center gap-1.5 text-[13.5px]">
      {Number.isFinite(projectId) ? (
        <>
          <Link to="/projects" className="rounded px-1 text-muted transition-colors hover:text-ink">
            Projects
          </Link>
          <ChevronRight className="size-3.5 shrink-0 text-subtle" aria-hidden="true" />
          <span className="flex min-w-0 items-center gap-2 px-1 font-medium text-ink" aria-current="page">
            {project && <span className="size-2 shrink-0 rounded-[3px]" style={{ backgroundColor: project.color }} aria-hidden="true" />}
            <span className="truncate">{project?.name ?? '…'}</span>
          </span>
        </>
      ) : (
        <span className="px-1 font-medium text-ink" aria-current="page">
          {place}
        </span>
      )}
    </nav>
  );
}
