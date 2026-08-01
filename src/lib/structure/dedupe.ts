/**
 * Bullets repeat across resumes with small edits — a changed tense, a dropped
 * article, different punctuation. Flagging those is a text-similarity problem,
 * so it is solved deterministically here rather than with another model call:
 * the same two bullets always produce the same verdict, and it is unit-testable.
 */

/** At or above this token-set Jaccard, two bullets are considered the same. */
export const DUPLICATE_THRESHOLD = 0.85;

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeBullet(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenSet(text: string): Set<string> {
  const normalized = normalizeBullet(text);
  return new Set(normalized.length === 0 ? [] : normalized.split(" "));
}

/**
 * Jaccard similarity over token sets: shared tokens divided by total distinct
 * tokens. Order-insensitive, which is what we want — a reordered clause is
 * still the same achievement.
 */
export function jaccardSimilarity(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);

  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }

  return shared / (left.size + right.size - shared);
}

export type ExistingBullet = { id: string; text: string };

/**
 * The best match at or above the threshold, or null. Ties resolve to the
 * earliest candidate so repeated runs stay stable.
 */
export function findDuplicate(
  candidate: string,
  existing: ExistingBullet[],
): ExistingBullet | null {
  let best: ExistingBullet | null = null;
  let bestScore = 0;

  for (const other of existing) {
    const score = jaccardSimilarity(candidate, other.text);
    if (score >= DUPLICATE_THRESHOLD && score > bestScore) {
      best = other;
      bestScore = score;
    }
  }

  return best;
}
