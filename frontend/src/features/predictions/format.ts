import type { Role } from '@/api/types';
import { dayToIso } from '@/three/projectModel';

export const ROLE_LABEL_ONE: Record<Role, string> = { OWNER: 'Owner', MANAGER: 'Manager', MEMBER: 'Member', VIEWER: 'Viewer' };

/** A model day as "Tue 14 Oct". */
export function formatDay(originMs: number, day: number): string {
  const d = new Date(`${dayToIso(originMs, day)}T00:00:00`);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export const pct = (p: number | null) => (p === null ? '–' : `${Math.round(p * 100)}%`);

/** A simulated chance: never a false certainty ("<1%", ">99%" instead of 0% and 100%). */
export const chancePct = (p: number | null) => (p === null ? '–' : p < 0.01 ? '<1%' : p > 0.99 ? '>99%' : `${Math.round(p * 100)}%`);

/** "1.4× their estimates", "on their estimates", "20% faster than their estimates". */
export function paceWords(ratio: number): string {
  if (Math.abs(ratio - 1) < 0.08) return 'about on estimate';
  return ratio > 1 ? `${ratio.toFixed(1)}× estimates` : `${Math.round((1 - ratio) * 100)}% under estimates`;
}
