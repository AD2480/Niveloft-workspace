import type { Role } from '@/api/types';
import { readStorage, writeStorage } from './storage';

/**
 * How someone mostly uses Niveloft, chosen on the front page or at sign-up. It shapes their
 * start page and first steps. It never grants anything: permissions come from the role each
 * project gives them (you own the projects you create; others add you to theirs).
 */
export type Persona = Role;

export const PERSONAS: { value: Persona; title: string; line: string; points: string[] }[] = [
  {
    value: 'OWNER',
    title: 'I run projects',
    line: 'Owner',
    points: ['Create projects and set deadlines', 'Invite your team and appoint managers', 'Review work and see the forecast'],
  },
  {
    value: 'MANAGER',
    title: 'I lead a team',
    line: 'Manager',
    points: ['Plan and assign tasks', 'Review and approve submitted work', 'Invite members and viewers'],
  },
  {
    value: 'MEMBER',
    title: 'I do the work',
    line: 'Member, assignee',
    points: ['See everything assigned to you', 'Tick off checklists as you go', 'Submit work with evidence for review'],
  },
  {
    value: 'VIEWER',
    title: 'I follow along',
    line: 'Viewer',
    points: ['See progress and the forecast', 'Replay the project in 3D', 'Change nothing by accident'],
  },
];

/** Where each persona starts after signing in. */
export const START_PATH: Record<Persona, string> = { OWNER: '/dashboard', MANAGER: '/dashboard', MEMBER: '/my-tasks', VIEWER: '/projects' };

const PENDING = 'projectflow.persona.pending';
const key = (userId: number) => `projectflow.persona.${userId}`;
const valid = (v: string | null): v is Persona => v === 'OWNER' || v === 'MANAGER' || v === 'MEMBER' || v === 'VIEWER';

/**
 * Chosen before there's an account (front page → sign-up). Kept in this browser rather than this
 * tab, so it survives opening the email-confirmation link in a new tab.
 */
export function setPendingPersona(p: Persona): void {
  writeStorage(PENDING, p);
}

/** The choice made before signing up, if any (not yet tied to an account). */
export function pendingPersona(): Persona | null {
  const v = readStorage(PENDING);
  return valid(v) ? v : null;
}

/** The person's persona. A pending choice is adopted only by an account that has none yet. */
export function personaFor(userId: number): Persona | null {
  const saved = readStorage(key(userId));
  if (valid(saved)) return saved;
  const pending = pendingPersona();
  if (pending) {
    savePersona(userId, pending);
    return pending;
  }
  return null;
}

export function savePersona(userId: number, p: Persona): void {
  writeStorage(key(userId), p);
  writeStorage(PENDING, null);
}

/** Where to go after signing in when nothing more specific was asked for. */
export function startPathFor(userId: number): string {
  const p = personaFor(userId);
  return p ? START_PATH[p] : '/dashboard';
}
