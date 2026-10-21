import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canReadAloud, SERVER_VOICE_MAX, speak, stopSpeaking } from './voice';

/** A stand-in browser: speech synthesis, Audio and fetch that record what they were asked to do. */
interface Fake {
  spoken: string[];
  requests: { url: string; init: RequestInit }[];
  played: string[];
  reply: () => Promise<Response>;
  playFails: boolean;
}

const g = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};
let fake: Fake;
let urls: [typeof URL.createObjectURL, typeof URL.revokeObjectURL];

const settle = () => new Promise((r) => setTimeout(r, 5));

describe('reading answers aloud', () => {
  beforeEach(() => {
    for (const k of ['window', 'speechSynthesis', 'SpeechSynthesisUtterance', 'Audio', 'fetch']) saved[k] = g[k];
    fake = { spoken: [], requests: [], played: [], reply: async () => new Response(new Blob([new Uint8Array([73, 68, 51])]), { status: 200 }), playFails: false };
    g.window = globalThis;
    g.speechSynthesis = { cancel: () => {}, speak: (u: { text: string }) => fake.spoken.push(u.text) };
    g.SpeechSynthesisUtterance = class {
      lang = '';
      constructor(public text: string) {}
    };
    g.Audio = class {
      constructor(public src: string) {}
      play() {
        if (fake.playFails) return Promise.reject(new Error('NotAllowedError'));
        fake.played.push(this.src);
        return Promise.resolve();
      }
      pause() {}
      removeAttribute() {}
      addEventListener() {}
    };
    g.fetch = (url: string, init: RequestInit) => {
      fake.requests.push({ url, init });
      return fake.reply();
    };
    urls = [URL.createObjectURL, URL.revokeObjectURL];
    URL.createObjectURL = () => 'blob:voice';
    URL.revokeObjectURL = () => {};
    stopSpeaking();
  });

  afterEach(() => {
    stopSpeaking();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
    [URL.createObjectURL, URL.revokeObjectURL] = urls;
  });

  it('uses the browser’s voice when the server has none', async () => {
    speak('ONB-9 is late.', { serverVoice: null, token: 't' });
    await settle();
    expect(fake.spoken).toEqual(['ONB-9 is late.']);
    expect(fake.requests.length).toBe(0);
  });

  it('asks the server’s voice, signed in, and plays the audio it returns', async () => {
    const fallbacks: string[] = [];
    speak('ONB-9 is late.', { serverVoice: 'elevenlabs', token: 'tok', apiBase: '/api', onFallback: (w) => fallbacks.push(w) });
    await settle();
    expect(fake.requests.length).toBe(1);
    const { url, init } = fake.requests[0];
    expect(url).toBe('/api/ai/speech');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect('Idempotency-Key' in (init.headers as Record<string, string>)).toBe(false);
    expect(JSON.parse(String(init.body))).toEqual({ text: 'ONB-9 is late.' });
    expect(fake.played).toEqual(['blob:voice']);
    expect(fake.spoken.length).toBe(0);
    expect(fallbacks.length).toBe(0);
  });

  it('falls back to the browser’s voice with the server’s reason when it can’t', async () => {
    fake.reply = async () =>
      new Response(JSON.stringify({ error: { message: 'Today’s budget for the server voice is used up, so your browser’s voice reads answers until midnight.' } }), {
        status: 429,
      });
    const fallbacks: string[] = [];
    speak('Hello there.', { serverVoice: 'elevenlabs', token: 'tok', onFallback: (w) => fallbacks.push(w) });
    await settle();
    expect(fallbacks).toEqual(['Today’s budget for the server voice is used up, so your browser’s voice reads answers until midnight.']);
    expect(fake.spoken).toEqual(['Hello there.']);
    expect(fake.played.length).toBe(0);
  });

  it('falls back when the network fails or the browser won’t play the audio', async () => {
    fake.reply = () => Promise.reject(new TypeError('Failed to fetch'));
    const why: string[] = [];
    speak('One.', { serverVoice: 'elevenlabs', token: 'tok', onFallback: (w) => why.push(w) });
    await settle();
    fake.reply = async () => new Response(new Blob([new Uint8Array([1])]), { status: 200 });
    fake.playFails = true;
    speak('Two.', { serverVoice: 'elevenlabs', token: 'tok', onFallback: (w) => why.push(w) });
    await settle();
    expect(fake.spoken).toEqual(['One.', 'Two.']);
    expect(why.length).toBe(2);
    expect(why[1]).toMatch(/wouldn’t play/);
  });

  it('says nothing once stopped, even if the server answers later', async () => {
    let release: (r: Response) => void = () => {};
    fake.reply = () => new Promise<Response>((r) => (release = r));
    const why: string[] = [];
    speak('Too late.', { serverVoice: 'elevenlabs', token: 'tok', onFallback: (w) => why.push(w) });
    await settle();
    stopSpeaking();
    release(new Response(new Blob([new Uint8Array([1])]), { status: 200 }));
    await settle();
    expect(fake.played.length).toBe(0);
    expect(fake.spoken.length).toBe(0);
    expect(why.length).toBe(0);
  });

  it('never asks the server without a sign-in, and bounds what it sends', async () => {
    speak('No token.', { serverVoice: 'elevenlabs', token: null });
    await settle();
    expect(fake.requests.length).toBe(0);
    expect(fake.spoken).toEqual(['No token.']);
    speak('a'.repeat(SERVER_VOICE_MAX + 500), { serverVoice: 'elevenlabs', token: 'tok' });
    await settle();
    expect(JSON.parse(String(fake.requests[0].init.body)).text.length).toBe(SERVER_VOICE_MAX);
  });

  it('can read aloud with only the server’s voice', () => {
    g.speechSynthesis = undefined;
    delete g.speechSynthesis;
    expect(canReadAloud(null)).toBe(false);
    expect(canReadAloud('elevenlabs')).toBe(true);
  });
});
