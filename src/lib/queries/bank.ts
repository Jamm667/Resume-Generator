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

/** Enough of an experience to drag it into a draft as a whole unit. */
export type ExperienceSummary = {
  id: string;
  kind: ExperienceKind;
  title: string;
  organization: string;
  dateText: string;
  bulletCount: number;
};

/** The date range as the bank shows it. */
function dateRange(experience: {
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
}): string {
  const start = experience.startDate ?? "";
  const end = experience.isCurrent ? "Present" : (experience.endDate ?? "");
  return [start, end].filter(Boolean).join(" – ");
}

/** Every experience in one user's bank, in bank order. */
export async function getExperienceSummaries(
  userId: string,
): Promise<ExperienceSummary[]> {
  const experiences = await prisma.experience.findMany({
    where: { userId },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      kind: true,
      title: true,
      organization: true,
      startDate: true,
      endDate: true,
      isCurrent: true,
      _count: { select: { bullets: true } },
    },
  });

  return experiences.map((experience) => ({
    id: experience.id,
    kind: experience.kind,
    title: experience.title,
    organization: experience.organization,
    dateText: dateRange(experience),
    bulletCount: experience._count.bullets,
  }));
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
