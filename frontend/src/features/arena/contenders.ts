/** The Arena's answer sources and how pairs are drawn. */

/** An answer source: the built-in model, the AI in Chrome, or a model on the server. */
export interface Contender {
  id: string;
  label: string;
  detail: string;
}

export const BUILTIN: Contender = { id: 'builtin', label: 'Built-in model', detail: 'Statistics trained in this browser on the project’s records; no AI service' };
export const CHROME: Contender = { id: 'chrome', label: 'Gemini Nano', detail: 'The AI built into Chrome, running on this device' };

/** A readable name for a contender id from the scoreboard (including models no longer installed). */
export function contenderLabel(id: string): string {
  if (id === 'builtin') return BUILTIN.label;
  if (id === 'chrome') return CHROME.label;
  return id.startsWith('server:') ? id.slice('server:'.length) : id;
}

/** Two different contenders in random order (so A and B never give the source away). */
export function pickPair(pool: Contender[], random: () => number = Math.random): [Contender, Contender] | null {
  if (pool.length < 2) return null;
  const i = Math.floor(random() * pool.length);
  let j = Math.floor(random() * (pool.length - 1));
  if (j >= i) j++;
  return [pool[i], pool[j]];
}
