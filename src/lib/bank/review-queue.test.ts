import { describe, expect, it } from "vitest";

import { buildReviewQueue, reviewCount } from "@/lib/bank/review-queue";
import type { BankBullet, BankExperience } from "@/lib/queries/bank";

function bullet(overrides: Partial<BankBullet> = {}): BankBullet {
  return {
    id: "b1",
    userId: "u1",
    experienceId: "e1",
    text: "A bullet",
    needsReview: false,
    sortOrder: 0,
    duplicateOfBulletId: null,
    duplicateOf: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BankBullet;
}

function experience(
  overrides: Partial<BankExperience> = {},
  bullets: BankBullet[] = [],
): BankExperience {
  return {
    id: "e1",
    userId: "u1",
    sourceDocumentId: null,
    kind: "JOB",
    title: "Engineer",
    organization: "Acme",
    location: null,
    startDate: null,
    endDate: null,
    isCurrent: false,
    summary: null,
    needsReview: false,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    sourceDocument: null,
    bullets,
    ...overrides,
  } as BankExperience;
}

describe("buildReviewQueue", () => {
  it("is empty when nothing is flagged", () => {
    const queue = buildReviewQueue([experience({}, [bullet()])]);
    expect(queue).toEqual([]);
    expect(reviewCount([experience({}, [bullet()])])).toBe(0);
  });

  it("queues a flagged experience before its own bullets", () => {
    const queue = buildReviewQueue([
      experience({ needsReview: true }, [
        bullet({ id: "b1", needsReview: true }),
        bullet({ id: "b2", sortOrder: 1, needsReview: true }),
      ]),
    ]);

    expect(queue.map((item) => item.id)).toEqual(["e1", "b1", "b2"]);
    expect(queue[0].type).toBe("EXPERIENCE");
  });

  it("queues unconfirmed bullets even when their experience is confirmed", () => {
    const queue = buildReviewQueue([
      experience({ needsReview: false }, [bullet({ needsReview: true })]),
    ]);

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ type: "BULLET", id: "b1" });
  });

  it("queues a duplicate-flagged bullet that needs no other review", () => {
    const queue = buildReviewQueue([
      experience({}, [
        bullet({
          needsReview: false,
          duplicateOfBulletId: "other",
          duplicateOf: { id: "other", text: "The twin" },
        }),
      ]),
    ]);

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      type: "BULLET",
      needsReview: false,
      duplicateOf: { text: "The twin" },
    });
  });

  it("lists a bullet once when it is both unconfirmed and a duplicate", () => {
    const queue = buildReviewQueue([
      experience({}, [
        bullet({
          needsReview: true,
          duplicateOfBulletId: "other",
          duplicateOf: { id: "other", text: "The twin" },
        }),
      ]),
    ]);

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ needsReview: true });
    expect((queue[0] as { duplicateOf: unknown }).duplicateOf).not.toBeNull();
  });

  it("orders kinds Jobs, Projects, Education", () => {
    const queue = buildReviewQueue([
      experience({ id: "school", kind: "EDUCATION", needsReview: true }),
      experience({ id: "side", kind: "PROJECT", needsReview: true }),
      experience({ id: "job", kind: "JOB", needsReview: true }),
    ]);

    expect(queue.map((item) => item.id)).toEqual(["job", "side", "school"]);
  });

  it("carries the experience a bullet belongs to, so it is not judged alone", () => {
    const queue = buildReviewQueue([
      experience({ title: "Barista", organization: "Blue Fern" }, [
        bullet({ needsReview: true }),
      ]),
    ]);

    expect(queue[0]).toMatchObject({
      experienceTitle: "Barista",
      organization: "Blue Fern",
    });
  });

  it("skips confirmed bullets inside a flagged experience", () => {
    const queue = buildReviewQueue([
      experience({ needsReview: true }, [
        bullet({ id: "done", needsReview: false }),
        bullet({ id: "todo", sortOrder: 1, needsReview: true }),
      ]),
    ]);

    expect(queue.map((item) => item.id)).toEqual(["e1", "todo"]);
  });
});
