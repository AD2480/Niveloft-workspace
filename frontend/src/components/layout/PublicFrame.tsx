import * as RD from '@radix-ui/react-dialog';
import { ArrowRight, Menu as MenuIcon, MessageCircle, Moon, Search, Sun, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { useAppDispatch, useAppSelector } from '@/app/store';
import { themeChanged } from '@/app/uiSlice';
import { buttonClass } from '@/components/ui/buttonStyles';
import { openCookieSettings } from '@/features/consent/consent';
import { FloatingContact } from '@/features/contact/FloatingContact';
import { openContact } from '@/features/contact/contactStore';
import { cn } from '@/lib/cn';
import { PrintHeader } from '../PrintHeader';
import { BackToTop, ScrollProgress } from '../ScrollAids';
import { Logo } from './Logo';

// The search index (every FAQ answer) loads the first time someone searches.
const SiteSearchDialog = lazy(() => import('@/features/public/SiteSearchDialog').then((m) => ({ default: m.SiteSearchDialog })));

/** The public navigation (then Log in and Create workspace on the right). */
const NAV = [
  { to: '/#product', label: 'Product', blurb: 'The sample project, in the real interface' },
  { to: '/#how', label: 'Forecast', blurb: 'Change an assumption, watch it move' },
  { to: '/#roles', label: 'Views', blurb: 'What each role sees' },
  { to: '/flurry', label: 'Flurry', blurb: 'The AI assistant, and a sandbox to try it' },
];
/** More pages, in the phone menu and the footer. */
const MORE = [
  { to: '/introduction', label: 'Introduction', blurb: 'How Niveloft works, in nine short chapters' },
  { to: '/faq', label: 'Questions', blurb: 'Answers to common questions' },
];

function isActive(to: string, pathname: string, hash: string): boolean {
  if (to.startsWith('/#')) return pathname === '/' && hash === to.slice(1);
  return pathname === to;
}

/** The way in for someone without an account: sign up. */
function CreateWorkspaceLink({ className, onDone, label = 'Create workspace' }: { className?: string; onDone?: () => void; label?: string }) {
  const { pathname } = useLocation();
  return (
    <Link to="/register" onClick={onDone} aria-current={pathname === '/register' ? 'page' : undefined} className={className} data-create-workspace="">
      {label}
    </Link>
  );
}

/** "/" or ⌘K / Ctrl+K opens the site search (not while typing in a field). */
export function useSearchShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      const typing = t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        open();
      } else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}

/** Light ⇄ dark for visitors; the choice is remembered like the in-app setting. */
function ThemeToggle() {
  const dispatch = useAppDispatch();
  const theme = useAppSelector((s) => s.ui.theme);
  const dark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  return (
    <button
      type="button"
      onClick={() => dispatch(themeChanged(dark ? 'light' : 'dark'))}
      className="flex size-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-3/70 hover:text-ink"
      aria-label={dark ? 'Use the light theme' : 'Use the dark theme'}
      title={dark ? 'Light theme' : 'Dark theme'}
    >
      {dark ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
    </button>
  );
}

/**
 * The public masthead: front page, introduction, FAQ and the sign-in pages share it. It stays at
 * the top while scrolling (with a reading-progress line along its edge), has site search (/ or ⌘K),
 * and on phones folds its links into a menu.
 */
export function PublicHeader({ overlay = false }: { overlay?: boolean }) {
  const signedIn = useAppSelector((s) => s.auth.token !== null);
  const location = useLocation();
  const [searching, setSearching] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useSearchShortcut(() => setSearching(true));
  // A new page closes the menu.
  useEffect(() => setMenuOpen(false), [location.pathname, location.hash]);

  return (
    <header
      className={cn(
        'top-0 z-30 border-b border-line bg-canvas/88 backdrop-blur-md transition-[background-color,border-color,backdrop-filter] duration-300 supports-[backdrop-filter]:bg-canvas/72',
        overlay ? 'public-header--overlay fixed inset-x-0' : 'sticky',
      )}
      data-print="hide"
      data-scrolled="false"
      data-public-header=""
    >
      <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-3 px-4 sm:gap-4 sm:px-8">
        <Link to="/" className="flex shrink-0 items-center gap-2.5 rounded-md transition-opacity hover:opacity-75" aria-label="Niveloft, front page">
          <Logo />
        </Link>
        <nav aria-label="Public" className="ml-1 hidden items-center md:flex lg:ml-10 lg:gap-0.5">
          {NAV.map((item) => {
            const active = isActive(item.to, location.pathname, location.hash);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={cn('rounded-md px-2 py-2 text-[14px] font-medium transition-colors lg:px-3', active ? 'text-ink' : 'text-ink-2 hover:bg-surface-3/60 hover:text-ink')}
              >
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2 lg:gap-4">
          <button
            type="button"
            onClick={() => setSearching(true)}
            className="flex h-9 items-center gap-2 rounded-md px-2 text-muted transition-colors hover:bg-surface-3/60 hover:text-ink lg:border lg:border-line lg:bg-surface/60 lg:px-2.5"
            aria-label="Search this site (press /)"
            aria-haspopup="dialog"
            data-site-search-button=""
          >
            <Search className="size-4" aria-hidden="true" />
            <span className="hidden text-[13px] lg:inline">Search</span>
            <kbd className="hidden rounded-[5px] bg-surface-3 px-1.5 font-sans text-[11px] font-medium lg:inline" aria-hidden="true">
              /
            </kbd>
          </button>
          <ThemeToggle />
          {signedIn ? (
            <Link to="/dashboard" className={buttonClass('primary', 'md', 'hidden sm:inline-flex')}>
              Open Niveloft
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                aria-current={location.pathname === '/login' ? 'page' : undefined}
                className={cn('hidden rounded-md px-3 py-2 text-[14px] font-medium whitespace-nowrap transition-colors sm:inline-block', location.pathname === '/login' ? 'text-accent' : 'text-ink hover:bg-surface-3/60')}
              >
                Log in
              </Link>
              <CreateWorkspaceLink className={buttonClass('primary', 'md', 'hidden whitespace-nowrap sm:inline-flex')} />
            </>
          )}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="flex h-10 items-center gap-2 rounded-md px-2 text-ink transition-colors hover:bg-surface-3/60 md:hidden"
            aria-label="Open the menu"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            aria-controls="public-menu"
            data-public-menu-button=""
          >
            <MenuIcon className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>
      <ScrollProgress />
      <PublicMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        signedIn={signedIn}
        onSearch={() => {
          setMenuOpen(false);
          setSearching(true);
        }}
      />
      {searching && (
        <Suspense fallback={null}>
          <SiteSearchDialog open={searching} onOpenChange={setSearching} />
        </Suspense>
      )}
    </header>
  );
}

/** Phones: the public links, search, contact and sign-in in a panel from the right. */
function PublicMenu({ open, onOpenChange, signedIn, onSearch }: { open: boolean; onOpenChange: (o: boolean) => void; signedIn: boolean; onSearch: () => void }) {
  const location = useLocation();
  const close = () => onOpenChange(false);
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-black/40 animate-fade-in md:hidden" />
        <RD.Content
          id="public-menu"
          data-public-menu=""
          className="fixed inset-y-0 right-0 z-50 flex w-[min(22rem,100vw)] flex-col overflow-y-auto border-l border-line bg-canvas shadow-pop animate-slide-in-right focus:outline-none md:hidden"
        >
          <div className="flex h-16 items-center justify-between border-b border-line px-5">
            <RD.Title className="text-[13px] font-medium text-muted">Menu</RD.Title>
            <RD.Description className="sr-only">Pages, search, contact and your account</RD.Description>
            <RD.Close className="flex size-9 items-center justify-center rounded-md text-ink hover:bg-surface-2" aria-label="Close the menu">
              <X className="size-5" aria-hidden="true" />
            </RD.Close>
          </div>
          <nav aria-label="Menu" className="px-2 py-3">
            <ul>
              {[...NAV, ...MORE].map((item) => {
                const active = isActive(item.to, location.pathname, location.hash);
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      onClick={close}
                      aria-current={active ? 'page' : undefined}
                      className={cn('flex items-center justify-between gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-surface-2', active && 'bg-surface-2')}
                    >
                      <span>
                        <span className={cn('block font-wide text-[19px] font-semibold tracking-[-0.015em] [font-stretch:110%]', active ? 'text-accent' : 'text-ink')}>{item.label}</span>
                        <span className="mt-0.5 block text-[12.5px] text-muted">{item.blurb}</span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-muted" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="grid grid-cols-2 gap-2 border-t border-line px-5 py-4">
            <button type="button" onClick={onSearch} className={buttonClass('secondary', 'md')}>
              <Search aria-hidden="true" /> Search
            </button>
            <button
              type="button"
              onClick={() => {
                close();
                openContact();
              }}
              className={buttonClass('secondary', 'md')}
            >
              <MessageCircle aria-hidden="true" /> Contact
            </button>
          </div>
          <div className="mt-auto space-y-2 border-t border-line px-5 py-5">
            {signedIn ? (
              <Link to="/dashboard" onClick={close} className={buttonClass('primary', 'lg', 'w-full')}>
                Open Niveloft
              </Link>
            ) : (
              <>
                <CreateWorkspaceLink onDone={close} label="Create your workspace" className={buttonClass('primary', 'lg', 'w-full')} />
                <Link to="/login" onClick={close} className={buttonClass('secondary', 'lg', 'w-full')}>
                  Log in
                </Link>
              </>
            )}
            <div className="flex items-center justify-between pt-2 text-[13px] text-muted">
              <span>Theme</span>
              <ThemeToggle />
            </div>
          </div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

export function PublicFooter() {
  const year = new Date().getFullYear();
  const link = 'inline-block py-1 text-[13.5px] text-muted transition-colors hover:text-ink';
  const col = (title: string, items: ReactNode) => (
    <div>
      <p className="text-[13px] font-semibold text-ink">{title}</p>
      <ul className="mt-3 space-y-0.5">{items}</ul>
    </div>
  );
  return (
    <footer className="border-t border-line bg-surface dark:bg-surface/60" data-print="hide">
      <div className="mx-auto grid max-w-[1320px] gap-10 px-4 pt-16 pb-12 sm:px-8 md:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]">
        <div>
          <Logo />
          <p className="mt-5 max-w-xs text-[14px] leading-relaxed text-ink-2">A project workspace for small software and student teams.</p>
          <p className="mt-1 max-w-xs text-[14px] leading-relaxed text-muted">What will finish, when, and what’s in the way.</p>
        </div>
        {col(
          'Product',
          <>
            <li>
              <Link to="/#product" className={link}>
                Sample workspace
              </Link>
            </li>
            <li>
              <Link to="/#roles" className={link}>
                What each role sees
              </Link>
            </li>
            <li>
              <Link to="/#how" className={link}>
                How the forecast works
              </Link>
            </li>
            <li>
              <Link to="/flurry" className={link}>
                Meet Flurry
              </Link>
            </li>
          </>,
        )}
        {col(
          'Learn',
          <>
            <li>
              <Link to="/introduction" className={link}>
                Introduction
              </Link>
            </li>
            <li>
              <Link to="/faq" className={link}>
                Questions and answers
              </Link>
            </li>
            <li>
              <Link to="/introduction#roles" className={link}>
                Roles and permissions
              </Link>
            </li>
          </>,
        )}
        {col(
          'Account',
          <>
            <li>
              <Link to="/login" className={link}>
                Log in
              </Link>
            </li>
            <li>
              <Link to="/register" className={link}>
                Create your workspace
              </Link>
            </li>
            <li>
              <button type="button" onClick={() => openContact()} className={link}>
                Contact us
              </button>
            </li>
          </>,
        )}
        {col(
          'Legal',
          <>
            <li>
              <Link to="/privacy" className={link}>
                Privacy policy
              </Link>
            </li>
            <li>
              <Link to="/terms" className={link}>
                Terms and conditions
              </Link>
            </li>
            <li>
              <button type="button" onClick={openCookieSettings} className={link}>
                Cookie settings
              </button>
            </li>
          </>,
        )}
      </div>
      <div className="border-t border-line">
        {/* Room at the bottom for the floating Contact button, so it never covers these lines. */}
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-3 px-4 pt-5 pb-24 text-[12.5px] text-muted sm:px-8">
          <p>© {year} Niveloft (working name). A capstone project built with React, Spring Boot and MySQL.</p>
        </div>
      </div>
    </footer>
  );
}

/**
 * Frame for public pages: header, content, footer. Opens each page at the top, or at the section
 * named in the URL's #hash (the router doesn't scroll by itself).
 */
export function PublicPage({ children, footer = true, overlay = false }: { children: ReactNode; footer?: boolean; overlay?: boolean }) {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0);
      return;
    }
    const target = () => document.getElementById(decodeURIComponent(hash.slice(1)));
    const el = target();
    if (el) {
      el.scrollIntoView({ block: 'start' });
      return;
    }
    // The section may not have rendered yet; try again on the next frame.
    const raf = requestAnimationFrame(() => target()?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(raf);
  }, [pathname, hash]);
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <a
        href="#main"
        data-print="hide"
        className="sr-only z-[100] rounded-md bg-brand px-3 py-2 text-[13px] font-medium text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3 dark:text-canvas"
      >
        Skip to content
      </a>
      <PublicHeader overlay={overlay} />
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        <div className="mx-auto max-w-[1320px] px-4 sm:px-8">
          <PrintHeader />
        </div>
        {children}
      </main>
      {footer && <PublicFooter />}
      <BackToTop />
      <FloatingContact />
    </div>
  );
}
