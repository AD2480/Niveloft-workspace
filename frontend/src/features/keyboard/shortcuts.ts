/**
 * The keyboard layer. Two-key "go to" sequences (G, then a letter), single keys for the few
 * things people do all day, and J/K to walk a list. Kept as data so the same table drives the
 * key handling, the ? sheet and the hints in the command palette.
 */

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
/** The command palette's shortcut, as printed. */
export const PALETTE_SHORTCUT = isMac ? '⌘K' : 'Ctrl K';
/** The modifier for writing shortcuts, as printed. */
export const MOD_KEY = isMac ? '⌘' : 'Ctrl';

export interface GoTo {
  key: string;
  label: string;
  /** An app path, or (in a project) a path relative to the project. */
  to: string;
}

export const GO_TO: GoTo[] = [
  { key: 't', label: 'Today', to: '/dashboard' },
  { key: 'm', label: 'My work', to: '/my-tasks' },
  { key: 'i', label: 'Inbox', to: '/inbox' },
  { key: 'p', label: 'Projects', to: '/projects' },
  { key: 'c', label: 'Calendar', to: '/calendar' },
  { key: 'r', label: 'Reports', to: '/analytics' },
  { key: 's', label: 'Settings', to: '/settings' },
];

/** Inside a project, these letters go to its chapters instead (the others still work). */
export const GO_TO_PROJECT: GoTo[] = [
  { key: 'o', label: 'Overview', to: '' },
  { key: 'b', label: 'Board', to: 'board' },
  { key: 'l', label: 'List', to: 'tasks' },
  { key: 'd', label: 'Delivery', to: 'delivery' },
];

/** How long after G the second key still counts. */
export const SEQUENCE_MS = 1500;

/** The project a path is inside, if any. */
export function projectIn(path: string): number | null {
  const m = /^\/projects\/(\d+)(?:\/|$)/.exec(path);
  return m ? Number(m[1]) : null;
}

/** Where "G, then key" goes from this path (null when the key means nothing here). */
export function goToTarget(key: string, path: string): string | null {
  const k = key.toLowerCase();
  const project = projectIn(path);
  if (project !== null) {
    const chapter = GO_TO_PROJECT.find((g) => g.key === k);
    if (chapter) return `/projects/${project}${chapter.to ? `/${chapter.to}` : ''}`;
  }
  return GO_TO.find((g) => g.key === k)?.to ?? null;
}

/** Whether a key press belongs to whatever has focus (typing, a menu, a dialog), not to the page. */
export function belongsToFocus(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return true;
  return !!target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="application"], canvas');
}

/** Something modal is open (a dialog or a menu), so page shortcuts stay quiet. */
export function overlayOpen(doc: Document = document): boolean {
  return !!doc.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"], [role="menu"]');
}

/**
 * Moves focus to the next (1) or previous (-1) visible element marked data-kb-item, starting from
 * the first or last when focus isn't in the list yet. Returns the element focused, if any.
 */
export function stepFocus(dir: 1 | -1, doc: Document = document): HTMLElement | null {
  const items = [...doc.querySelectorAll<HTMLElement>('[data-kb-item]')].filter((el) => el.getClientRects().length > 0);
  if (!items.length) return null;
  const active = doc.activeElement;
  const at = items.findIndex((el) => el === active || (active instanceof Node && el.contains(active)));
  const next = at < 0 ? items[dir === 1 ? 0 : items.length - 1] : items[Math.min(items.length - 1, Math.max(0, at + dir))];
  next.focus();
  next.scrollIntoView({ block: 'nearest' });
  return next;
}

/** Fired on window when C is pressed in a project; the project page opens its New task dialog. */
export const NEW_TASK_EVENT = 'niveloft:new-task';

/** Fired on window to open the list of shortcuts (from the command palette). */
export const SHORTCUTS_EVENT = 'niveloft:shortcuts';
