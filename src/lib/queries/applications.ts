import type { Application, DraftItem } from "@prisma/client";

import { prisma } from "@/lib/db";

/** Just enough of each application to render the list. */
export type ApplicationSummary = Pick<
  Application,
  "id" | "name" | "companyName" | "roleTitle" | "updatedAt"
>;

/** The signed-in user's applications, most recently touched first. */
export async function listApplications(
  userId: string,
): Promise<ApplicationSummary[]> {
  return prisma.application.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      companyName: true,
      roleTitle: true,
      updatedAt: true,
    },
  });
}

/** A top-level draft row with its nested bullet rows, all ordered. */
export type DraftItemWithChildren = DraftItem & { children: DraftItem[] };

export type ApplicationWithDraft = Application & {
  draftItems: DraftItemWithChildren[];
};

/**
 * One application and its Master Draft. Only top-level items are returned at
 * the root; BULLET items hang off their parent EXPERIENCE item under
 * `children`, both levels ordered by `sortOrder`.
 *
 * Scoped by `userId` so an id alone never reaches another user's application.
 * Returns null when the application does not exist or is not theirs.
 */
export async function getApplication(
  userId: string,
  id: string,
): Promise<ApplicationWithDraft | null> {
  return prisma.application.findFirst({
    where: { id, userId },
    include: {
      draftItems: {
        where: { parentDraftItemId: null },
        orderBy: { sortOrder: "asc" },
        include: {
          children: { orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });
}
