import { prisma } from "@/lib/db";
import { sortByScore, type LibraryBullet } from "@/lib/relevance/library";

/**
 * Every bullet in one user's data bank, carrying its score for this
 * application when it has one, ranked for the library pane.
 *
 * Bullets are read from the bank rather than from the score rows, so a bullet
 * added since the last run is present and unscored instead of missing.
 */
export async function getRelevanceLibrary(
  userId: string,
  applicationId: string,
): Promise<LibraryBullet[]> {
  const [experiences, scores] = await Promise.all([
    prisma.experience.findMany({
      where: { userId },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        kind: true,
        title: true,
        organization: true,
        bullets: {
          orderBy: { sortOrder: "asc" },
          select: { id: true, text: true },
        },
      },
    }),
    prisma.relevanceScore.findMany({
      where: { applicationId },
      select: { bulletId: true, score: true, matchedKeywords: true },
    }),
  ]);

  const byBulletId = new Map(scores.map((score) => [score.bulletId, score]));

  const bullets: LibraryBullet[] = experiences.flatMap((experience) =>
    experience.bullets.map((bullet) => {
      const scored = byBulletId.get(bullet.id);
      return {
        id: bullet.id,
        text: bullet.text,
        experienceId: experience.id,
        experienceKind: experience.kind,
        experienceTitle: experience.title,
        experienceOrganization: experience.organization,
        score: scored?.score ?? null,
        matchedKeywords: scored?.matchedKeywords ?? [],
      };
    }),
  );

  return sortByScore(bullets);
}
