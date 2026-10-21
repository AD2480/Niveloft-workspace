/**
 * Voice for the assistant, using the browser's own speech recognition (Chrome, Edge, Safari) and
 * speech synthesis. Niveloft never receives audio, only the text the browser transcribes. When the
 * server has a natural voice set up (ElevenLabs), answers are read by it instead: the answer's text
 * goes to Niveloft's server, which asks ElevenLabs with its own key and returns the audio.
 *
 * Two ways to listen, never at the same time (browsers allow one recognition at a time):
 * - `listenOnce`: push-to-talk for one command, with interim text while speaking;
 * - wake mode: listens continuously for "Hey Flurry" while the tab is visible, and only when
 *   the person has turned it on. It pauses during `listenOnce` and resumes afterwards.
 */

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: RecognitionAlternative;
}
interface RecognitionEvent {
  resultIndex: number;
  results: { readonly length: number; [index: number]: RecognitionResult };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const voiceInputSupported = (): boolean => recognitionCtor() !== null;
export const voiceOutputSupported = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

/** Plain-language messages for the browser's recognition errors. */
export function voiceErrorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access is blocked. Allow it for this site in the browser’s address bar, then try again.';
    case 'audio-capture':
      return 'No microphone was found.';
    case 'network':
      return 'The browser’s speech service couldn’t be reached. Voice needs a network connection in most browsers.';
    case 'no-speech':
      return 'Nothing was heard. Try again, a little closer to the microphone.';
    case 'language-not-supported':
      return 'The browser can’t recognise speech in this language.';
    case 'unstable':
      return 'Listening for “Hey Flurry” stopped because the browser’s speech service kept ending. Turn it on again to retry.';
    default:
      return 'Voice input stopped unexpectedly. Try again.';
  }
}

const language = () => (typeof navigator !== 'undefined' && navigator.language) || 'en-US';

export interface ListenHandlers {
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
  onError?: (code: string) => void;
  onEnd?: () => void;
}

export class VoiceController {
  private once: Recognition | null = null;
  private wake: Recognition | null = null;
  private wakeWanted = false;
  private onceHandlers: ListenHandlers | null = null;
  private onWake: ((transcript: string) => void) | null = null;
  private onWakeError: ((code: string) => void) | null = null;
  private restartTimer = 0;
  private lastWakeStart = 0;
  /** Consecutive wake sessions that ended within seconds of starting (a failing speech service). */
  private quickEnds = 0;
  private disposed = true;
  /** Told whenever the wake listener actually starts or stops, so the UI shows what's really running. */
  onWakeActiveChange: ((active: boolean) => void) | null = null;

  /** Starts watching tab visibility (wake mode pauses in background tabs). Call before use; `dispose` undoes it. */
  attach(): void {
    if (!this.disposed) return;
    this.disposed = false;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
  }

  get listening(): boolean {
    return this.once !== null;
  }

  /** Push-to-talk: one utterance. Returns false if voice isn't supported. */
  listenOnce(h: ListenHandlers): boolean {
    const Ctor = recognitionCtor();
    if (!Ctor) return false;
    this.stopOnce();
    this.pauseWake();
    const r = new Ctor();
    r.lang = language();
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 1;
    let finalText = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      if (interim) h.onInterim?.(finalText + interim);
    };
    r.onerror = (e) => {
      if (e.error !== 'aborted') h.onError?.(e.error);
    };
    r.onend = () => {
      if (this.once !== r) return; // replaced or stopped: its handlers were already told
      this.once = null;
      this.onceHandlers = null;
      const text = finalText.trim();
      if (text) h.onFinal(text);
      h.onEnd?.();
      this.resumeWake();
    };
    this.once = r;
    this.onceHandlers = h;
    try {
      r.start();
    } catch {
      this.once = null;
      h.onError?.('start-failed');
      this.resumeWake();
      return false;
    }
    return true;
  }

  /** Stops push-to-talk without sending anything (its `onEnd` is still called). */
  stopOnce(): void {
    if (!this.once) return;
    const r = this.once;
    const h = this.onceHandlers;
    this.once = null;
    this.onceHandlers = null;
    r.onresult = null;
    r.onerror = null;
    r.onend = null;
    try {
      r.abort();
    } catch {
      /* already stopped */
    }
    h?.onEnd?.();
    this.resumeWake();
  }

  /** Turns the "Hey Flurry" listener on or off. `onHeard` gets each final transcript. */
  setWake(enabled: boolean, onHeard?: (transcript: string) => void, onError?: (code: string) => void): void {
    this.wakeWanted = enabled && recognitionCtor() !== null;
    if (onHeard) this.onWake = onHeard;
    if (onError) this.onWakeError = onError;
    if (this.wakeWanted) this.startWake();
    else this.stopWake();
  }

  get wakeActive(): boolean {
    return this.wake !== null;
  }

  private startWake(): void {
    const Ctor = recognitionCtor();
    if (!Ctor || this.wake || this.once || this.disposed || !this.wakeWanted) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const r = new Ctor();
    r.lang = language();
    r.continuous = true;
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) this.onWake?.(res[0].transcript);
      }
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
        this.wakeWanted = false; // don't keep asking; the person turns it back on
        this.onWakeError?.(e.error);
      }
    };
    r.onend = () => {
      if (this.wake === r) {
        this.wake = null;
        this.onWakeActiveChange?.(false);
      }
      // Browsers end continuous recognition after a while; restart, but never in a tight loop,
      // and give up (saying so) if the speech service keeps failing.
      const quick = Date.now() - this.lastWakeStart < 3000;
      this.quickEnds = quick ? this.quickEnds + 1 : 0;
      if (this.quickEnds >= 5) {
        this.wakeWanted = false;
        this.quickEnds = 0;
        this.onWakeError?.('unstable');
        return;
      }
      if (this.wakeWanted && !this.once) {
        window.clearTimeout(this.restartTimer);
        this.restartTimer = window.setTimeout(() => this.startWake(), quick ? 2000 * this.quickEnds : 250);
      }
    };
    this.wake = r;
    this.lastWakeStart = Date.now();
    try {
      r.start();
      this.onWakeActiveChange?.(true);
    } catch {
      this.wake = null;
    }
  }

  private stopWake(): void {
    window.clearTimeout(this.restartTimer);
    if (this.wake) {
      const r = this.wake;
      this.wake = null;
      r.onend = null;
      r.onresult = null;
      try {
        r.abort();
      } catch {
        /* already stopped */
      }
      this.onWakeActiveChange?.(false);
    }
  }

  private pauseWake(): void {
    this.stopWake();
  }

  private resumeWake(): void {
    if (this.wakeWanted) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = window.setTimeout(() => this.startWake(), 300);
    }
  }

  // Nothing listens in a background tab: push-to-talk stops, the wake listener pauses.
  private onVisibility = () => {
    if (document.visibilityState === 'visible') this.resumeWake();
    else {
      this.stopOnce();
      this.stopWake();
    }
  };

  dispose(): void {
    this.disposed = true;
    this.wakeWanted = false;
    this.stopOnce();
    this.stopWake();
    stopSpeaking();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
  }
}

export interface SpeakOptions {
  /** The server's voice from /ai/status ("elevenlabs"), or null/undefined for the browser's own voice. */
  serverVoice?: string | null;
  /** The signed-in person's token; the server voice is only asked with one. */
  token?: string | null;
  /** Where Niveloft's API is (API_BASE_URL). */
  apiBase?: string;
  /** Told when the server voice couldn't read this answer, so the browser's voice did. */
  onFallback?: (why: string) => void;
}

/** The longest text sent to the server voice (it reads up to about 1,200 characters, cut at a sentence). */
export const SERVER_VOICE_MAX = 4000;

let playing: { audio: HTMLAudioElement; url: string } | null = null;
let pending: AbortController | null = null;
/** Increases with every speak or stop, so a slow reply from the server can't start after it was replaced. */
let turn = 0;

/** Whether answers can be read aloud at all: the browser's voice, or the server's when it has one. */
export const canReadAloud = (serverVoice?: string | null): boolean => voiceOutputSupported() || (!!serverVoice && typeof Audio !== 'undefined');

/**
 * Reads text aloud. With a server voice (ElevenLabs, set up on the server, which keeps the key), the
 * text goes to Niveloft's server and comes back as audio; if that isn't possible for any reason, the
 * browser's own voice reads it instead and `onFallback` says why.
 */
export function speak(text: string, opts: SpeakOptions = {}): void {
  stopSpeaking();
  const clean = text.trim();
  if (!clean) return;
  const mine = turn;
  if (opts.serverVoice && opts.token && typeof Audio !== 'undefined' && typeof fetch !== 'undefined') {
    void speakOnServer(clean, opts, mine);
    return;
  }
  speakInBrowser(clean);
}

function speakInBrowser(text: string): void {
  if (!voiceOutputSupported()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.length > 600 ? `${text.slice(0, 600)}…` : text);
  u.lang = language();
  window.speechSynthesis.speak(u);
}

async function speakOnServer(text: string, opts: SpeakOptions, mine: number): Promise<void> {
  const abort = new AbortController();
  pending = abort;
  const timer = window.setTimeout(() => abort.abort(), 25_000);
  let why = 'The server voice didn’t answer, so your browser’s voice read this one.';
  try {
    // No Idempotency-Key: reading aloud changes nothing, and the reply is audio, not JSON to replay.
    const res = await fetch(`${opts.apiBase ?? '/api'}/ai/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.token}`, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: text.slice(0, SERVER_VOICE_MAX) }),
      signal: abort.signal,
    });
    if (mine !== turn) return; // stopped or replaced while waiting
    if (res.ok) {
      const blob = await res.blob();
      if (mine !== turn) return;
      if (blob.size > 0) {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        playing = { audio, url };
        audio.addEventListener('ended', () => {
          if (playing?.audio === audio) stopSpeaking();
        });
        try {
          await audio.play();
          return;
        } catch {
          // The browser wouldn't play it (for example before any click on the page): use its own voice.
          if (playing?.audio === audio) release();
          why = 'The browser wouldn’t play the server voice here, so its own voice read this one.';
        }
      }
    } else {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string }; message?: string } | null;
      why = body?.error?.message ?? body?.message ?? why;
    }
  } catch {
    if (mine !== turn) return;
  } finally {
    window.clearTimeout(timer);
    if (pending === abort) pending = null;
  }
  if (mine !== turn) return;
  opts.onFallback?.(why);
  speakInBrowser(text);
}

function release(): void {
  if (!playing) return;
  const { audio, url } = playing;
  playing = null;
  audio.pause();
  audio.removeAttribute('src');
  URL.revokeObjectURL(url);
}

/** Stops whatever is being read, by either voice, and cancels a server request still on its way. */
export function stopSpeaking(): void {
  turn++;
  pending?.abort();
  pending = null;
  release();
  if (voiceOutputSupported()) window.speechSynthesis.cancel();
}
