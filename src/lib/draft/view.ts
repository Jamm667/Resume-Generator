import type { DraftItem, TailorStatus } from "@prisma/client";

import type { DraftExperience } from "@/lib/queries/draft";
import { addedNumbers } from "@/lib/tailor/numeric-guard";

/**
 * The draft as the client renders it: plain data, with the text the user should
 * see already chosen and a flag saying which layer it came from.
 *
 * An accepted rewrite wins over a hand edit, which wins over the original.
 * `originalText` travels alongside so a diff and a revert need no extra request.
 */
export type DraftBulletView = {
  id: string;
  sourceBulletId: string | null;
  text: string;
  originalText: string;
  isEdited: boolean;
  /** The proposal, when there is one to rule on or to explain. */
  tailoredText: string | null;
  tailorStatus: TailorStatus;
  /** The text the proposal was measured against, for the diff. */
  tailorBaseline: string;
  /** Numbers the rewrite introduced; only ever non-empty when BLOCKED. */
  addedNumbers: string[];
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
  tailoredTitle: string | null;
  tailoredDateText: string | null;
  headerTailorStatus: TailorStatus;
  titleBaseline: string;
  dateBaseline: string;
  bullets: DraftBulletView[];
};

/** What a bullet says before any proposal is applied. */
function baselineText(item: DraftItem): string {
  return item.userText ?? item.originalText;
}

function bulletView(item: DraftItem): DraftBulletView {
  const baseline = baselineText(item);
  const accepted = item.tailorStatus === "ACCEPTED" && item.tailoredText;

  return {
    id: item.id,
    sourceBulletId: item.sourceBulletId,
    text: accepted ? item.tailoredText! : baseline,
    originalText: item.originalText,
    isEdited: item.userText !== null,
    tailoredText: item.tailoredText,
    tailorStatus: item.tailorStatus,
    tailorBaseline: baseline,
    addedNumbers:
      item.tailorStatus === "BLOCKED" && item.tailoredText
        ? addedNumbers(baseline, item.tailoredText)
        : [],
  };
}

export function toDraftView(
  draft: readonly DraftExperience[],
): DraftExperienceView[] {
  return draft.map((item) => {
    const titleBaseline = item.userTitle ?? item.originalTitle ?? item.originalText;
    const dateBaseline = item.userDateText ?? item.originalDateText ?? "";
    const accepted = item.headerTailorStatus === "ACCEPTED";

    return {
      id: item.id,
      sourceExperienceId: item.sourceExperienceId,
      title: accepted && item.tailoredTitle ? item.tailoredTitle : titleBaseline,
      originalTitle: item.originalTitle ?? item.originalText,
      organization: item.organization,
      dateText:
        accepted && item.tailoredDateText ? item.tailoredDateText : dateBaseline,
      originalDateText: item.originalDateText ?? "",
      isTitleEdited: item.userTitle !== null,
      isDateEdited: item.userDateText !== null,
      tailoredTitle: item.tailoredTitle,
      tailoredDateText: item.tailoredDateText,
      headerTailorStatus: item.headerTailorStatus,
      titleBaseline,
      dateBaseline,
      bullets: item.children.map(bulletView),
    };
  });
}

/** Items with a decision still to make, for the review panel and Accept all. */
export function proposedBullets(
  draft: readonly DraftExperienceView[],
): DraftBulletView[] {
  return draft.flatMap((experience) =>
    experience.bullets.filter((bullet) => bullet.tailorStatus === "PROPOSED"),
  );
}

export function blockedBullets(
  draft: readonly DraftExperienceView[],
): DraftBulletView[] {
  return draft.flatMap((experience) =>
    experience.bullets.filter((bullet) => bullet.tailorStatus === "BLOCKED"),
  );
}

export function proposedHeaders(
  draft: readonly DraftExperienceView[],
): DraftExperienceView[] {
  return draft.filter(
    (experience) => experience.headerTailorStatus === "PROPOSED",
  );
}

/**
 * Proposals already ruled on, which keep their diff so a decision can be
 * looked at again and changed (AC-8). Blocked items are not decisions and
 * belong in their own section.
 */
export function reviewedBullets(
  draft: readonly DraftExperienceView[],
): DraftBulletView[] {
  return draft.flatMap((experience) =>
    experience.bullets.filter(
      (bullet) =>
        bullet.tailoredText !== null &&
        (bullet.tailorStatus === "ACCEPTED" ||
          bullet.tailorStatus === "REJECTED"),
    ),
  );
}

export function reviewedHeaders(
  draft: readonly DraftExperienceView[],
): DraftExperienceView[] {
  return draft.filter(
    (experience) =>
      experience.tailoredTitle !== null &&
      (experience.headerTailorStatus === "ACCEPTED" ||
        experience.headerTailorStatus === "REJECTED"),
  );
}
