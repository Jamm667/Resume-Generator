import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { draftToText, profileToText, wordCount } from "@/lib/cover-letter";
import { coverLetterUserPrompt } from "@/lib/cover-letter/prompt";

const { mockRequireUser, mockCreate } = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock("@/lib/require-user", () => ({ requireUser: mockRequireUser }));
vi.mock("@/lib/anthropic", () => ({
  getAnthropicClient: () => ({ messages: { create: mockCreate } }),
}));

const hasDatabase = Boolean(process.env.DATABASE_URL);

function anthropicText(text: string) {
  return { content: [{ type: "text", text }] };
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function post(body: unknown): Request {
  return new Request("http://test/api/applications/x/cover-letter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch(body: unknown): Request {
  return new Request("http://test/api/applications/x/cover-letter", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Building the payload — pure, so no database needed
// ---------------------------------------------------------------------------

/** A draft item shaped like Prisma's, with only the fields these use. */
function item(overrides: Record<string, unknown>) {
  return {
    id: "x",
    kind: "BULLET",
    parentDraftItemId: "parent",
    sortOrder: 0,
    originalText: "Original text",
    tailoredText: null,
    userText: null,
    tailorStatus: "NONE",
    originalTitle: null,
    tailoredTitle: null,
    userTitle: null,
    originalDateText: null,
    tailoredDateText: null,
    userDateText: null,
    organization: null,
    headerTailorStatus: "NONE",
    ...overrides,
  } as unknown as Parameters<typeof draftToText>[0][number];
}

describe("draftToText", () => {
  const parent = item({
    id: "parent",
    kind: "EXPERIENCE",
    parentDraftItemId: null,
    originalText: "Engineer",
    originalTitle: "Engineer",
    originalDateText: "2020 – 2022",
    organization: "Acme",
  });

  it("uses the accepted rewrite for an accepted bullet", () => {
    const text = draftToText([
      parent,
      item({
        id: "b1",
        originalText: "Ran the pipeline",
        tailoredText: "Owned payments reconciliation",
        tailorStatus: "ACCEPTED",
      }),
    ]);

    expect(text).toContain("Owned payments reconciliation");
    expect(text).not.toContain("Ran the pipeline");
  });

  it("uses the user's own text for a rejected bullet", () => {
    const text = draftToText([
      parent,
      item({
        id: "b1",
        originalText: "Ran the pipeline",
        userText: "Ran the payments pipeline",
        tailoredText: "Something the user said no to",
        tailorStatus: "REJECTED",
      }),
    ]);

    expect(text).toContain("Ran the payments pipeline");
    expect(text).not.toContain("Something the user said no to");
  });

  it("falls back to the original when there is neither", () => {
    const text = draftToText([parent, item({ id: "b1" })]);
    expect(text).toContain("Original text");
  });

  it("uses an accepted title and keeps the company name", () => {
    const text = draftToText([
      {
        ...parent,
        tailoredTitle: "Project Coordinator",
        headerTailorStatus: "ACCEPTED",
      } as typeof parent,
      item({ id: "b1" }),
    ]);

    expect(text).toContain("Project Coordinator");
    expect(text).toContain("Acme");
  });

  it("keeps bullets under their own experience, in order", () => {
    const second = item({
      id: "parent2",
      kind: "EXPERIENCE",
      parentDraftItemId: null,
      sortOrder: 1,
      originalText: "Barista",
      originalTitle: "Barista",
    });

    const text = draftToText([
      parent,
      second,
      item({ id: "b2", parentDraftItemId: "parent", sortOrder: 1, originalText: "Second" }),
      item({ id: "b1", parentDraftItemId: "parent", sortOrder: 0, originalText: "First" }),
      item({ id: "b3", parentDraftItemId: "parent2", originalText: "Espresso" }),
    ]);

    expect(text.indexOf("First")).toBeLessThan(text.indexOf("Second"));
    expect(text.indexOf("Second")).toBeLessThan(text.indexOf("Espresso"));
  });
});

describe("profileToText", () => {
  it("says so when there is no profile", () => {
    expect(profileToText(null)).toMatch(/no profile/i);
  });

  it("leaves absent fields out entirely", () => {
    const text = profileToText({
      fullName: "Dana Whitfield",
      headline: null,
      location: null,
      email: "dana@example.com",
      phone: null,
      links: [],
    } as unknown as Parameters<typeof profileToText>[0]);

    expect(text).toContain("Dana Whitfield");
    expect(text).toContain("dana@example.com");
    expect(text).not.toContain("Headline");
    expect(text).not.toContain("Phone");
  });
});

describe("coverLetterUserPrompt", () => {
  const base = {
    companyName: "Northwind",
    roleTitle: "Coordinator",
    jdText: "A posting",
    profile: "Name: Dana",
    draft: "- A bullet",
  };

  it("carries the chosen tone into the prompt", () => {
    expect(coverLetterUserPrompt({ ...base, tone: "DIRECT" })).toMatch(
      /short sentences/i,
    );
    expect(coverLetterUserPrompt({ ...base, tone: "FORMAL" })).toMatch(
      /no contractions/,
    );
    expect(
      coverLetterUserPrompt({ ...base, tone: "CONVERSATIONAL" }),
    ).toMatch(/contractions welcome/);
  });

  it("includes the draft, the profile, and the posting", () => {
    const prompt = coverLetterUserPrompt({ ...base, tone: "DIRECT" });
    expect(prompt).toContain("A bullet");
    expect(prompt).toContain("Name: Dana");
    expect(prompt).toContain("A posting");
  });
});

describe("wordCount", () => {
  it("counts words, not characters", () => {
    expect(wordCount("one two three")).toBe(3);
    expect(wordCount("  padded   out  ")).toBe(2);
    expect(wordCount("")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Routes — require a database
// ---------------------------------------------------------------------------

describe.skipIf(!hasDatabase)("cover letter routes", () => {
  const userIds: string[] = [];
  let prisma: typeof import("@/lib/db").prisma;
  let generate: typeof import("@/app/api/applications/[id]/cover-letter/route").POST;
  let edit: typeof import("@/app/api/applications/[id]/cover-letter/route").PATCH;

  async function seed({ withDraft = true } = {}) {
    const user = await prisma.user.create({
      data: { email: `vitest-letter-${crypto.randomUUID()}@example.com` },
    });
    userIds.push(user.id);
    mockRequireUser.mockResolvedValue(user);

    const application = await prisma.application.create({
      data: {
        userId: user.id,
        name: "Northwind — Coordinator",
        companyName: "Northwind",
        roleTitle: "Coordinator",
        jdText: "A job description long enough to look like a real posting.",
      },
    });

    if (withDraft) {
      await prisma.draftItem.create({
        data: {
          applicationId: application.id,
          kind: "EXPERIENCE",
          sortOrder: 0,
          originalText: "Engineer",
          originalTitle: "Engineer",
          organization: "Acme",
          children: {
            create: [
              {
                applicationId: application.id,
                kind: "BULLET" as const,
                sortOrder: 0,
                originalText: "Ran the settlement pipeline",
              },
            ],
          },
        },
      });
    }

    return { user, application };
  }

  beforeEach(async () => {
    mockRequireUser.mockReset();
    mockCreate.mockReset();
    ({ prisma } = await import("@/lib/db"));
    ({ POST: generate, PATCH: edit } = await import(
      "@/app/api/applications/[id]/cover-letter/route"
    ));
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("stores the letter and the tone", async () => {
    const { application } = await seed();
    mockCreate.mockResolvedValue(anthropicText("Dear Hiring Team, a letter."));

    const response = await generate(
      post({ tone: "DIRECT" }),
      context(application.id),
    );

    expect(response.status).toBe(200);

    const stored = await prisma.application.findUniqueOrThrow({
      where: { id: application.id },
    });
    expect(stored.coverLetterText).toBe("Dear Hiring Team, a letter.");
    expect(stored.coverLetterTone).toBe("DIRECT");
  });

  it("sends the draft's effective text to the model", async () => {
    const { application } = await seed();
    mockCreate.mockResolvedValue(anthropicText("A letter."));

    await generate(post({ tone: "FORMAL" }), context(application.id));

    const sent: string = mockCreate.mock.calls[0][0].messages[0].content;
    expect(sent).toContain("Ran the settlement pipeline");
    expect(sent).toContain("Northwind");
  });

  it("refuses an empty draft without calling the model", async () => {
    const { application } = await seed({ withDraft: false });

    const response = await generate(
      post({ tone: "DIRECT" }),
      context(application.id),
    );

    expect(response.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects an unknown tone", async () => {
    const { application } = await seed();

    const response = await generate(
      post({ tone: "SNARKY" }),
      context(application.id),
    );

    expect(response.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("leaves an existing letter intact when the model fails", async () => {
    const { application } = await seed();
    mockCreate.mockResolvedValue(anthropicText("The first letter."));
    await generate(post({ tone: "DIRECT" }), context(application.id));

    mockCreate.mockReset();
    mockCreate.mockRejectedValue(new Error("overloaded"));

    const response = await generate(
      post({ tone: "FORMAL" }),
      context(application.id),
    );

    expect(response.status).toBe(502);
    const stored = await prisma.application.findUniqueOrThrow({
      where: { id: application.id },
    });
    expect(stored.coverLetterText).toBe("The first letter.");
    expect(stored.coverLetterTone).toBe("DIRECT");
  });

  it("treats an empty response as a failure rather than wiping the letter", async () => {
    const { application } = await seed();
    mockCreate.mockResolvedValue(anthropicText("The first letter."));
    await generate(post({ tone: "DIRECT" }), context(application.id));

    mockCreate.mockResolvedValue(anthropicText("   "));
    const response = await generate(
      post({ tone: "DIRECT" }),
      context(application.id),
    );

    expect(response.status).toBe(502);
    const stored = await prisma.application.findUniqueOrThrow({
      where: { id: application.id },
    });
    expect(stored.coverLetterText).toBe("The first letter.");
  });

  it("saves an edit", async () => {
    const { application } = await seed();
    mockCreate.mockResolvedValue(anthropicText("Generated."));
    await generate(post({ tone: "DIRECT" }), context(application.id));

    const response = await edit(
      patch({ coverLetterText: "My own wording." }),
      context(application.id),
    );

    expect(response.status).toBe(200);
    const stored = await prisma.application.findUniqueOrThrow({
      where: { id: application.id },
    });
    expect(stored.coverLetterText).toBe("My own wording.");
    // The tone the letter was written with is untouched by an edit.
    expect(stored.coverLetterTone).toBe("DIRECT");
  });

  it("returns 404 for another user's application", async () => {
    const owner = await seed();
    mockCreate.mockResolvedValue(anthropicText("Owner's letter."));
    await generate(post({ tone: "DIRECT" }), context(owner.application.id));

    await seed();

    const generated = await generate(
      post({ tone: "DIRECT" }),
      context(owner.application.id),
    );
    const edited = await edit(
      patch({ coverLetterText: "Hijacked" }),
      context(owner.application.id),
    );

    expect(generated.status).toBe(404);
    expect(edited.status).toBe(404);

    const stored = await prisma.application.findUniqueOrThrow({
      where: { id: owner.application.id },
    });
    expect(stored.coverLetterText).toBe("Owner's letter.");
  });
});
