import type { AiAnswer, AiLookup } from '@/api/types';

/*
 * Reading Flurry's answer as it's written (no configuration or network here, so it's testable on
 * its own). The server sends server-sent events: "lookup" (each lookup once it's made), "delta"
 * (the answer's words as the model writes them, provisional), "reset" (the words so far weren't
 * the answer after all), then "answer" (the checked answer), "error" or "stopped".
 */

/** What a question shows while it's being answered. */
export interface AskProgress {
  /** The lookups made so far, in order. */
  lookups: AiLookup[];
  /** The answer's words so far: provisional, replaced by the checked answer. */
  draft: string;
}

export const STOPPED_TEXT = 'Stopped. Flurry didn’t finish this answer, and nothing was changed.';

/** The person stopped the question. Nothing was changed. */
export class AskStopped extends Error {
  constructor(message = STOPPED_TEXT) {
    super(message);
    this.name = 'AskStopped';
  }
}

export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Reads server-sent events from text however it's split: lines end with \n, \r\n or \r; a blank
 * line ends an event; "data:" lines join with \n; comment lines (":") are skipped.
 */
export function createSseParser() {
  let buffer = '';
  let event = '';
  let data: string[] = [];
  const out: SseMessage[] = [];
  const line = (l: string) => {
    if (l === '') {
      if (data.length) out.push({ event: event || 'message', data: data.join('\n') });
      event = '';
      data = [];
      return;
    }
    if (l.startsWith(':')) return;
    const i = l.indexOf(':');
    const field = i < 0 ? l : l.slice(0, i);
    let value = i < 0 ? '' : l.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  };
  return {
    /** Adds text; returns the events it completes. */
    push(chunk: string): SseMessage[] {
      buffer += chunk;
      let start = 0;
      for (let i = 0; i < buffer.length; i++) {
        const c = buffer[i];
        if (c !== '\n' && c !== '\r') continue;
        // A \r at the very end may be the first half of \r\n: wait for the next chunk.
        if (c === '\r' && i === buffer.length - 1) break;
        line(buffer.slice(start, i));
        if (c === '\r' && buffer[i + 1] === '\n') i++;
        start = i + 1;
      }
      buffer = buffer.slice(start);
      return out.splice(0);
    },
    /** The stream ended: whatever is left. */
    end(): SseMessage[] {
      if (buffer) line(buffer.replace(/\r$/, ''));
      buffer = '';
      line('');
      return out.splice(0);
    },
  };
}

/**
 * Follows a streamed answer to its end: reports progress as it comes and resolves with the checked
 * answer. Throws AskStopped when stopped (by the person, or the server says so), and an Error with
 * the server's words when it failed, or when the stream ended or broke without an answer.
 */
export async function followAnswer(body: ReadableStream<Uint8Array>, signal: AbortSignal, onProgress: (p: AskProgress) => void): Promise<AiAnswer> {
  const progress: AskProgress = { lookups: [], draft: '' };
  const parser = createSseParser();
  const decoder = new TextDecoder();
  const reader = body.getReader();
  const handle = (m: SseMessage): AiAnswer | null => {
    let d: unknown;
    try {
      d = m.data ? JSON.parse(m.data) : {};
    } catch {
      return null; // not ours
    }
    switch (m.event) {
      case 'lookup':
        progress.lookups = [...progress.lookups, d as AiLookup];
        onProgress({ ...progress });
        return null;
      case 'delta':
        progress.draft += (d as { text?: string }).text ?? '';
        onProgress({ ...progress });
        return null;
      case 'reset':
        progress.draft = '';
        onProgress({ ...progress });
        return null;
      case 'answer':
        return d as AiAnswer;
      case 'stopped':
        throw new AskStopped((d as { message?: string }).message || STOPPED_TEXT);
      case 'error':
        throw new Error((d as { message?: string }).message || 'The AI couldn’t answer. Nothing was changed; try again.');
      default:
        return null;
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      const messages = done ? [...parser.push(decoder.decode()), ...parser.end()] : parser.push(decoder.decode(value, { stream: true }));
      for (const m of messages) {
        const answer = handle(m);
        if (answer) return answer;
      }
      if (done) break;
    }
  } catch (e) {
    if (e instanceof AskStopped) throw e;
    if (signal.aborted) throw new AskStopped();
    if (e instanceof Error && !(e instanceof TypeError) && e.name !== 'AbortError') throw e;
    throw new Error('The connection dropped before the answer finished. Nothing was changed; ask again.');
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // still reading: the abort ends it
    }
  }
  if (signal.aborted) throw new AskStopped();
  throw new Error('The answer was cut off before it finished. Nothing was changed; ask again.');
}
