import * as RD from '@radix-ui/react-dialog';
import {
  BarChart3,
  CalendarDays,
  CheckSquare,
  CornerDownLeft,
  FolderKanban,
  FolderPlus,
  HeartPulse,
  HelpCircle,
  Inbox,
  Keyboard,
  LayoutDashboard,
  MessageCircle,
  Moon,
  Search,
  Settings,
  Sparkles,
  Sun,
  Swords,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useSearchQuery } from '@/api/endpoints';
import type { SearchHit } from '@/api/types';
import { useAppDispatch, useAppSelector } from '@/app/store';
import { themeChanged } from '@/app/uiSlice';
import { StatusBadge } from '@/components/domain';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { useOptionalAssistant } from '@/features/assistant/assistantContext';
import { openContact } from '@/features/contact/contactStore';
import { searchSite } from '@/features/public/siteSearch';
import { useDebouncedValue } from '@/lib/hooks';
import { Sequence } from '@/features/keyboard/KeyboardShortcuts';
import { GO_TO, GO_TO_PROJECT, PALETTE_SHORTCUT, SHORTCUTS_EVENT } from '@/features/keyboard/shortcuts';

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon?: LucideIcon;
  color?: string;
  hit?: SearchHit;
  /** A keyboard sequence that does the same (shown on the right). */
  keys?: string[];
  run: () => void;
}

export { PALETTE_SHORTCUT };

/**
 * ⌘K / Ctrl+K command palette: jump to a page, run a command, or find any project or task
 * you can access (server-side search, so it never shows records you couldn't open).
 * Keyboard: ↑/↓ to move, Enter to open, Esc to close.
 */
export function CommandPalette({ open, onOpenChange, onNewProject }: { open: boolean; onOpenChange: (open: boolean) => void; onNewProject: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const assistant = useOptionalAssistant();
  const operator = useAppSelector((s) => s.auth.user?.operator ?? false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const debounced = useDebouncedValue(query.trim(), 180);
  const searching = debounced.length >= 2;
  // currentData: results for *this* query only, so Enter never opens a hit for older text.
  const { currentData: data, isFetching } = useSearchQuery(debounced, { skip: !open || !searching });
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const go = (to: string) => () => {
    onOpenChange(false);
    navigate(to);
  };

  /** "G then …" for a page that has a sequence. */
  const goKeys = (to: string) => {
    const g = GO_TO.find((x) => x.to === to);
    return g ? ['g', g.key] : undefined;
  };

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      { id: 'nav-dashboard', group: 'Go to', label: 'Today', icon: LayoutDashboard, keys: goKeys('/dashboard'), run: go('/dashboard') },
      { id: 'nav-my-tasks', group: 'Go to', label: 'My work', icon: CheckSquare, keys: goKeys('/my-tasks'), run: go('/my-tasks') },
      { id: 'nav-projects', group: 'Go to', label: 'Projects', icon: FolderKanban, keys: goKeys('/projects'), run: go('/projects') },
      { id: 'nav-inbox', group: 'Go to', label: 'Inbox', icon: Inbox, keys: goKeys('/inbox'), run: go('/inbox') },
      { id: 'nav-calendar', group: 'Go to', label: 'Calendar', icon: CalendarDays, keys: goKeys('/calendar'), run: go('/calendar') },
      { id: 'nav-analytics', group: 'Go to', label: 'Reports', icon: BarChart3, keys: goKeys('/analytics'), run: go('/analytics') },
      { id: 'nav-arena', group: 'Go to', label: 'AI arena', icon: Swords, run: go('/arena') },
      ...(operator ? [{ id: 'nav-site-health', group: 'Go to', label: 'Site health', icon: HeartPulse, run: go('/site-health') }] : []),
      { id: 'nav-settings', group: 'Go to', label: 'Settings', icon: Settings, keys: goKeys('/settings'), run: go('/settings') },
      { id: 'nav-faq', group: 'Go to', label: 'Help and FAQ', icon: HelpCircle, run: go('/faq') },
      {
        id: 'cmd-contact',
        group: 'Actions',
        label: 'Contact the people who run this site',
        icon: MessageCircle,
        run: () => {
          onOpenChange(false);
          openContact();
        },
      },
      ...(assistant
        ? [
            {
              id: 'cmd-assistant',
              group: 'Actions',
              label: 'Ask Flurry, the AI assistant (Alt+A)',
              icon: Sparkles,
              run: () => {
                onOpenChange(false);
                assistant.setOpen(true);
              },
            },
            ...(['Plan a project', 'Summarise progress', 'Review blockers'] as const).map((ask) => ({
              id: `cmd-flurry-${ask.split(' ')[0].toLowerCase()}`,
              group: 'Actions',
              label: `Flurry: ${ask.toLowerCase()}`,
              icon: Sparkles,
              run: () => {
                onOpenChange(false);
                assistant.submit(ask, 'typed');
              },
            })),
          ]
        : []),
      {
        id: 'cmd-shortcuts',
        group: 'Actions',
        label: 'Keyboard shortcuts',
        icon: Keyboard,
        keys: ['?'],
        run: () => {
          onOpenChange(false);
          window.dispatchEvent(new CustomEvent(SHORTCUTS_EVENT));
        },
      },
      {
        id: 'cmd-new-project',
        group: 'Actions',
        label: 'Create a project',
        icon: FolderPlus,
        run: () => {
          onOpenChange(false);
          onNewProject();
        },
      },
      { id: 'cmd-light', group: 'Actions', label: 'Use light theme', icon: Sun, run: () => {
          dispatch(themeChanged('light'));
          onOpenChange(false);
        } },
      { id: 'cmd-dark', group: 'Actions', label: 'Use dark theme', icon: Moon, run: () => {
          dispatch(themeChanged('dark'));
          onOpenChange(false);
        } },
    ];
    // Inside a project, its chapters are one keystroke away too.
    const inProject = /^\/projects\/(\d+)/.exec(location.pathname);
    if (inProject) {
      const p = `/projects/${inProject[1]}`;
      const here: [string, string, string][] = [
        ['board', 'Board', `${p}/board`],
        ['delivery', 'Delivery outlook', `${p}/delivery`],
        ['model', '3D model and replay', `${p}/model`],
        ['timeline', 'Timeline', `${p}/timeline`],
        ['deps', 'Dependencies', `${p}/map`],
        ['plan', 'What if (planning)', `${p}/plan`],
        ['analytics', 'Project analytics', `${p}/analytics`],
      ];
      const chapterKeys = (to: string) => {
        const g = GO_TO_PROJECT.find((x) => `${p}/${x.to}` === to);
        return g ? ['g', g.key] : undefined;
      };
      base.unshift(...here.map(([id, label, to]) => ({ id: `here-${id}`, group: 'This project', label, icon: FolderKanban, keys: chapterKeys(to), run: go(to) })));
    }
    const q = query.trim().toLowerCase();
    const matching = q ? base.filter((c) => c.label.toLowerCase().includes(q)) : base;
    // Help: answers from the FAQ, the introduction and the policies, found in the browser.
    const help: Command[] = q.length >= 2
      ? searchSite(q, 4).map(({ entry }) => ({ id: `help-${entry.id}`, group: 'Help', label: entry.title, hint: entry.where, icon: HelpCircle, run: go(entry.to) }))
      : [];
    if (!searching || !data) return [...matching, ...help];
    const hits = [...data.projects, ...data.tasks].map<Command>((h) => ({
      id: `${h.type}-${h.id}`,
      group: h.type === 'PROJECT' ? 'Projects' : 'Tasks',
      label: h.title,
      hint: h.type === 'TASK' ? h.key : h.subtitle,
      color: h.color,
      hit: h,
      run: go(h.link),
    }));
    return [...hits, ...matching, ...help];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searching, data, location.pathname, operator]);

  useEffect(() => setActive(0), [commands.length, debounced]);

  // Keep the active option in view.
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, commands.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commands[active]?.run();
    }
  };

  const groups: { name: string; items: { c: Command; index: number }[] }[] = [];
  commands.forEach((c, index) => {
    const g = groups.find((x) => x.name === c.group) ?? groups[groups.push({ name: c.group, items: [] }) - 1];
    g.items.push({ c, index });
  });

  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-black/35 animate-fade-in" />
        <RD.Content
          className="fixed top-[12vh] left-1/2 z-50 flex max-h-[70vh] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 flex-col border border-line bg-surface shadow-pop animate-pop-in focus:outline-none"
          aria-describedby={undefined}
        >
          <RD.Title className="sr-only">Search and commands</RD.Title>
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search className="size-4 shrink-0 text-muted" aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search tasks and projects, or type a command…"
              aria-label="Search tasks, projects, help and commands"
              className="h-14 flex-1 bg-transparent text-[15px] font-normal text-ink placeholder:text-subtle focus:outline-none"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={commands[active] ? `${listId}-${commands[active].id}` : undefined}
              aria-autocomplete="list"
            />
            {isFetching && <Spinner className="size-4 text-muted" />}
            <kbd className="hidden rounded border border-line px-1.5 py-0.5 text-[11px] text-muted sm:inline">Esc</kbd>
          </div>

          <div ref={listRef} id={listId} role="listbox" aria-label="Results" className="scrollbar-thin flex-1 overflow-y-auto py-2">
            {searching && data && data.projects.length === 0 && data.tasks.length === 0 && (
              <p className="px-4 py-3 text-[13px] text-muted">
                No tasks or projects match “{debounced}”. Only projects you’re a member of are searched; help answers are listed below when they match.
              </p>
            )}
            {groups.map((g) => (
              <div key={g.name} role="group" aria-label={g.name} className="pb-1">
                <p className="caps px-4 pt-3 pb-1.5 text-[11px] text-muted">{g.name}</p>
                {g.items.map(({ c, index }) => {
                  const Icon = c.icon;
                  return (
                    <div
                      key={c.id}
                      id={`${listId}-${c.id}`}
                      role="option"
                      aria-selected={index === active}
                      data-index={index}
                      onMouseMove={() => setActive(index)}
                      onClick={c.run}
                      className={cn('mx-2 flex cursor-pointer items-center gap-3 px-2.5 py-2 text-[13.5px]', index === active ? 'bg-surface-2 text-ink' : 'text-ink-2')}
                    >
                      {Icon ? (
                        <Icon className="size-4 shrink-0 text-muted" aria-hidden="true" />
                      ) : (
                        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: c.color }} aria-hidden="true" />
                      )}
                      {c.hit?.type === 'TASK' && <span className="shrink-0 font-mono text-xs text-muted">{c.hint}</span>}
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      {c.hit?.type === 'TASK' && c.hit.status && <StatusBadge status={c.hit.status} />}
                      {c.hit?.type === 'PROJECT' && <span className="text-xs text-muted capitalize">{c.hint}</span>}
                      {c.group === 'Help' && c.hint && <span className="hidden shrink-0 text-xs text-muted sm:inline">{c.hint}</span>}
                      {c.keys && (
                        <span className="hidden shrink-0 sm:inline-flex">
                          <Sequence keys={c.keys} />
                        </span>
                      )}
                      {index === active && <CornerDownLeft className="size-3.5 shrink-0 text-muted" aria-hidden="true" />}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[12px] text-muted">
            <span>↑↓ move</span>
            <span>↵ open</span>
            <span className="ml-auto">{searching ? 'Searching your projects' : 'Type 2+ characters to search'}</span>
          </div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
