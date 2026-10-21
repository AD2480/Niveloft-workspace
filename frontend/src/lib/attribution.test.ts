import { afterEach, describe, expect, it } from 'vitest';
import { campaignQuery, cleanTag, readAttribution, setAttributionForTesting, withoutUtm } from './attribution';

afterEach(() => setAttributionForTesting(null));

describe('UTM tracking', () => {
  it('reads the campaign tags of the first page', () => {
    const a = readAttribution('https://pf.example/faq?utm_source=newsletter&utm_medium=email&utm_campaign=launch&x=1', '', 'pf.example');
    expect(a).toEqual({ source: 'newsletter', medium: 'email', campaign: 'launch', term: null, content: null, referrer: null, landingPath: '/faq' });
  });

  it('counts another site as a referral, and this site as nothing', () => {
    expect(readAttribution('https://pf.example/', 'https://news.example.org/post/1', 'pf.example')).toMatchObject({ source: 'news.example.org', medium: 'referral', referrer: 'news.example.org' });
    expect(readAttribution('https://pf.example/', 'https://pf.example/faq', 'pf.example')).toBeNull();
    expect(readAttribution('https://pf.example/', '', 'pf.example')).toBeNull();
  });

  it('keeps tags short, printable and on one line', () => {
    expect(cleanTag('  a\u0000b <script>  ')).toBe('ab script');
    expect(cleanTag('x'.repeat(300))?.length).toBe(100);
    expect(cleanTag('   ')).toBeNull();
  });

  it('takes the tags out of the address, keeping everything else', () => {
    expect(withoutUtm('https://pf.example/faq?utm_source=a&utm_medium=b&page=2#roles')).toBe('/faq?page=2#roles');
    expect(withoutUtm('https://pf.example/?utm_campaign=x')).toBe('/');
  });

  it('gives analytics the campaign once, but not plain referrals', () => {
    setAttributionForTesting({ source: 'newsletter', medium: 'email', campaign: 'launch', term: null, content: null, referrer: null, landingPath: '/' });
    expect(campaignQuery()).toBe('?utm_source=newsletter&utm_medium=email&utm_campaign=launch');
    setAttributionForTesting({ source: 'news.example.org', medium: 'referral', campaign: null, term: null, content: null, referrer: 'news.example.org', landingPath: '/' });
    expect(campaignQuery()).toBe('');
  });
});
