import type { DraftItem } from "@prisma/client";

import type { DraftExperience } from "@/lib/queries/draft";

/**
 * The draft as the client renders it: plain data, with the user's edit already
 * chosen over the original and a flag saying which one is showing.
 *
 * `originalText` travels alongside so "revert to original" can show what it
 * would go back to without another request.
 */
export type DraftBulletView = {
  id: string;
  sourceBulletId: string | null;
  text: string;
  originalText: string;
  isEdited: boolean;
};

export type DraftExperienceView = {
  id: string;
  sourceExperienceId: string | null;
  title: string;
  originalTitle: string;
  organization: string | null;
  dateText: string;
  originalDateText: string;
  isTitleEdited: boolean;
  isDateEdited: boolean;
  bullets: DraftBulletView[];
};

function bulletView(item: DraftItem): DraftBulletView {
  return {
    id: item.id,
    sourceBulletId: item.sourceBulletId,
    text: item.userText ?? item.originalText,
    originalText: item.originalText,
    isEdited: item.userText !== null,
  };
}

export function toDraftView(
  draft: readonly DraftExperience[],
): DraftExperienceView[] {
  return draft.map((item) => ({
    id: item.id,
    sourceExperienceId: item.sourceExperienceId,
    title: item.userTitle ?? item.originalTitle ?? item.originalText,
    originalTitle: item.originalTitle ?? item.originalText,
    organization: item.organization,
    dateText: item.userDateText ?? item.originalDateText ?? "",
    originalDateText: item.originalDateText ?? "",
    isTitleEdited: item.userTitle !== null,
    isDateEdited: item.userDateText !== null,
    bullets: item.children.map(bulletView),
  }));
}
