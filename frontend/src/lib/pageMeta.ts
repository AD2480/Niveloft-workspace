import { useEffect } from 'react';
import { SITE_URL } from '@/config';
import { DEFAULT_DESCRIPTION, fullTitle, PUBLIC_PAGES, SITE_NAME, SOCIAL_IMAGE } from '@/seo/pages';

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

function setCanonical(href: string | null) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!href) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  el.href = href;
}

export interface PageMetaInput {
  /** The page's own title ("Privacy policy"); the site name is added. */
  title: string;
  description?: string;
  /** Canonical path for indexable pages. */
  path?: string;
  /** Keep this page out of search results (signed-in pages, emailed-link pages, 404). */
  noindex?: boolean;
}

/**
 * Sets the tab title, meta description, canonical link, robots and social-preview tags for the
 * current page. The public pages also get the same tags in static HTML at build time.
 */
export function usePageMeta({ title, description, path, noindex = false }: PageMetaInput) {
  useEffect(() => {
    const known = path ? PUBLIC_PAGES.find((p) => p.path === path) : undefined;
    const t = known ? fullTitle(known) : `${title} · ${SITE_NAME}`;
    const d = description ?? known?.description ?? DEFAULT_DESCRIPTION;
    document.title = t;
    setMeta('name', 'description', d);
    setMeta('name', 'robots', noindex ? 'noindex, nofollow' : 'index, follow');
    setMeta('property', 'og:title', t);
    setMeta('property', 'og:description', d);
    setMeta('name', 'twitter:title', t);
    setMeta('name', 'twitter:description', d);
    const url = path && !noindex ? `${SITE_URL}${path === '/' ? '/' : path}` : null;
    setCanonical(url);
    if (url) setMeta('property', 'og:url', url);
    setMeta('property', 'og:image', `${SITE_URL}${SOCIAL_IMAGE.path}`);
  }, [title, description, path, noindex]);
}
