import type { BankBullet, BankExperience } from "@/lib/queries/bank";
import { EXPERIENCE_KINDS } from "@/lib/structure/schema";

/**
 * The queue of things still asking for a decision after an upload.
 *
 * Pure and Prisma-free: the ordering rules are the whole of it, and they are
 * worth testing without a database.
 *
 * Two different flags land here. `needsReview` means the extraction guessed and
 * wants confirming; a duplicate marker means two bullets look alike and one of
 * them has to go or be kept deliberately. A bullet can carry both, and appears
 * once when it does.
 */

export type ReviewExperienceItem = {
  type: "EXPERIENCE";
  id: string;
  kind: BankExperience["kind"];
  title: string;
  organization: string;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  summary: string | null;
};

export type ReviewBulletItem = {
  type: "BULLET";
  id: string;
  text: string;
  /** Where it came from, so the bullet is not judged out of context. */
  experienceTitle: string;
  organization: string;
  needsReview: boolean;
  duplicateOf: { id: string; text: string } | null;
};

export type ReviewItem = ReviewExperienceItem | ReviewBulletItem;

function bulletItem(
  bullet: BankBullet,
  experience: BankExperience,
): ReviewBulletItem {
  return {
    type: "BULLET",
    id: bullet.id,
    text: bullet.text,
    experienceTitle: experience.title,
    organization: experience.organization,
    needsReview: bullet.needsReview,
    duplicateOf: bullet.duplicateOf,
  };
}

/** True when this bullet has anything outstanding. */
function bulletNeedsAttention(bullet: BankBullet): boolean {
  return bullet.needsReview || bullet.duplicateOf !== null;
}

/**
 * Everything awaiting a decision, in the order the bank shows it: each
 * experience before its own bullets, kinds in their usual order.
 *
 * An experience that is itself confirmed still yields its unconfirmed bullets —
 * the two flags are independent.
 */
export function buildReviewQueue(
  experiences: readonly BankExperience[],
): ReviewItem[] {
  const queue: ReviewItem[] = [];

  for (const kind of EXPERIENCE_KINDS) {
    for (const experience of experiences.filter((item) => item.kind === kind)) {
      if (experience.needsReview) {
        queue.push({
          type: "EXPERIENCE",
          id: experience.id,
          kind: experience.kind,
          title: experience.title,
          organization: experience.organization,
          location: experience.location,
          startDate: experience.startDate,
          endDate: experience.endDate,
          isCurrent: experience.isCurrent,
          summary: experience.summary,
        });
      }

      for (const bullet of experience.bullets) {
        if (bulletNeedsAttention(bullet)) {
          queue.push(bulletItem(bullet, experience));
        }
      }
    }
  }

  return queue;
}

/** How many items are still waiting on a decision. */
export function reviewCount(
  experiences: readonly BankExperience[],
): number {
  return buildReviewQueue(experiences).length;
}
