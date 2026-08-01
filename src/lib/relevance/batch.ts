/**
 * Budgets and batching for the relevance pass.
 *
 * Kept free of Prisma so the batching rules can be tested without a database —
 * splitting the bank correctly is pure arithmetic and should not need one.
 */

/** Enough of the posting to judge against; the tail is usually boilerplate. */
export const JD_SCORING_CHARS = 12_000;

/**
 * The ceilings that force a split, not a target: a whole bank goes in one call
 * when it fits. Characters rather than tokens because that is the input we
 * actually have, at a ratio generous enough to stay well inside the window.
 */
export const MAX_BATCH_BULLETS = 40;
export const MAX_BATCH_CHARS = 8_000;

/** A bullet as this pass needs it: an id to score by and the text to score. */
export type ScorableBullet = { id: string; text: string };

/**
 * Split the bank into calls that fit the budget, in bank order so batches are
 * reproducible across runs. A single bullet longer than the character budget
 * still gets its own batch rather than being dropped.
 */
export function planBatches<T extends ScorableBullet>(
  bullets: readonly T[],
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let chars = 0;

  for (const bullet of bullets) {
    const length = bullet.text.length;
    const wouldOverflow =
      current.length >= MAX_BATCH_BULLETS || chars + length > MAX_BATCH_CHARS;

    if (current.length > 0 && wouldOverflow) {
      batches.push(current);
      current = [];
      chars = 0;
    }

    current.push(bullet);
    chars += length;
  }

  if (current.length > 0) batches.push(current);

  return batches;
}
