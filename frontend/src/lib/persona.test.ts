import { describe, expect, it } from 'vitest';
import { pendingPersona, personaFor, savePersona, setPendingPersona, startPathFor } from './persona';

// A tiny in-memory localStorage, so the helpers can be tested outside a browser.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

describe('persona', () => {
  it('adopts the choice made before sign-up, once, for an account without one', () => {
    store.clear();
    setPendingPersona('MEMBER');
    expect(pendingPersona()).toBe('MEMBER');
    expect(personaFor(7)).toBe('MEMBER');
    expect(pendingPersona()).toBeNull();
    expect(startPathFor(7)).toBe('/my-tasks');
  });

  it('never overwrites an account’s own choice with a pending one', () => {
    store.clear();
    savePersona(8, 'VIEWER');
    setPendingPersona('OWNER');
    expect(personaFor(8)).toBe('VIEWER');
    expect(pendingPersona()).toBe('OWNER');
  });

  it('ignores unknown values and falls back to the dashboard', () => {
    store.clear();
    store.set('projectflow.persona.9', 'ADMIN');
    expect(personaFor(9)).toBeNull();
    expect(startPathFor(9)).toBe('/dashboard');
  });
});
