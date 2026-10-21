import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Dialog } from '@/components/ui/Dialog';
import { cn } from '@/lib/cn';
import {
  GO_TO,
  GO_TO_PROJECT,
  MOD_KEY as MOD,
  NEW_TASK_EVENT,
  PALETTE_SHORTCUT,
  SEQUENCE_MS,
  SHORTCUTS_EVENT,
  belongsToFocus,
  goToTarget,
  overlayOpen,
  projectIn,
  stepFocus,
} from './shortcuts';

/** A key as it's printed on the keyboard. */
export function Key({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-line bg-surface px-1 font-sans text-[11px] leading-none font-medium text-ink-2 shadow-[0_1px_0_var(--line)]',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** "G then T": a two-key sequence, written the way you press it. */
export function Sequence({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted">
      {keys.map((k, i) => (
        <span key={k + i} className="inline-flex items-center gap-1">
          {i > 0 && <span aria-hidden="true">then</span>}
          <Key>{k.toUpperCase()}</Key>
        </span>
      ))}
    </span>
  );
}

/**
 * Listens for the keyboard layer anywhere in the app and owns the ? sheet. Quiet while you type,
 * while a dialog or menu is open, and when a modifier is held (those belong to the browser).
 */
export function KeyboardShortcuts() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const path = useRef(pathname);
  path.current = pathname;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let gAt = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (belongsToFocus(e.target) || overlayOpen()) return;
      if (e.key === '?') {
        e.preventDefault();
        setOpen(true);
        return;
      }
      const k = e.key.toLowerCase();
      if (gAt && Date.now() - gAt < SEQUENCE_MS) {
        gAt = 0;
        const to = goToTarget(k, path.current);
        if (to) {
          e.preventDefault();
          navigate(to);
        }
        return;
      }
      gAt = 0;
      if (e.shiftKey) return;
      if (k === 'g') {
        gAt = Date.now();
      } else if (k === 'c' && projectIn(path.current) !== null) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(NEW_TASK_EVENT));
      } else if (k === 'j' || k === 'k') {
        if (stepFocus(k === 'j' ? 1 : -1)) e.preventDefault();
      }
    };
    const show = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(SHORTCUTS_EVENT, show);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(SHORTCUTS_EVENT, show);
    };
  }, [navigate]);

  const inProject = projectIn(pathname) !== null;
  return (
    <Dialog open={open} onOpenChange={setOpen} title="Keyboard shortcuts" description="Letters work when you’re not typing in a field." size="lg">
      <div className="grid gap-x-10 gap-y-6 pt-1 sm:grid-cols-2" data-shortcut-sheet="">
        <ShortcutGroup title="Anywhere">
          <Row label="Search and commands" keys={<Key>{PALETTE_SHORTCUT}</Key>} />
          <Row label="Search" keys={<Key>/</Key>} />
          <Row label="Ask Flurry" keys={<Key>Alt A</Key>} />
          <Row label="This list" keys={<Key>?</Key>} />
          {GO_TO.map((g) => (
            <Row key={g.key} label={`Go to ${g.label}`} keys={<Sequence keys={['g', g.key]} />} />
          ))}
        </ShortcutGroup>
        <div className="space-y-6">
          <ShortcutGroup title={inProject ? 'In this project' : 'In a project'}>
            {GO_TO_PROJECT.map((g) => (
              <Row key={g.key} label={`Go to ${g.label}`} keys={<Sequence keys={['g', g.key]} />} />
            ))}
            <Row label="New task" keys={<Key>C</Key>} />
          </ShortcutGroup>
          <ShortcutGroup title="In lists">
            <Row
              label="Next and previous"
              keys={
                <span className="inline-flex gap-1">
                  <Key>J</Key>
                  <Key>K</Key>
                </span>
              }
            />
            <Row label="Open" keys={<Key>Enter</Key>} />
          </ShortcutGroup>
          <ShortcutGroup title="While writing">
            <Row label="Mention someone" keys={<Key>@</Key>} />
            <Row label="Link a task" keys={<Key>#</Key>} />
            <Row
              label="Bold, italic, code"
              keys={
                <span className="inline-flex gap-1">
                  <Key>{MOD} B</Key>
                  <Key>{MOD} I</Key>
                  <Key>{MOD} E</Key>
                </span>
              }
            />
            <Row label="Send" keys={<Key>{MOD} Enter</Key>} />
          </ShortcutGroup>
        </div>
      </div>
    </Dialog>
  );
}

function ShortcutGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[12.5px] font-medium text-muted">{title}</h3>
      <dl className="divide-y divide-line">{children}</dl>
    </section>
  );
}

function Row({ label, keys }: { label: string; keys: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-[13px]">
      <dt className="text-ink-2">{label}</dt>
      <dd className="shrink-0">{keys}</dd>
    </div>
  );
}
