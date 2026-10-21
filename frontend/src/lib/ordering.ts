/**
 * Fractional ordering for board columns.
 *
 * Each task stores a floating-point `position` inside its status column.
 * Moving a task only rewrites that task's position — the midpoint between its
 * new neighbours — instead of renumbering the whole column. When two
 * neighbours get too close (after many moves into the same gap) the column is
 * rebalanced once.
 *
 * Idea adapted from Plane's `sort_order` (float, default spacing) and
 * jira_clone's `listPosition` midpoint calculation; this implementation is
 * original. The Spring Boot backend uses the same constants and algorithm.
 */
export const POSITION_GAP = 1024;
/** Below this gap between neighbours the column must be rebalanced first. */
export const MIN_POSITION_GAP = 1e-6;

/**
 * Position for an item placed between two neighbours (either may be missing).
 * Returns `null` when the neighbours are too close and a rebalance is needed.
 */
export function positionBetween(prev: number | undefined, next: number | undefined): number | null {
  if (prev === undefined && next === undefined) return POSITION_GAP;
  if (prev === undefined) return next! - POSITION_GAP;
  if (next === undefined) return prev + POSITION_GAP;
  if (next - prev < MIN_POSITION_GAP) return null;
  return (prev + next) / 2;
}

/** Evenly re-space a column that is already sorted by position. */
export function rebalance<T extends { position: number }>(sortedColumn: T[]): void {
  sortedColumn.forEach((item, i) => {
    item.position = (i + 1) * POSITION_GAP;
  });
}

/**
 * Place `item` between the items with ids `previousId` and `nextId` in a
 * column (mutates positions; rebalances when necessary). Unknown neighbour ids
 * are ignored, and with no neighbours the item goes to the end of the column.
 */
export function placeBetween<T extends { id: number; position: number }>(
  column: T[],
  item: T,
  previousId: number | null | undefined,
  nextId: number | null | undefined,
): void {
  const others = column.filter((c) => c.id !== item.id).sort((a, b) => a.position - b.position || a.id - b.id);
  let prev = others.find((c) => c.id === previousId);
  let next = others.find((c) => c.id === nextId);
  if (!prev && !next) prev = others[others.length - 1];
  // Keep the pair consistent: next must be the item directly after prev.
  if (prev && !next) next = others[others.indexOf(prev) + 1];
  if (next && !prev) prev = others[others.indexOf(next) - 1];

  let position = positionBetween(prev?.position, next?.position);
  if (position === null) {
    rebalance(others);
    position = positionBetween(prev?.position, next?.position)!;
  }
  item.position = position;
}
