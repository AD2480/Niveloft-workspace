/**
 * Printing: the print stylesheet (index.css, @media print) hides navigation and floating buttons
 * and prints in light colours. This opens every closed <details> (FAQ answers, "how it works"
 * notes) just before printing, so printed pages don't lose their contents, and closes them again
 * afterwards. It also tells subscribers when printing starts, so the print header can show the
 * page's current title and address.
 */

const opened = new Set<HTMLDetailsElement>();
const listeners = new Set<() => void>();
let printedAt: Date | null = null;

export function onBeforePrint(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function lastPrintedAt(): Date | null {
  return printedAt;
}

function before() {
  printedAt = new Date();
  document.querySelectorAll<HTMLDetailsElement>('details:not([open])').forEach((d) => {
    if (d.closest('[data-print="hide"]')) return;
    d.open = true;
    opened.add(d);
  });
  listeners.forEach((l) => l());
}

function after() {
  opened.forEach((d) => {
    d.open = false;
  });
  opened.clear();
}

let installed = false;

export function installPrintSupport(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('beforeprint', before);
  window.addEventListener('afterprint', after);
}

/** For tests. */
export function simulatePrint(): () => void {
  before();
  return after;
}
