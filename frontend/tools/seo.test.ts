import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLIC_PAGES } from '../src/seo/pages';
import { buildProblems, excludeTestApi, usesTestApi, findPreloads, findSecrets, launchFiles, resolveSiteUrl, robotsTxt, securityTxt, sitemapXml, withTags, type BuiltFile } from './seo';

const INDEX = '<html><head>\n    <!-- seo:start -->\n    <!-- seo:end -->\n</head><body></body></html>';

describe('launch files', () => {
  it('writes one page per public route with its own title, description and canonical link', () => {
    const files = launchFiles(INDEX, 'https://pf.example', '2026-09-27');
    for (const page of PUBLIC_PAGES) expect(files[page.file]).toContain(`<link rel="canonical" href="https://pf.example${page.path}" />`);
    expect(files['privacy.html']).toContain('<title>Privacy policy · Niveloft</title>');
    expect(files['privacy.html']).toContain('property="og:image" content="https://pf.example/og-image.png"');
    expect(files['app.html']).toContain('noindex, nofollow');
    expect(files['app.html']).not.toContain('rel="canonical"');
    expect(files['404.html']).toContain('Page not found');
  });

  it('lists public pages in the sitemap and keeps app pages out of robots', () => {
    const map = sitemapXml('https://pf.example', '2026-09-27');
    expect(map).toContain('<loc>https://pf.example/terms</loc>');
    expect(map).not.toContain('/dashboard');
    const robots = robotsTxt('https://pf.example');
    expect(robots).toContain('Disallow: /projects');
    expect(robots).toContain('Disallow: /reset-password');
    expect(robots).toContain('Sitemap: https://pf.example/sitemap.xml');
  });

  it('escapes and needs the markers', () => {
    expect(() => withTags('<html></html>', 'x')).toThrow(/markers/);
    expect(launchFiles(INDEX, '', '2026-09-27')['sitemap.xml']).toBeUndefined();
  });

  it('finds the site address from VITE_SITE_URL or Vercel', () => {
    expect(resolveSiteUrl({ VITE_SITE_URL: 'https://a.example/' })).toBe('https://a.example');
    expect(resolveSiteUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'pf.vercel.app' })).toBe('https://pf.vercel.app');
    expect(resolveSiteUrl({})).toBe('');
  });

  it('refuses secrets in the bundle', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-secrets-'));
    fs.writeFileSync(path.join(dir, 'a.js'), 'const k = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123";');
    fs.writeFileSync(path.join(dir, 'b.js'), 'const p = "Password@123";');
    expect(findSecrets(dir, false)).toEqual(['a.js contains an Anthropic API key']);
    expect(findSecrets(dir, true)).toHaveLength(2);
  });

  it('preloads each page’s own module and the one font, so they download at once', () => {
    const bundle: Record<string, BuiltFile> = {
      'assets/index-a.js': { type: 'chunk', fileName: 'assets/index-a.js', facadeModuleId: '/x/frontend/index.html', imports: [] },
      'assets/LegalPages-b.js': { type: 'chunk', fileName: 'assets/LegalPages-b.js', facadeModuleId: '/x/frontend/src/pages/public/LegalPages.tsx', imports: ['assets/shared-c.js'], viteMetadata: { importedCss: new Set(['assets/legal.css']) } },
      'assets/shared-c.js': { type: 'chunk', fileName: 'assets/shared-c.js', facadeModuleId: null, imports: ['assets/index-a.js'] },
      'assets/geist-latin-wght-normal-Dx4.woff2': { type: 'asset', fileName: 'assets/geist-latin-wght-normal-Dx4.woff2' },
      'assets/inter-cyrillic-wght-normal-Q.woff2': { type: 'asset', fileName: 'assets/inter-cyrillic-wght-normal-Q.woff2' },
      'assets/other-latin-wght-normal-Z9.woff2': { type: 'asset', fileName: 'assets/other-latin-wght-normal-Z9.woff2' },
      'assets/ibm-plex-mono-latin-400-normal-M1.woff2': { type: 'asset', fileName: 'assets/ibm-plex-mono-latin-400-normal-M1.woff2' },
    };
    const pre = findPreloads(bundle);
    expect(pre.fonts).toEqual(['assets/geist-latin-wght-normal-Dx4.woff2']);
    expect(pre.pages['/privacy']).toEqual({ js: ['assets/LegalPages-b.js', 'assets/shared-c.js', 'assets/index-a.js'], css: ['assets/legal.css'] });
    const index = INDEX.replace('</head>', '<script type="module" crossorigin src="/assets/index-a.js"></script></head>');
    const files = launchFiles(index, 'https://pf.example', '2026-09-27', pre);
    expect(files['privacy.html']).toContain('<link rel="modulepreload" crossorigin href="/assets/LegalPages-b.js" />');
    expect(files['privacy.html']).not.toContain('modulepreload" crossorigin href="/assets/index-a.js"');
    expect(files['privacy.html']).toContain('<link rel="stylesheet" href="/assets/legal.css" />');
    expect(files['app.html']).not.toContain('rel="preload"');
    expect(files['login.html']).not.toContain('modulepreload');
  });
});

describe('production build checks', () => {
  it('always uses the real API: a production build needs its address and refuses the tests’ in-browser API', () => {
    expect(buildProblems({}, 'production').errors[0]).toMatch(/Set VITE_API_BASE_URL/);
    const testApi = buildProblems({ VITE_TEST_API: 'browser', VITE_API_BASE_URL: 'https://api.example.com/api', VITE_CONTACT_EMAIL: 'a@b.co' }, 'production');
    expect(testApi.errors).toHaveLength(1);
    expect(testApi.errors[0]).toMatch(/VITE_TEST_API runs the app against the automated tests’ in-browser stand-in/);
    expect([usesTestApi({ VITE_TEST_API: 'browser' }), usesTestApi({}), usesTestApi({ VITE_TEST_API: 'true' })]).toEqual([true, false, false]);
    expect(buildProblems({ VITE_API_BASE_URL: 'https://api.example.com/api', VITE_SECURITY_CONTACT: 'security@example.com' }, 'production')).toEqual({ errors: [], warnings: [] });
    expect(buildProblems({}, 'development').errors).toEqual([]);
  });

  it('refuses the retired demo, and warns about its leftover settings', () => {
    const demo = buildProblems({ VITE_USE_MOCK_API: 'true', VITE_API_BASE_URL: 'https://api.example.com/api', VITE_CONTACT_EMAIL: 'a@b.co' }, 'production');
    expect(demo.errors).toHaveLength(1);
    expect(demo.errors[0]).toMatch(/browser-only demo, which was removed/);
    const leftovers = buildProblems({ VITE_USE_MOCK_API: 'false', VITE_SHOW_SAMPLE_ACCOUNTS: 'true', VITE_API_BASE_URL: 'https://api.example.com/api', VITE_CONTACT_EMAIL: 'a@b.co' }, 'production');
    expect(leftovers.errors).toEqual([]);
    expect(leftovers.warnings).toHaveLength(2);
    expect(leftovers.warnings.join(' ')).toMatch(/VITE_USE_MOCK_API is no longer used.*VITE_SHOW_SAMPLE_ACCOUNTS is no longer used/);
    expect(buildProblems({ VITE_USE_MOCK_API: 'true' }, 'development').warnings[0]).toMatch(/VITE_USE_MOCK_API is no longer used/);
  });

  it('leaves the tests’ in-browser API and its sample password out of every build but a test build', () => {
    type Hook = (this: unknown, id: string) => unknown;
    const plugin = (env: Record<string, string>) => excludeTestApi(env) as unknown as { apply: string; resolveId: Hook; load: Hook };
    const real = plugin({ VITE_API_BASE_URL: 'https://api.example.com/api' });
    expect(real.apply).toBe('build');
    const stub = real.resolveId.call(null, '@/mock/server') as string;
    expect(stub).toBeTruthy();
    expect(real.resolveId.call(null, '../mock/store')).toBe(stub);
    expect(real.resolveId.call(null, '@/mock/demoAccounts')).toBe(stub);
    expect(real.resolveId.call(null, '@/lib/aiPrompt')).toBeNull();
    const code = real.load.call(null, stub) as string;
    expect(code).toContain('export const handleMockRequest');
    expect(code).not.toContain('Password@123');
    expect(code).toContain('export const DEMO_PASSWORD = "";');
    expect(plugin({ VITE_TEST_API: 'browser' }).resolveId.call(null, '@/mock/server')).toBeNull();
  });

  it('warns about a relative API address and refuses plain HTTP', () => {
    const relative = buildProblems({ VITE_API_BASE_URL: '/api' }, 'production');
    expect(relative.errors).toEqual([]);
    expect(relative.warnings.join(' ')).toMatch(/VITE_API_BASE_URL is “\/api”/);
    expect(relative.warnings.join(' ')).toMatch(/security\.txt/);
    expect(buildProblems({ VITE_API_BASE_URL: 'http://api.example.com/api' }, 'production').errors[0]).toMatch(/must use https:\/\//);
    expect(buildProblems({ VITE_API_BASE_URL: 'http://localhost:8080/api', VITE_CONTACT_EMAIL: 'a@b.co' }, 'production').errors).toEqual([]);
    expect(buildProblems({ VITE_API_BASE_URL: 'http://localhost.evil.example/api' }, 'production').errors[0]).toMatch(/must use https:\/\//);
  });

  it('publishes security.txt with a contact, an expiry a year out and the canonical address', () => {
    const txt = securityTxt({ VITE_SECURITY_CONTACT: 'security@example.com' }, 'https://app.example.com', new Date('2026-10-14T00:00:00Z'))!;
    expect(txt).toContain('Contact: mailto:security@example.com');
    expect(txt).toContain('Expires: 2027-10-14T00:00:00.000Z');
    expect(txt).toContain('Canonical: https://app.example.com/.well-known/security.txt');
    expect(securityTxt({ VITE_CONTACT_EMAIL: 'https://example.com/report' }, '')).toContain('Contact: https://example.com/report');
    expect(securityTxt({}, 'https://app.example.com')).toBeNull();
  });

  it('finds more kinds of keys in a bundle', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-keys-'));
    fs.writeFileSync(path.join(dir, 'a.js'), `const k = "sk-proj-${'a'.repeat(40)}"; const g = "gsk_${'b'.repeat(48)}";`);
    const hits = findSecrets(dir, false);
    expect(hits.join(' ')).toMatch(/OpenAI/);
    expect(hits.join(' ')).toMatch(/Groq/);
  });
});
