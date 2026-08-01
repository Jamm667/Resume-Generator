import type { Bullet, Experience, ExperienceKind } from "@prisma/client";

import { prisma } from "@/lib/db";

export type ExperienceWithBullets = Experience & { bullets: Bullet[] };

/** The data bank split by kind. Every list is ordered by `sortOrder`. */
export type Bank = Record<ExperienceKind, ExperienceWithBullets[]>;

/**
 * Everything in one user's data bank, grouped by kind so the UI can render
 * Jobs, Projects, and Education as separate sections without re-filtering.
 * Empty groups are present as empty arrays rather than missing keys.
 */
export async function getBankForUser(userId: string): Promise<Bank> {
  const experiences = await prisma.experience.findMany({
    where: { userId },
    orderBy: { sortOrder: "asc" },
    include: {
      bullets: { orderBy: { sortOrder: "asc" } },
    },
  });

  const bank: Bank = { JOB: [], PROJECT: [], EDUCATION: [] };

  for (const experience of experiences) {
    bank[experience.kind].push(experience);
  }

  return bank;
}
