/**
 * What analytics may see of a URL: the path with record ids replaced, and never the query string
 * or hash (emailed links carry one-time tokens there).
 *   /projects/12/tasks/34/review?x=1 → /projects/[id]/tasks/[id]/review
 */
export function redactPath(pathOrUrl: string): string {
  let path = pathOrUrl;
  try {
    path = new URL(pathOrUrl, 'https://x.invalid').pathname;
  } catch {
    path = pathOrUrl.split(/[?#]/)[0];
  }
  return path.replace(/\/\d+(?=\/|$)/g, '/[id]') || '/';
}

/** A title that names the kind of page, never a project or task ("Task", not "LIB-8 Fix login"). */
export function redactTitle(path: string): string {
  const p = redactPath(path);
  const map: [RegExp, string][] = [
    [/^\/$/, 'Front page'],
    [/^\/introduction$/, 'Introduction'],
    [/^\/(login|register|privacy|terms|forgot-password|reset-password|verify-email|check-email)$/, '$1'],
    [/^\/projects\/\[id\]\/tasks\/\[id\]\/review$/, 'Review workspace'],
    [/^\/projects\/\[id\]\/(board\/)?tasks\/\[id\]$/, 'Task'],
    [/^\/projects\/\[id\]\/?([a-z-]*)$/, 'Project $1'],
    [/^\/([a-z-]+)$/, '$1'],
  ];
  for (const [re, label] of map) if (re.test(p)) return p.replace(re, label).trim();
  return 'Page';
}
