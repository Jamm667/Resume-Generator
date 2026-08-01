import { prisma } from "@/lib/db";

/**
 * Ownership checks for every bank mutation.
 *
 * Each returns null when the row does not exist *or* belongs to somebody else,
 * so callers cannot accidentally distinguish the two — both surface as 404 and
 * neither confirms that another user's id is real.
 */

export async function findOwnedExperience(userId: string, id: string) {
  return prisma.experience.findFirst({
    where: { id, userId },
    select: { id: true, title: true },
  });
}

export async function findOwnedBullet(userId: string, id: string) {
  return prisma.bullet.findFirst({
    where: { id, userId },
    select: { id: true, experienceId: true, duplicateOfBulletId: true },
  });
}

/**
 * Bullets flagged as duplicates of the ones about to be deleted.
 *
 * The schema nulls `duplicateOfBulletId` for these automatically
 * (`onDelete: SetNull`), but the client cannot know which rows were touched —
 * they are frequently in a different experience, since cross-document dedupe
 * is exactly what produces them. Returning the ids lets the caller clear those
 * markers too, instead of leaving one pointing at a row that no longer exists.
 *
 * Bullets that are themselves being deleted are excluded; they are going away.
 */
export async function findDependentDuplicateIds(
  userId: string,
  deletedBulletIds: string[],
): Promise<string[]> {
  if (deletedBulletIds.length === 0) return [];

  const dependents = await prisma.bullet.findMany({
    where: {
      userId,
      duplicateOfBulletId: { in: deletedBulletIds },
      id: { notIn: deletedBulletIds },
    },
    select: { id: true },
  });

  return dependents.map((bullet) => bullet.id);
}
