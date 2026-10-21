/**
 * What the page needs to know before it downloads three.js: whether WebGL works, whether motion is
 * welcome, whether the graphics are slow, and when the theme changes. No three.js in here, so the
 * pages that show a 3D view can import it without pulling three.js into their first download.
 */

export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function isDarkTheme(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

/** Watches the <html> class (light/dark switch) and calls back on change. */
export function onThemeChange(callback: () => void): () => void {
  const observer = new MutationObserver(() => callback());
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

/** Slow or software-rendered graphics: fewer pixels, no shadows, and draw only when something changes. */
export function lowPowerGuess(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return true;
  if ((nav.hardwareConcurrency ?? 8) <= 2) return true;
  if ((nav.deviceMemory ?? 8) <= 2) return true;
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    const name = info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    if (/swiftshader|llvmpipe|software|basic render/i.test(name)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** Runs `fn` when the browser is idle (or soon, where it can't say). Returns a cancel function. */
export function whenIdle(fn: () => void, timeout = 900): () => void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(fn, { timeout });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(fn, 120);
  return () => window.clearTimeout(id);
}
