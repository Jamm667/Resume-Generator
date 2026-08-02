import type { DraftItem } from "@prisma/client";

import { prisma } from "@/lib/db";

/** An experience item with its bullet items, both already ordered. */
export type DraftExperience = DraftItem & { children: DraftItem[] };

/** Shared shape so the page and any refetch stay identical. */
const draftInclude = {
  children: { orderBy: { sortOrder: "asc" } },
} as const;

/**
 * The master draft for one application: experience items at the top level,
 * each with its bullet items nested, everything in `sortOrder`.
 *
 * Scoped by `userId`, so another user's application id reads as an empty draft
 * rather than someone else's work.
 */
export async function getDraft(
  userId: string,
  applicationId: string,
): Promise<DraftExperience[]> {
  return prisma.draftItem.findMany({
    where: {
      applicationId,
      parentDraftItemId: null,
      application: { userId },
    },
    orderBy: { sortOrder: "asc" },
    include: draftInclude,
  });
}

/**
 * Source bullets already represented in the draft, so the library can mark
 * them and the add path can refuse a second copy (AC-9).
 */
export function usedSourceBulletIds(draft: readonly DraftExperience[]): string[] {
  const used: string[] = [];

  for (const experience of draft) {
    for (const child of experience.children) {
      if (child.sourceBulletId) used.push(child.sourceBulletId);
    }
  }

  return used;
}

/** Source experiences already in the draft, for the same reason. */
export function usedSourceExperienceIds(
  draft: readonly DraftExperience[],
): string[] {
  return draft
    .map((item) => item.sourceExperienceId)
    .filter((id): id is string => id !== null);
}

/** What the user should see for an item: their edit, else the original. */
export function displayText(item: DraftItem): string {
  return item.userText ?? item.originalText;
}
