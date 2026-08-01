import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DUPLICATE_THRESHOLD,
  findDuplicate,
  jaccardSimilarity,
  normalizeBullet,
} from "@/lib/structure/dedupe";
import {
  coerceKind,
  structuredResponseJsonSchema,
  structuredResponseSchema,
} from "@/lib/structure/schema";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("@/lib/anthropic", () => ({
  getAnthropicClient: () => ({ messages: { create: mockCreate } }),
}));

const hasDatabase = Boolean(process.env.DATABASE_URL);

function payload(overrides: Record<string, unknown> = {}) {
  return {
    profile: {
      fullName: "Dana Whitfield",
      email: "dana@example.com",
      phone: null,
      location: "Toronto, ON",
      headline: "Senior Platform Engineer",
      links: [],
    },
    experiences: [
      {
        kind: "JOB",
        title: "Senior Engineer",
        organization: "Acme Payments",
        location: "Toronto, ON",
        startDate: "Jan 2022",
        endDate: null,
        isCurrent: true,
        summary: null,
        bullets: [
          "Cut checkout latency by 40 percent by batching settlement calls.",
          "Led migration of twelve services onto a shared authentication layer.",
        ],
      },
    ],
    ...overrides,
  };
}

function anthropicJson(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("structuredResponseSchema", () => {
  it("accepts a well-formed payload", () => {
    const parsed = structuredResponseSchema.parse(payload());
    expect(parsed.experiences).toHaveLength(1);
    expect(parsed.experiences[0].kind).toBe("JOB");
    expect(parsed.experiences[0].bullets).toHaveLength(2);
  });

  it("rejects a malformed payload", () => {
    expect(() =>
      structuredResponseSchema.parse({ profile: {}, experiences: "nope" }),
    ).toThrow();

    expect(() =>
      structuredResponseSchema.parse(
        payload({
          experiences: [
            { kind: "JOB", title: "Engineer" /* missing required fields */ },
          ],
        }),
      ),
    ).toThrow();
  });

  it("coerces an unknown kind to JOB instead of persisting a new value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const parsed = structuredResponseSchema.parse(
      payload({
        experiences: [{ ...payload().experiences[0], kind: "VOLUNTEERING" }],
      }),
    );

    expect(parsed.experiences[0].kind).toBe("JOB");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("coerces directly too, for every unexpected shape", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(coerceKind("EDUCATION")).toBe("EDUCATION");
    expect(coerceKind("internship")).toBe("JOB");
    expect(coerceKind(null)).toBe("JOB");
    expect(coerceKind(42)).toBe("JOB");
    warn.mockRestore();
  });

  it("produces a JSON schema the constrained decoder will accept", () => {
    const schema = structuredResponseJsonSchema();
    expect(schema.$schema).toBeUndefined();
    expect(schema.type).toBe("object");

    const experiences = (schema.properties as Record<string, never>)
      .experiences as Record<string, unknown>;
    const items = experiences.items as Record<string, unknown>;
    expect(items.additionalProperties).toBe(false);
    expect((items.properties as Record<string, Record<string, unknown>>).kind.enum).toEqual([
      "JOB",
      "PROJECT",
      "EDUCATION",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Dedupe
// ---------------------------------------------------------------------------

describe("dedupe similarity", () => {
  it("normalizes case, punctuation, and whitespace", () => {
    expect(normalizeBullet("  Cut  LATENCY by 40%, quickly! ")).toBe(
      "cut latency by 40 quickly",
    );
  });

  it("scores identical text as 1 and unrelated text near 0", () => {
    const a = "Led migration of twelve services onto a shared auth layer";
    expect(jaccardSimilarity(a, a)).toBe(1);
    expect(jaccardSimilarity(a, "Baked a sourdough loaf on Sunday")).toBeLessThan(0.1);
  });

  it("ignores token order", () => {
    expect(jaccardSimilarity("alpha beta gamma", "gamma beta alpha")).toBe(1);
  });

  it("treats a punctuation-only edit as a duplicate", () => {
    const score = jaccardSimilarity(
      "Cut checkout latency by 40 percent by batching settlement calls.",
      "Cut checkout latency by 40 percent, by batching settlement calls",
    );
    expect(score).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
  });

  it("separates a near-miss above the threshold from one below it", () => {
    const base = "one two three four five six seven eight nine ten";

    // 10 of 11 tokens shared -> 10/11 = 0.909, at or above 0.85
    const above = "one two three four five six seven eight nine ten eleven";
    expect(jaccardSimilarity(base, above)).toBeGreaterThanOrEqual(
      DUPLICATE_THRESHOLD,
    );

    // 8 of 12 shared -> 8/12 = 0.667, below 0.85
    const below = "one two three four five six seven eight alpha beta gamma delta";
    expect(jaccardSimilarity(base, below)).toBeLessThan(DUPLICATE_THRESHOLD);
  });

  it("picks the best match and returns null when nothing clears the bar", () => {
    const existing = [
      { id: "a", text: "Cut checkout latency by batching settlement calls" },
      { id: "b", text: "Completely unrelated sentence about gardening" },
    ];

    expect(
      findDuplicate("Cut checkout latency by batching settlement calls", existing)?.id,
    ).toBe("a");
    expect(findDuplicate("Something else entirely, unrelated", existing)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Persistence — requires a database
// ---------------------------------------------------------------------------

describe.skipIf(!hasDatabase)("structureDocument", () => {
  const created: string[] = [];
  let prisma: typeof import("@/lib/db").prisma;
  let structureDocument: typeof import("@/lib/structure").structureDocument;

  async function makeUser() {
    ({ prisma } = await import("@/lib/db"));
    const user = await prisma.user.create({
      data: { email: `vitest-structure-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user;
  }

  async function makeDocument(userId: string, rawText: string) {
    return prisma.sourceDocument.create({
      data: {
        userId,
        filename: "resume.pdf",
        mimeType: "application/pdf",
        rawText,
        extractionMethod: "TEXT_LAYER",
        parseStatus: "EXTRACTED",
      },
    });
  }

  beforeEach(async () => {
    mockCreate.mockReset();
    ({ prisma } = await import("@/lib/db"));
    ({ structureDocument } = await import("@/lib/structure"));
  });

  afterAll(async () => {
    if (created.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: created } } });
    }
    await prisma.$disconnect();
  });

  it("persists experiences and bullets, all needing review", async () => {
    mockCreate.mockResolvedValue(anthropicJson(payload()));

    const user = await makeUser();
    const document = await makeDocument(user.id, "resume text");

    const outcome = await structureDocument(document.id, user.id);

    expect(outcome.status).toBe("STRUCTURED");
    if (outcome.status !== "STRUCTURED") return;
    expect(outcome.experiences).toBe(1);
    expect(outcome.bullets).toBe(2);

    const experiences = await prisma.experience.findMany({
      where: { userId: user.id },
      include: { bullets: { orderBy: { sortOrder: "asc" } } },
    });

    expect(experiences).toHaveLength(1);
    expect(experiences[0].needsReview).toBe(true);
    expect(experiences[0].sourceDocumentId).toBe(document.id);
    expect(experiences[0].isCurrent).toBe(true);
    expect(experiences[0].endDate).toBeNull();
    expect(experiences[0].bullets.map((b) => b.needsReview)).toEqual([true, true]);
    expect(experiences[0].bullets[0].text).toContain("Cut checkout latency");

    const refreshed = await prisma.sourceDocument.findUniqueOrThrow({
      where: { id: document.id },
    });
    expect(refreshed.parseStatus).toBe("STRUCTURED");
  });

  it("creates zero EDUCATION rows when the resume has no education section", async () => {
    mockCreate.mockResolvedValue(anthropicJson(payload()));

    const user = await makeUser();
    const document = await makeDocument(user.id, "resume text without education");

    await structureDocument(document.id, user.id);

    const education = await prisma.experience.count({
      where: { userId: user.id, kind: "EDUCATION" },
    });
    expect(education).toBe(0);
  });

  it("flags every bullet of a re-uploaded resume as a duplicate", async () => {
    mockCreate.mockResolvedValue(anthropicJson(payload()));

    const user = await makeUser();
    const first = await makeDocument(user.id, "resume text");
    await structureDocument(first.id, user.id);

    const second = await makeDocument(user.id, "resume text");
    const outcome = await structureDocument(second.id, user.id);

    expect(outcome.status).toBe("STRUCTURED");
    if (outcome.status !== "STRUCTURED") return;
    expect(outcome.duplicates).toBe(2);

    const secondBullets = await prisma.bullet.findMany({
      where: { userId: user.id, experience: { sourceDocumentId: second.id } },
    });

    expect(secondBullets).toHaveLength(2);
    for (const bullet of secondBullets) {
      expect(bullet.duplicateOfBulletId).not.toBeNull();
    }

    // Nothing is merged or removed — both copies survive.
    expect(await prisma.bullet.count({ where: { userId: user.id } })).toBe(4);

    const firstBullets = await prisma.bullet.findMany({
      where: { userId: user.id, experience: { sourceDocumentId: first.id } },
    });
    for (const bullet of firstBullets) {
      expect(bullet.duplicateOfBulletId).toBeNull();
    }
  });

  it("fills only the profile fields that are still empty", async () => {
    mockCreate.mockResolvedValue(anthropicJson(payload()));

    const user = await makeUser();
    await prisma.profile.create({
      data: { userId: user.id, phone: "+1 555 9999" },
    });

    const document = await makeDocument(user.id, "resume text");
    await structureDocument(document.id, user.id);

    const profile = await prisma.profile.findUniqueOrThrow({
      where: { userId: user.id },
    });

    // Pre-existing value survives; empty ones get filled.
    expect(profile.phone).toBe("+1 555 9999");
    expect(profile.fullName).toBe("Dana Whitfield");
    expect(profile.email).toBe("dana@example.com");
  });

  it("retries once, then fails with zero rows written", async () => {
    mockCreate.mockResolvedValue(anthropicJson({ profile: {}, experiences: "bad" }));

    const user = await makeUser();
    const document = await makeDocument(user.id, "resume text");

    const outcome = await structureDocument(document.id, user.id);

    expect(outcome.status).toBe("FAILED");
    expect(mockCreate).toHaveBeenCalledTimes(2);

    expect(await prisma.experience.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.bullet.count({ where: { userId: user.id } })).toBe(0);

    const refreshed = await prisma.sourceDocument.findUniqueOrThrow({
      where: { id: document.id },
    });
    expect(refreshed.parseStatus).toBe("FAILED");
    expect(refreshed.parseError).toMatch(/retried/i);
  });

  it("recovers on the second attempt when the first response is invalid", async () => {
    mockCreate
      .mockResolvedValueOnce(anthropicJson({ nonsense: true }))
      .mockResolvedValueOnce(anthropicJson(payload()));

    const user = await makeUser();
    const document = await makeDocument(user.id, "resume text");

    const outcome = await structureDocument(document.id, user.id);

    expect(outcome.status).toBe("STRUCTURED");
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(await prisma.experience.count({ where: { userId: user.id } })).toBe(1);
  });

  it("does not touch another user's document", async () => {
    mockCreate.mockResolvedValue(anthropicJson(payload()));

    const owner = await makeUser();
    const stranger = await makeUser();
    const document = await makeDocument(owner.id, "resume text");

    const outcome = await structureDocument(document.id, stranger.id);

    expect(outcome.status).toBe("FAILED");
    expect(await prisma.experience.count({ where: { userId: owner.id } })).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
