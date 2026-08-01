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
