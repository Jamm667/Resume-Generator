import type { ExperienceKind } from "@prisma/client";

/** At or above this a bullet is strong evidence for the posting. */
export const STRONG_SCORE = 70;
/** At or above this it is worth considering; below it, it is a weak match. */
export const MODERATE_SCORE = 40;

export type RelevanceBand = "strong" | "moderate" | "weak" | "unscored";

/**
 * One bank bullet as the library pane sees it: the bullet, enough of its
 * experience to know where it came from, and its score for this application.
 * A null score means this bullet has never been scored — not that it scored 0.
 */
export type LibraryBullet = {
  id: string;
  text: string;
  experienceId: string;
  experienceKind: ExperienceKind;
  experienceTitle: string;
  experienceOrganization: string;
  score: number | null;
  matchedKeywords: string[];
};

export function bandOf(score: number | null): RelevanceBand {
  if (score === null) return "unscored";
  if (score >= STRONG_SCORE) return "strong";
  if (score >= MODERATE_SCORE) return "moderate";
  return "weak";
}

/**
 * Scored bullets first, highest score first; unscored bullets after them,
 * keeping their bank order. Unscored ones are not treated as zeroes — they sit
 * in their own group so the UI can say why they are at the bottom (AC-5).
 * Ties keep the incoming bank order, so a re-render never reshuffles.
 */
export function sortByScore(bullets: readonly LibraryBullet[]): LibraryBullet[] {
  const scored = bullets.filter((bullet) => bullet.score !== null);
  const unscored = bullets.filter((bullet) => bullet.score === null);

  // Stable: Array.prototype.sort is specified stable, so equal scores keep
  // the order they arrived in.
  const ranked = [...scored].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return [...ranked, ...unscored];
}

/** True once at least one bullet carries a score for this application. */
export function hasAnyScore(bullets: readonly LibraryBullet[]): boolean {
  return bullets.some((bullet) => bullet.score !== null);
}
