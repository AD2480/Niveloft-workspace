import * as RD from '@radix-ui/react-dialog';
import { BarChart3, CalendarDays, ChevronsUpDown, CircleCheckBig, FolderKanban, House, Inbox, LifeBuoy, Menu as MenuIcon, Moon, Plus, Search, Settings, Sun, X, type LucideIcon } from 'lucide-react';
import { useEffect, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { useProjectsQuery, useUnreadCountQuery } from '@/api/endpoints';
import { useAppDispatch, useAppSelector } from '@/app/store';
import { mobileNavSet, themeChanged, type ThemePreference } from '@/app/uiSlice';
import { useSignOut } from '@/features/auth/useSignOut';
import { useOptionalAssistant } from '@/features/assistant/assistantContext';
import { openContact } from '@/features/contact/contactStore';
import { FlurryFigure } from '@/features/flurry/FlurryFigure';
import { setFlurryEntrance } from '@/features/flurry/flurryCues';
import { isStill, useFlurryPrefs } from '@/features/flurry/flurryPrefs';
import type { LiveStatus } from '@/features/live/useLiveUpdates';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/hooks';
import { PALETTE_SHORTCUT } from '../CommandPalette';
import { ScrollProgress } from '../ScrollAids';
import { Avatar } from '../ui/Avatar';
import { Menu, MenuCheckItem, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../ui/Menu';
import { Logo } from './Logo';

/** The places. Everything else is reached from these, from a project, or from ⌘K. */
export const PRIMARY_NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/dashboard', label: 'Today', icon: House },
  { to: '/my-tasks', label: 'My work', icon: CircleCheckBig },
  { to: '/inbox', label: 'Inbox', icon: Inbox },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/analytics', label: 'Reports', icon: BarChart3 },
];

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Match system' },
];

const LIVE: Record<LiveStatus, { label: string; dot: string }> = {
  live: { label: 'Live updates on', dot: 'bg-success' },
  connecting: { label: 'Connecting', dot: 'bg-warning' },
  reconnecting: { label: 'Reconnecting', dot: 'bg-warning' },
  offline: { label: 'Offline', dot: 'bg-danger' },
  local: { label: 'Test API in this browser', dot: 'bg-accent' },
};

export const SIDEBAR_WIDTH = 256;

/**
 * The signed-in frame's navigation: a stable sidebar on large screens (logo, search, the places,
 * your active projects, Flurry, help and your account) and the same content in a drawer on
 * smaller ones, opened from the top bar.
 */
export function AppSidebar({ onOpenSearch, onNewProject, live }: { onOpenSearch: () => void; onNewProject: () => void; live: LiveStatus }) {
  const dispatch = useAppDispatch();
  const open = useAppSelector((s) => s.ui.mobileNavOpen);
  const location = useLocation();
  const wide = useMediaQuery('(min-width: 1024px)');
  // A new page closes the drawer.
  useEffect(() => {
    dispatch(mobileNavSet(false));
  }, [location.pathname, dispatch]);

  return (
    <>
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-sidebar lg:flex"
        style={{ width: SIDEBAR_WIDTH }}
        aria-label="Sidebar"
        data-print="hide"
        data-app-sidebar=""
      >
        {wide && <SidebarContent onOpenSearch={onOpenSearch} onNewProject={onNewProject} live={live} />}
      </aside>
      <RD.Root open={open && !wide} onOpenChange={(o) => dispatch(mobileNavSet(o))}>
        <RD.Portal>
          <RD.Overlay className="fixed inset-0 z-50 bg-graphite/40 animate-fade-in lg:hidden" />
          <RD.Content
            className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,88vw)] flex-col border-r border-line bg-sidebar shadow-float animate-slide-in-left focus:outline-none lg:hidden"
            data-app-drawer=""
            aria-describedby={undefined}
          >
            <RD.Title className="sr-only">Menu</RD.Title>
            <RD.Close className="absolute top-3 right-3 flex size-9 items-center justify-center rounded-md text-muted hover:bg-surface-3 hover:text-ink" aria-label="Close the menu">
              <X className="size-4" aria-hidden="true" />
            </RD.Close>
            <SidebarContent
              onOpenSearch={() => {
                dispatch(mobileNavSet(false));
                onOpenSearch();
              }}
              onNewProject={() => {
                dispatch(mobileNavSet(false));
                onNewProject();
              }}
              live={live}
            />
          </RD.Content>
        </RD.Portal>
      </RD.Root>
    </>
  );
}

function SidebarContent({ onOpenSearch, onNewProject, live }: { onOpenSearch: () => void; onNewProject: () => void; live: LiveStatus }) {
  const location = useLocation();
  // The live connection pushes new notifications; poll only as a fallback when it isn't live.
  const { data: unread = 0 } = useUnreadCountQuery(undefined, { pollingInterval: live === 'live' || live === 'local' ? 0 : 60_000 });
  const { data: projects } = useProjectsQuery({ status: 'ACTIVE', size: 8 });
  const activeProject = /^\/projects\/(\d+)/.exec(location.pathname)?.[1];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[60px] shrink-0 items-center gap-2 px-4">
        <Link to="/dashboard" className="rounded-md px-1 transition-opacity hover:opacity-80" aria-label="Niveloft, today">
          <Logo />
        </Link>
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex h-9 w-full items-center gap-2.5 rounded-md border border-line bg-surface px-2.5 text-[13px] text-muted shadow-card transition-colors hover:border-line-strong hover:text-ink dark:bg-surface-2"
          aria-label={`Search and commands (${PALETTE_SHORTCUT})`}
          data-sidebar-search=""
        >
          <Search className="size-4" aria-hidden="true" />
          <span className="flex-1 text-left">Search or jump to…</span>
          <kbd className="rounded-[5px] bg-surface-3 px-1.5 py-px font-sans text-[11px] font-medium text-muted">{PALETTE_SHORTCUT}</kbd>
        </button>
      </div>

      <nav aria-label="Main" className="scrollbar-thin mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <ul className="space-y-px">
          {PRIMARY_NAV.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} className={({ isActive }) => navClass(isActive)} aria-label={item.to === '/inbox' ? `Inbox, ${unread} unread` : undefined}>
                <item.icon className="size-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
                <span className="flex-1">{item.label}</span>
                {item.to === '/inbox' && unread > 0 && (
                  <span className="min-w-5 rounded-full bg-brand px-1.5 py-px text-center text-[11px] font-semibold text-white tabular dark:text-canvas">{unread > 99 ? '99+' : unread}</span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex items-center justify-between pr-1 pl-2.5">
          <p className="text-[12px] font-medium text-muted">Active projects</p>
          <button type="button" onClick={onNewProject} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface-3 hover:text-ink" aria-label="New project" title="New project">
            <Plus className="size-4" aria-hidden="true" />
          </button>
        </div>
        <ul className="mt-1 space-y-px" data-sidebar-projects="">
          {projects?.content.map((p) => {
            const active = activeProject === String(p.id);
            return (
              <li key={p.id}>
                <Link to={`/projects/${p.id}`} className={navClass(active)} aria-current={active ? 'page' : undefined} title={p.name}>
                  <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
                    <span className="size-[9px] rounded-[3px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]" style={{ backgroundColor: p.color }} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="text-[11.5px] font-medium text-subtle tabular">{p.key}</span>
                </Link>
              </li>
            );
          })}
          {projects && projects.content.length === 0 && (
            <li>
              <button type="button" onClick={onNewProject} className="w-full rounded-md px-2.5 py-2 text-left text-[13px] text-muted hover:bg-surface-3 hover:text-ink">
                No active projects yet. Create one.
              </button>
            </li>
          )}
        </ul>
      </nav>

      <div className="shrink-0 space-y-px border-t border-line px-3 pt-3 pb-3">
        <AskFlurryItem />
        <NavLink to="/faq" className={({ isActive }) => navClass(isActive)}>
          <LifeBuoy className="size-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
          Help and FAQ
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => navClass(isActive)}>
          <Settings className="size-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
          Settings
        </NavLink>
        <AccountMenu live={live} />
      </div>
    </div>
  );
}

function navClass(active: boolean): string {
  return cn(
    'flex h-8 pointer-coarse:h-10 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] font-medium transition-[background-color,color,box-shadow] duration-150',
    active
      ? 'bg-surface text-ink shadow-[0_1px_2px_hsl(var(--shadow-color)/0.08),0_0_0_1px_hsl(var(--shadow-color)/0.05)] dark:bg-surface-3 dark:shadow-none [&_svg]:text-accent'
      : 'text-ink-2 hover:bg-surface-3/70 hover:text-ink [&_svg]:text-muted dark:hover:bg-surface-2',
  );
}

/**
 * Flurry in the sidebar: "Ask Flurry" opens the conversation. When Flurry is hidden it retreats into
 * this item (its icon here, asleep) until you call it back with the small button beside it.
 */
function AskFlurryItem() {
  const a = useOptionalAssistant();
  const userId = useAppSelector((s) => s.auth.user?.id ?? 0);
  const [prefs, setPrefs] = useFlurryPrefs(userId);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  if (!a) return null;
  const hidden = prefs.mode === 'hide';
  const still = isStill(prefs, reduceMotion);
  const callBack = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.closest('[data-sidebar-flurry-row]')?.getBoundingClientRect();
    if (r) setFlurryEntrance({ x: r.left + 4, y: r.top + r.height / 2 - 28 });
    setPrefs({ mode: prefs.lastMode });
  };
  return (
    <div className="flex items-center gap-1" data-sidebar-flurry-row="" data-flurry-hidden={hidden ? '' : undefined}>
      <button type="button" onClick={() => a.setOpen(true)} className={cn(navClass(false), 'min-w-0 flex-1')} data-sidebar-flurry="">
        <span className="relative -my-1 -ml-1 size-6 shrink-0">
          <FlurryFigure mood={hidden ? 'sleep' : a.mood === 'settled' ? 'idle' : a.mood} still={still} glow={false} mini className="size-6" />
        </span>
        <span className="flex-1 truncate text-left">Ask Flurry</span>
        {!hidden && <kbd className="rounded-[5px] bg-surface-3 px-1.5 py-px font-sans text-[11px] font-medium text-muted">Alt A</kbd>}
      </button>
      {hidden && (
        <button
          type="button"
          onClick={callBack}
          className="flex h-7 shrink-0 items-center rounded-md border border-line-strong bg-surface px-2 text-[12px] font-medium text-ink-2 shadow-card hover:text-ink"
          title="Flurry is resting here. Call it back onto your pages."
          data-flurry-call-back=""
        >
          Call back
        </button>
      )}
    </div>
  );
}

function AccountMenu({ live }: { live: LiveStatus }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const user = useAppSelector((s) => s.auth.user);
  const theme = useAppSelector((s) => s.ui.theme);
  const signOut = useSignOut();
  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" className="mt-1.5 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-3/70 dark:hover:bg-surface-2" aria-label="Account and appearance" data-account-menu="">
          <Avatar user={user} size="md" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-ink">{user?.name}</span>
            <span className="flex items-center gap-1.5 text-[12px] text-muted" role="status">
              <span className={cn('size-1.5 rounded-full', LIVE[live].dot)} aria-hidden="true" />
              {LIVE[live].label}
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted" aria-hidden="true" />
        </button>
      </MenuTrigger>
      <MenuContent align="start" side="top" className="w-64">
        <div className="px-2 py-2">
          <p className="truncate text-[13px] font-medium text-ink">{user?.name}</p>
          <p className="truncate text-xs text-muted">{user?.email}</p>
        </div>
        <MenuSeparator />
        <MenuItem onSelect={() => navigate('/settings')}>Profile</MenuItem>
        <MenuItem onSelect={() => navigate('/settings?tab=security')}>Password and sign-in</MenuItem>
        <MenuItem onSelect={() => navigate('/arena')}>AI arena</MenuItem>
        {user?.operator && <MenuItem onSelect={() => navigate('/site-health')}>Site health</MenuItem>}
        <MenuSeparator />
        <MenuItem onSelect={() => navigate('/introduction')}>Introduction</MenuItem>
        <MenuItem onSelect={() => openContact()}>Contact us</MenuItem>
        <MenuSeparator />
        <MenuLabel>Appearance</MenuLabel>
        {THEMES.map((t) => (
          <MenuCheckItem key={t.value} checked={theme === t.value} onSelect={() => dispatch(themeChanged(t.value))}>
            {t.label}
          </MenuCheckItem>
        ))}
        <MenuSeparator />
        <MenuItem onSelect={signOut}>Sign out</MenuItem>
      </MenuContent>
    </Menu>
  );
}

/**
 * The top bar: on small screens the menu button and logo; on every screen the current place,
 * search and the inbox. It carries the reading-progress line.
 */
export function AppTopBar({ onOpenSearch, live, children }: { onOpenSearch: () => void; live: LiveStatus; children?: ReactNode }) {
  const dispatch = useAppDispatch();
  const drawerOpen = useAppSelector((s) => s.ui.mobileNavOpen);
  const { data: unread = 0 } = useUnreadCountQuery(undefined, { pollingInterval: live === 'live' || live === 'local' ? 0 : 60_000 });
  return (
    <header className="sticky top-0 z-20 bg-canvas/85 backdrop-blur-md supports-[backdrop-filter]:bg-canvas/72" data-print="hide" data-scrolled="false" data-app-topbar="">
      <div className="flex h-14 items-center gap-3 px-4 sm:px-6 lg:px-10">
        <button
          type="button"
          className="-ml-1.5 flex size-10 items-center justify-center rounded-md text-ink transition-colors hover:bg-surface-3 lg:hidden"
          onClick={() => dispatch(mobileNavSet(true))}
          aria-label="Open the menu"
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          data-index-button=""
        >
          <MenuIcon className="size-5" aria-hidden="true" />
        </button>
        <Link to="/dashboard" className="lg:hidden" aria-label="Niveloft, today">
          <Logo />
        </Link>
        <div className="hidden min-w-0 flex-1 lg:block">{children}</div>
        <div className="ml-auto flex items-center gap-1">
          <ThemeSwitch />
          <button type="button" onClick={onOpenSearch} className="flex size-10 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-3 hover:text-ink lg:hidden" aria-label={`Search and commands (${PALETTE_SHORTCUT})`}>
            <Search className="size-[18px]" aria-hidden="true" />
          </button>
          <Link to="/inbox" className="relative flex size-10 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-3 hover:text-ink lg:hidden" aria-label={`Inbox, ${unread} unread`}>
            <Inbox className="size-[18px]" aria-hidden="true" />
            {unread > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-accent" aria-hidden="true" />}
          </Link>
        </div>
      </div>
      <ScrollProgress />
    </header>
  );
}

/** Light or dark, in one click (the account menu also offers "Match system"). */
function ThemeSwitch() {
  const dispatch = useAppDispatch();
  const theme = useAppSelector((s) => s.ui.theme);
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const dark = theme === 'dark' || (theme === 'system' && systemDark);
  return (
    <button
      type="button"
      onClick={() => dispatch(themeChanged(dark ? 'light' : 'dark'))}
      className="hidden size-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-3 hover:text-ink lg:flex"
      aria-label={dark ? 'Switch to the light theme' : 'Switch to the dark theme'}
      title={dark ? 'Light theme' : 'Dark theme'}
      data-theme-switch=""
    >
      {dark ? <Sun className="size-[17px]" aria-hidden="true" /> : <Moon className="size-[17px]" aria-hidden="true" />}
    </button>
  );
}
