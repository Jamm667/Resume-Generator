import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_BATCH_BULLETS,
  MAX_BATCH_CHARS,
  planBatches,
} from "@/lib/relevance/batch";
import {
  bandOf,
  hasAnyScore,
  sortByScore,
  type LibraryBullet,
} from "@/lib/relevance/library";
import {
  relevanceResponseJsonSchema,
  relevanceResponseSchema,
} from "@/lib/relevance/schema";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("@/lib/anthropic", () => ({
  getAnthropicClient: () => ({ messages: { create: mockCreate } }),
}));

const hasDatabase = Boolean(process.env.DATABASE_URL);

const JD = `We need a platform engineer who has run Postgres in production and
owned a payments pipeline end to end, including reconciliation and reporting.`;

function anthropicJson(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/** The bullet ids one call was actually asked about. */
function idsInPrompt(args: { messages: { content: string }[] }): string[] {
  const content = args.messages[0].content;
  return [...content.matchAll(/<bullet id="([^"]+)"/g)].map(
    (match) => match[1],
  );
}

// ---------------------------------------------------------------------------
// Response schema
// ---------------------------------------------------------------------------

describe("relevanceResponseSchema", () => {
  it("accepts a well-formed payload", () => {
    const parsed = relevanceResponseSchema.parse({
      scores: [{ bulletId: "abc", score: 82, matchedKeywords: ["Postgres"] }],
    });
    expect(parsed.scores[0].score).toBe(82);
    expect(parsed.scores[0].matchedKeywords).toEqual(["Postgres"]);
  });

  it("accepts the ends of the range", () => {
    expect(() =>
      relevanceResponseSchema.parse({
        scores: [
          { bulletId: "a", score: 0, matchedKeywords: [] },
          { bulletId: "b", score: 100, matchedKeywords: [] },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects a score outside 0–100", () => {
    for (const score of [-1, 101, 1000]) {
      expect(() =>
        relevanceResponseSchema.parse({
          scores: [{ bulletId: "abc", score, matchedKeywords: [] }],
        }),
      ).toThrow();
    }
  });

  it("rejects a fractional score", () => {
    expect(() =>
      relevanceResponseSchema.parse({
        scores: [{ bulletId: "abc", score: 82.5, matchedKeywords: [] }],
      }),
    ).toThrow();
  });

  it("rejects a missing or empty bullet id", () => {
    expect(() =>
      relevanceResponseSchema.parse({
        scores: [{ score: 50, matchedKeywords: [] }],
      }),
    ).toThrow();
    expect(() =>
      relevanceResponseSchema.parse({
        scores: [{ bulletId: "", score: 50, matchedKeywords: [] }],
      }),
    ).toThrow();
  });

  it("produces a JSON Schema without $schema", () => {
    const generated = relevanceResponseJsonSchema();
    expect(generated.$schema).toBeUndefined();
    expect(generated.type).toBe("object");
  });

  it("keeps range constraints out of the schema sent to the API", () => {
    // The constrained decoder rejects minimum/maximum on an integer with a
    // 400, so the range is enforced on the response instead of in the schema.
    const serialized = JSON.stringify(relevanceResponseJsonSchema());
    expect(serialized).not.toContain("minimum");
    expect(serialized).not.toContain("maximum");
    expect(serialized).not.toContain("minLength");
    expect(serialized).toContain("integer");
  });
});

// ---------------------------------------------------------------------------
// Batching
// ---------------------------------------------------------------------------

describe("planBatches", () => {
  function bullets(count: number, text = "A short bullet.") {
    return Array.from({ length: count }, (_, index) => ({
      id: `b${index}`,
      text,
    }));
  }

  it("returns nothing for an empty bank", () => {
    expect(planBatches([])).toEqual([]);
  });

  it("keeps a bank that fits in one call", () => {
    const batches = planBatches(bullets(MAX_BATCH_BULLETS));
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(MAX_BATCH_BULLETS);
  });

  it("splits a bank over the bullet ceiling", () => {
    const batches = planBatches(bullets(MAX_BATCH_BULLETS + 1));
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(MAX_BATCH_BULLETS);
    expect(batches[1]).toHaveLength(1);
  });

  it("splits a bank over the character ceiling", () => {
    // Three bullets, each a third of the budget plus a little, so the third
    // cannot join the first two.
    const long = "x".repeat(Math.floor(MAX_BATCH_CHARS / 2) + 1);
    const batches = planBatches(bullets(3, long));
    expect(batches.length).toBeGreaterThan(1);
  });

  it("gives a single oversized bullet its own batch rather than dropping it", () => {
    const huge = { id: "huge", text: "x".repeat(MAX_BATCH_CHARS * 2) };
    const batches = planBatches([huge, { id: "small", text: "short" }]);
    expect(batches[0]).toEqual([huge]);
    expect(batches.flat()).toHaveLength(2);
  });

  it("preserves bank order and loses nothing", () => {
    const input = bullets(MAX_BATCH_BULLETS * 2 + 7);
    const flattened = planBatches(input);
    expect(flattened.flat().map((bullet) => bullet.id)).toEqual(
      input.map((bullet) => bullet.id),
    );
  });
});

// ---------------------------------------------------------------------------
// Bands and ranking
// ---------------------------------------------------------------------------

describe("bandOf", () => {
  it("puts each score in its band, at the boundaries", () => {
    expect(bandOf(100)).toBe("strong");
    expect(bandOf(70)).toBe("strong");
    expect(bandOf(69)).toBe("moderate");
    expect(bandOf(40)).toBe("moderate");
    expect(bandOf(39)).toBe("weak");
    expect(bandOf(0)).toBe("weak");
  });

  it("treats no score as unscored rather than as zero", () => {
    expect(bandOf(null)).toBe("unscored");
    expect(bandOf(0)).not.toBe("unscored");
  });
});

describe("sortByScore", () => {
  function bullet(id: string, score: number | null): LibraryBullet {
    return {
      id,
      text: `Bullet ${id}`,
      experienceId: "e1",
      experienceKind: "JOB",
      experienceTitle: "Engineer",
      experienceOrganization: "Acme",
      score,
      matchedKeywords: [],
    };
  }

  it("ranks highest first and keeps unscored bullets after the scored ones", () => {
    const ranked = sortByScore([
      bullet("low", 12),
      bullet("new", null),
      bullet("high", 91),
      bullet("mid", 55),
    ]);

    expect(ranked.map((item) => item.id)).toEqual([
      "high",
      "mid",
      "low",
      "new",
    ]);
  });

  it("does not rank an unscored bullet as a zero", () => {
    const ranked = sortByScore([bullet("new", null), bullet("zero", 0)]);
    expect(ranked.map((item) => item.id)).toEqual(["zero", "new"]);
  });

  it("keeps bank order for equal scores", () => {
    const ranked = sortByScore([
      bullet("first", 50),
      bullet("second", 50),
      bullet("third", 50),
    ]);
    expect(ranked.map((item) => item.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });
});

describe("hasAnyScore", () => {
  it("is false until something has been scored", () => {
    const unscored: LibraryBullet = {
      id: "a",
      text: "A bullet",
      experienceId: "e1",
      experienceKind: "JOB",
      experienceTitle: "Engineer",
      experienceOrganization: "Acme",
      score: null,
      matchedKeywords: [],
    };
    expect(hasAnyScore([unscored])).toBe(false);
    expect(hasAnyScore([{ ...unscored, score: 0 }])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The pass itself — requires a database
// ---------------------------------------------------------------------------

describe.skipIf(!hasDatabase)("runRelevancePass", () => {
  const userIds: string[] = [];
  let prisma: typeof import("@/lib/db").prisma;
  let runRelevancePass: typeof import("@/lib/relevance").runRelevancePass;
  let getRelevanceLibrary: typeof import("@/lib/queries/relevance").getRelevanceLibrary;

  /** A user with one experience, `count` bullets, and one application. */
  async function makeBank(count: number, text = "Ran Postgres in production.") {
    const user = await prisma.user.create({
      data: { email: `vitest-rel-${crypto.randomUUID()}@example.com` },
    });
    userIds.push(user.id);

    const experience = await prisma.experience.create({
      data: {
        userId: user.id,
        kind: "JOB",
        title: "Platform Engineer",
        organization: "Acme",
        sortOrder: 0,
        bullets: {
          create: Array.from({ length: count }, (_, index) => ({
            userId: user.id,
            text: `${text} (${index})`,
            sortOrder: index,
          })),
        },
      },
      include: { bullets: { orderBy: { sortOrder: "asc" } } },
    });

    const application = await prisma.application.create({
      data: { userId: user.id, name: "Acme — Platform", jdText: JD },
    });

    return { user, experience, application, bullets: experience.bullets };
  }

  /** Answer whatever ids the call was given, all with the same score. */
  function respondWithScore(score: number, keywords: string[] = ["Postgres"]) {
    mockCreate.mockImplementation(async (args) =>
      anthropicJson({
        scores: idsInPrompt(args).map((bulletId) => ({
          bulletId,
          score,
          matchedKeywords: keywords,
        })),
      }),
    );
  }

  beforeEach(async () => {
    mockCreate.mockReset();
    ({ prisma } = await import("@/lib/db"));
    ({ runRelevancePass } = await import("@/lib/relevance"));
    ({ getRelevanceLibrary } = await import("@/lib/queries/relevance"));
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("scores every bullet and persists one row each", async () => {
    const { application, bullets } = await makeBank(3);
    respondWithScore(80);

    const outcome = await runRelevancePass({
      applicationId: application.id,
      jdText: JD,
      bullets,
    });

    expect(outcome).toMatchObject({ status: "SCORED", scored: 3, unscored: 0 });
    expect(
      await prisma.relevanceScore.count({
        where: { applicationId: application.id },
      }),
    ).toBe(3);
  });

  it("replaces the previous scores on a re-run instead of duplicating them", async () => {
    const { application, bullets } = await makeBank(3);

    respondWithScore(40);
    await runRelevancePass({ applicationId: application.id, jdText: JD, bullets });

    respondWithScore(90);
    await runRelevancePass({ applicationId: application.id, jdText: JD, bullets });

    const rows = await prisma.relevanceScore.findMany({
      where: { applicationId: application.id },
    });

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.score === 90)).toBe(true);
  });

  it("splits a bank past the budget across calls and merges the results", async () => {
    const { application, bullets } = await makeBank(MAX_BATCH_BULLETS + 5);
    respondWithScore(60);

    const outcome = await runRelevancePass({
      applicationId: application.id,
      jdText: JD,
      bullets,
    });

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(outcome).toMatchObject({
      status: "SCORED",
      scored: MAX_BATCH_BULLETS + 5,
      batches: 2,
    });
    expect(
      await prisma.relevanceScore.count({
        where: { applicationId: application.id },
      }),
    ).toBe(MAX_BATCH_BULLETS + 5);
  });

  it("leaves the previous ranking intact when the call fails", async () => {
    const { application, bullets } = await makeBank(2);

    respondWithScore(75);
    await runRelevancePass({ applicationId: application.id, jdText: JD, bullets });

    mockCreate.mockReset();
    mockCreate.mockRejectedValue(new Error("overloaded"));

    const outcome = await runRelevancePass({
      applicationId: application.id,
      jdText: JD,
      bullets,
    });

    expect(outcome.status).toBe("FAILED");

    const rows = await prisma.relevanceScore.findMany({
      where: { applicationId: application.id },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.score === 75)).toBe(true);
  });

  it("leaves the previous ranking intact when the response is malformed", async () => {
    const { application, bullets } = await makeBank(2);

    respondWithScore(75);
    await runRelevancePass({ applicationId: application.id, jdText: JD, bullets });

    mockCreate.mockReset();
    // A score outside the range: the batch is rejected, not clamped.
    mockCreate.mockResolvedValue(
      anthropicJson({
        scores: bullets.map((bullet) => ({
          bulletId: bullet.id,
          score: 900,
          matchedKeywords: [],
        })),
      }),
    );

    const outcome = await runRelevancePass({
      applicationId: application.id,
      jdText: JD,
      bullets,
    });

    expect(outcome.status).toBe("FAILED");
    const rows = await prisma.relevanceScore.findMany({
      where: { applicationId: application.id },
    });
    expect(rows.every((row) => row.score === 75)).toBe(true);
  });

  it("reports bullets the model left out as unscored rather than inventing a score", async () => {
    const { application, bullets } = await makeBank(3);

    mockCreate.mockResolvedValue(
      anthropicJson({
        scores: [
          { bulletId: bullets[0].id, score: 88, matchedKeywords: ["Postgres"] },
        ],
      }),
    );

    const outcome = await runRelevancePass({
      applicationId: application.id,
      jdText: JD,
      bullets,
    });

    expect(outcome).toMatchObject({ status: "SCORED", scored: 1, unscored: 2 });

    const library = await getRelevanceLibrary(
      bullets[0].userId,
      application.id,
    );
    expect(library[0].score).toBe(88);
    expect(library.slice(1).every((item) => item.score === null)).toBe(true);
  });

  it("discards a bullet id it was never given", async () => {
    const { application, bullets } = await makeBank(1);

    mockCreate.mockResolvedValue(
      anthropicJson({
        scores: [
          { bulletId: bullets[0].id, score: 70, matchedKeywords: [] },
          { bulletId: "not-a-real-bullet", score: 99, matchedKeywords: [] },
        ],
      }),
    );

    const outcome = await runRelevancePass({
      applicationId: application.id,
      jdText: JD,
      bullets,
    });

    expect(outcome).toMatchObject({ status: "SCORED", scored: 1 });
    const rows = await prisma.relevanceScore.findMany({
      where: { applicationId: application.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].bulletId).toBe(bullets[0].id);
  });

  it("de-duplicates and trims matched keywords", async () => {
    const { application, bullets } = await makeBank(1);

    mockCreate.mockResolvedValue(
      anthropicJson({
        scores: [
          {
            bulletId: bullets[0].id,
            score: 70,
            matchedKeywords: ["Postgres", " Postgres ", "postgres", "", "  "],
          },
        ],
      }),
    );

    await runRelevancePass({ applicationId: application.id, jdText: JD, bullets });

    const row = await prisma.relevanceScore.findFirstOrThrow({
      where: { applicationId: application.id },
    });
    expect(row.matchedKeywords).toEqual(["Postgres"]);
  });

  it("never writes to the data bank", async () => {
    const { user, application, bullets } = await makeBank(2);
    const before = await prisma.bullet.findMany({
      where: { userId: user.id },
      orderBy: { sortOrder: "asc" },
    });

    respondWithScore(65);
    await runRelevancePass({ applicationId: application.id, jdText: JD, bullets });

    const after = await prisma.bullet.findMany({
      where: { userId: user.id },
      orderBy: { sortOrder: "asc" },
    });

    expect(after).toHaveLength(before.length);
    expect(after.map((row) => row.text)).toEqual(
      before.map((row) => row.text),
    );
    // updatedAt would move if anything had written to the row.
    expect(after.map((row) => row.updatedAt.getTime())).toEqual(
      before.map((row) => row.updatedAt.getTime()),
    );
  });

  it("refuses an empty bank without calling the model", async () => {
    const { application } = await makeBank(1);

    const outcome = await runRelevancePass({
      applicationId: application.id,
      jdText: JD,
      bullets: [],
    });

    expect(outcome.status).toBe("FAILED");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("puts a bullet added after the run at the end, marked unscored", async () => {
    const { user, experience, application, bullets } = await makeBank(2);

    respondWithScore(95);
    await runRelevancePass({ applicationId: application.id, jdText: JD, bullets });

    const added = await prisma.bullet.create({
      data: {
        userId: user.id,
        experienceId: experience.id,
        text: "Added after the scoring run.",
        sortOrder: 99,
      },
    });

    const library = await getRelevanceLibrary(user.id, application.id);

    expect(library).toHaveLength(3);
    expect(library.at(-1)?.id).toBe(added.id);
    expect(library.at(-1)?.score).toBeNull();
    expect(library.slice(0, 2).every((item) => item.score === 95)).toBe(true);
  });
});
