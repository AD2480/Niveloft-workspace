/**
 * Titles and descriptions of the public pages. Used in the browser (the page's <title>, meta
 * description, canonical link and social-preview tags) and at build time, to write a static HTML
 * file per page with the same tags (link previews and search engines don't run JavaScript), plus
 * the sitemap and robots.txt. No imports: vite.config.ts loads this file too.
 */

export const SITE_NAME = 'Niveloft';

export interface PageMeta {
  /** URL path, e.g. "/privacy". */
  path: string;
  /** Written into dist/<file>. The front page is index.html. */
  file: string;
  /** The page's own title; the site name is added after it (not on the front page). */
  title: string;
  description: string;
  /** Listed in sitemap.xml. */
  sitemap: boolean;
  /** The lazily loaded module that renders the page; its files are preloaded in the page's HTML. */
  module?: string;
  priority?: number;
}

export const DEFAULT_DESCRIPTION =
  'Niveloft shows what will finish, when, and what’s in the way. A project workspace for small software and student teams: tasks with owners and reviews, and a delivery forecast with its uncertainty. With Flurry, an AI assistant that asks before it changes anything.';

export const PUBLIC_PAGES: PageMeta[] = [
  {
    path: '/',
    module: 'src/pages/public/HomePage.tsx',
    file: 'index.html',
    title: 'Niveloft: see what will finish, when, and what’s in the way',
    description: DEFAULT_DESCRIPTION,
    sitemap: true,
    priority: 1,
  },
  {
    path: '/introduction',
    module: 'src/pages/public/IntroductionPage.tsx',
    file: 'introduction.html',
    title: 'Introduction',
    description:
      'How Niveloft works in nine short chapters: roles, the life of a task, reviews with evidence, the 3D model and forecast, and what Flurry, the AI assistant, can and can’t do.',
    sitemap: true,
    priority: 0.8,
  },
  {
    path: '/flurry',
    module: 'src/pages/public/FlurryPage.tsx',
    file: 'flurry.html',
    title: 'Meet Flurry',
    description:
      'Flurry is Niveloft’s AI project assistant: a small snow creature that floats at the edge of your workspace, shows you your next task and what holds a milestone up, and never changes anything without asking. Try it in a sandbox.',
    sitemap: true,
    priority: 0.7,
  },
  {
    path: '/faq',
    module: 'src/pages/public/FaqPage.tsx',
    file: 'faq.html',
    title: 'Questions and answers',
    description:
      'Answers about Niveloft: roles and permissions, why tasks need a review to be done, predictions, Flurry and the Arena, your account and your data.',
    sitemap: true,
    priority: 0.7,
  },
  {
    path: '/register',
    file: 'register.html',
    title: 'Create your workspace',
    description: 'Create your Niveloft workspace: plan projects with your team, give every task an owner, and see what comes next.',
    sitemap: true,
    priority: 0.7,
  },
  {
    path: '/login',
    file: 'login.html',
    title: 'Log in',
    description: 'Log in to Niveloft to continue to your projects.',
    sitemap: true,
    priority: 0.4,
  },
  {
    path: '/privacy',
    module: 'src/pages/public/LegalPages.tsx',
    file: 'privacy.html',
    title: 'Privacy policy',
    description: 'What Niveloft collects, why, where it is kept, who can see it, and how to see, change or delete your data.',
    sitemap: true,
    priority: 0.3,
  },
  {
    path: '/terms',
    module: 'src/pages/public/LegalPages.tsx',
    file: 'terms.html',
    title: 'Terms and conditions',
    description: 'The terms for using Niveloft: your account, your content, acceptable use, and the limits of the service.',
    sitemap: true,
    priority: 0.3,
  },
];

/** Pages behind sign-in: never indexed, disallowed in robots.txt. */
export const APP_PATHS = ['/dashboard', '/my-tasks', '/projects', '/inbox', '/calendar', '/analytics', '/arena', '/site-health', '/settings'];

/** Account pages reached from emails or forms: usable, but not indexed. */
export const UTILITY_PATHS = ['/check-email', '/verify-email', '/forgot-password', '/reset-password'];

export const SOCIAL_IMAGE = { path: '/og-image.png', width: 1200, height: 630, alt: 'Niveloft: a sample project drawn as a cut-away block of snow in four coloured layers, with one late task marked in red, beside the words “See what will finish, when, and what’s in the way.”' };

export function fullTitle(page: Pick<PageMeta, 'path' | 'title'>): string {
  return page.path === '/' ? page.title : `${page.title} · ${SITE_NAME}`;
}
