import type { Bullet, Experience, ExperienceKind } from "@prisma/client";

import { prisma } from "@/lib/db";

/** A bullet plus the entry it was flagged against, when there is one. */
export type BankBullet = Bullet & {
  duplicateOf: { id: string; text: string } | null;
};

export type BankExperience = Experience & {
  bullets: BankBullet[];
  sourceDocument: { id: string; filename: string } | null;
};

/** The data bank split by kind. Every list is ordered by `sortOrder`. */
export type Bank = Record<ExperienceKind, BankExperience[]>;

/** Shared shape so the list and any single-row refetch stay identical. */
const bankInclude = {
  bullets: {
    orderBy: { sortOrder: "asc" },
    include: {
      duplicateOf: { select: { id: true, text: true } },
    },
  },
  sourceDocument: { select: { id: true, filename: true } },
} as const;

/**
 * Everything in one user's data bank, grouped by kind so the UI can render
 * Jobs, Projects, and Education as separate sections without re-filtering.
 * Empty groups are present as empty arrays rather than missing keys.
 */
export async function getBankForUser(userId: string): Promise<Bank> {
  const experiences = await prisma.experience.findMany({
    where: { userId },
    orderBy: { sortOrder: "asc" },
    include: bankInclude,
  });

  const bank: Bank = { JOB: [], PROJECT: [], EDUCATION: [] };

  for (const experience of experiences) {
    bank[experience.kind].push(experience);
  }

  return bank;
}

/** One experience in the same shape the list uses, or null if not theirs. */
export async function getBankExperience(
  userId: string,
  experienceId: string,
): Promise<BankExperience | null> {
  return prisma.experience.findFirst({
    where: { id: experienceId, userId },
    include: bankInclude,
  });
}
