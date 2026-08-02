import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireUser, mockCreate, guardCalls } = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockCreate: vi.fn(),
  guardCalls: [] as { original: string; rewrite: string }[],
}));

vi.mock("@/lib/require-user", () => ({ requireUser: mockRequireUser }));

vi.mock("@/lib/anthropic", () => ({
  getAnthropicClient: () => ({ messages: { create: mockCreate } }),
}));

// The real guard, wrapped so the tests can prove what it was asked about.
vi.mock("@/lib/tailor/numeric-guard", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/tailor/numeric-guard")>();
  return {
    ...actual,
    isFabricated: (original: string, rewrite: string) => {
      guardCalls.push({ original, rewrite });
      return actual.isFabricated(original, rewrite);
    },
  };
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

function anthropicJson(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function patch(body: unknown): Request {
  return new Request("http://test/api/draft-items/x/tailor-status", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!hasDatabase)("tailoring", () => {
  const userIds: string[] = [];
  let prisma: typeof import("@/lib/db").prisma;
  let tailor: typeof import("@/app/api/applications/[id]/tailor/route").POST;
  let decide: typeof import("@/app/api/draft-items/[id]/tailor-status/route").PATCH;

  /** One application with one experience item and two bullet items. */
  async function seed(texts = ["Led the settlement team", "Ran Postgres"]) {
    const user = await prisma.user.create({
      data: { email: `vitest-tailor-${crypto.randomUUID()}@example.com` },
    });
    userIds.push(user.id);
    mockRequireUser.mockResolvedValue(user);

    const application = await prisma.application.create({
      data: {
        userId: user.id,
        name: "Acme — Platform",
        jdText: "A posting long enough to be a real job description, twice over.",
      },
    });

    const parent = await prisma.draftItem.create({
      data: {
        applicationId: application.id,
        kind: "EXPERIENCE",
        sortOrder: 0,
        originalText: "UX Designer",
        originalTitle: "UX Designer",
        originalDateText: "Jan 2019 – Mar 2021",
        organization: "Acme Payments",
        children: {
          create: texts.map((text, index) => ({
            applicationId: application.id,
            kind: "BULLET" as const,
            sortOrder: index,
            originalText: text,
          })),
        },
      },
      include: { children: { orderBy: { sortOrder: "asc" } } },
    });

    return { user, application, parent, bullets: parent.children };
  }

  /** A well-formed response echoing whatever ids it was given. */
  function respond(
    bulletText: (id: string, index: number) => string,
    header: { title: string; dateText: string } = {
      title: "Project Coordinator",
      dateText: "2019 – 2021",
    },
  ) {
    mockCreate.mockImplementation(async (args) => {
      const content: string = args.messages[0].content;
      const bulletIds = [...content.matchAll(/<bullet id="([^"]+)"/g)].map(
        (m) => m[1],
      );
      const experienceIds = [
        ...content.matchAll(/<experience id="([^"]+)"/g),
      ].map((m) => m[1]);

      return anthropicJson({
        bullets: bulletIds.map((id, index) => ({ id, text: bulletText(id, index) })),
        experiences: experienceIds.map((id) => ({ id, ...header })),
      });
    });
  }

  beforeEach(async () => {
    mockRequireUser.mockReset();
    mockCreate.mockReset();
    guardCalls.length = 0;
    ({ prisma } = await import("@/lib/db"));
    ({ POST: tailor } = await import(
      "@/app/api/applications/[id]/tailor/route"
    ));
    ({ PATCH: decide } = await import(
      "@/app/api/draft-items/[id]/tailor-status/route"
    ));
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  const run = (applicationId: string) =>
    tailor(new Request("http://test", { method: "POST" }), context(applicationId));

  it("proposes a rewrite per bullet without touching the original", async () => {
    const { application, bullets } = await seed();
    respond(() => "Owned payments reconciliation");

    const response = await run(application.id);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "TAILORED", proposed: 2, blocked: 0 });

    const stored = await prisma.draftItem.findUniqueOrThrow({
      where: { id: bullets[0].id },
    });
    expect(stored.tailoredText).toBe("Owned payments reconciliation");
    expect(stored.tailorStatus).toBe("PROPOSED");
    expect(stored.originalText).toBe("Led the settlement team");
  });

  it("blocks a rewrite that invents a number", async () => {
    const { application, bullets } = await seed(["Led the settlement team"]);
    respond(() => "Led a team of 12 on settlement");

    const body = await (await run(application.id)).json();

    expect(body).toMatchObject({ proposed: 0, blocked: 1 });
    const stored = await prisma.draftItem.findUniqueOrThrow({
      where: { id: bullets[0].id },
    });
    expect(stored.tailorStatus).toBe("BLOCKED");
    // Kept, so the user can see what was caught.
    expect(stored.tailoredText).toBe("Led a team of 12 on settlement");
  });

  it("refuses to accept a blocked rewrite", async () => {
    const { application, bullets } = await seed(["Led the settlement team"]);
    respond(() => "Led a team of 12");
    await run(application.id);

    const response = await decide(
      patch({ tailorStatus: "ACCEPTED" }),
      context(bullets[0].id),
    );

    expect(response.status).toBe(409);
    const stored = await prisma.draftItem.findUniqueOrThrow({
      where: { id: bullets[0].id },
    });
    expect(stored.tailorStatus).toBe("BLOCKED");
  });

  it("never runs the numeric guard on a title or a date", async () => {
    const { application } = await seed(["Led the settlement team"]);
    // A title and dates full of years the source never had.
    respond(() => "Owned settlement", {
      title: "Project Coordinator 2024",
      dateText: "Jan 2015 – Dec 2024",
    });

    await run(application.id);

    const header = await prisma.draftItem.findFirstOrThrow({
      where: { applicationId: application.id, kind: "EXPERIENCE" },
    });

    // Full latitude on header fields: proposed, never blocked.
    expect(header.headerTailorStatus).toBe("PROPOSED");
    expect(header.tailoredTitle).toBe("Project Coordinator 2024");
    expect(header.tailoredDateText).toBe("Jan 2015 – Dec 2024");

    // And the guard was only ever asked about bullet text.
    expect(guardCalls).toHaveLength(1);
    expect(guardCalls[0].rewrite).toBe("Owned settlement");
    expect(
      guardCalls.some((call) => call.rewrite.includes("Project Coordinator")),
    ).toBe(false);
  });

  it("never sends the company name to the model, and never changes it", async () => {
    const { application, parent } = await seed(["Led the settlement team"]);
    respond(() => "Owned settlement");

    await run(application.id);

    const sent: string = mockCreate.mock.calls[0][0].messages[0].content;
    expect(sent).not.toContain("Acme Payments");

    const stored = await prisma.draftItem.findUniqueOrThrow({
      where: { id: parent.id },
    });
    expect(stored.organization).toBe("Acme Payments");
  });

  it("moves the two statuses independently on one item", async () => {
    const { application, parent, bullets } = await seed(["Led settlement"]);
    respond(() => "Owned settlement");
    await run(application.id);

    await decide(patch({ tailorStatus: "ACCEPTED" }), context(bullets[0].id));
    await decide(
      patch({ headerTailorStatus: "REJECTED" }),
      context(parent.id),
    );

    const bullet = await prisma.draftItem.findUniqueOrThrow({
      where: { id: bullets[0].id },
    });
    const header = await prisma.draftItem.findUniqueOrThrow({
      where: { id: parent.id },
    });

    expect(bullet.tailorStatus).toBe("ACCEPTED");
    expect(header.headerTailorStatus).toBe("REJECTED");
    // The header decision left the bullet's own status alone.
    expect(header.tailorStatus).toBe("NONE");
  });

  it("leaves every status untouched when the model fails", async () => {
    const { application, bullets } = await seed(["Led settlement"]);
    respond(() => "Owned settlement");
    await run(application.id);
    await decide(patch({ tailorStatus: "ACCEPTED" }), context(bullets[0].id));

    mockCreate.mockReset();
    mockCreate.mockRejectedValue(new Error("overloaded"));

    const response = await run(application.id);

    expect(response.status).toBe(502);
    const stored = await prisma.draftItem.findUniqueOrThrow({
      where: { id: bullets[0].id },
    });
    expect(stored.tailorStatus).toBe("ACCEPTED");
    expect(stored.tailoredText).toBe("Owned settlement");
  });

  it("re-runs from the accepted text and does not overwrite it", async () => {
    const { application, bullets } = await seed(["Led settlement"]);
    respond(() => "Owned settlement reconciliation");
    await run(application.id);
    await decide(patch({ tailorStatus: "ACCEPTED" }), context(bullets[0].id));

    // A second pass proposing something different.
    respond(() => "Something else entirely");
    await run(application.id);

    const stored = await prisma.draftItem.findUniqueOrThrow({
      where: { id: bullets[0].id },
    });
    // The accepted rewrite survived, and is what the model was shown.
    expect(stored.tailorStatus).toBe("ACCEPTED");
    expect(stored.tailoredText).toBe("Owned settlement reconciliation");

    const secondPrompt: string = mockCreate.mock.calls[1][0].messages[0].content;
    expect(secondPrompt).toContain("Owned settlement reconciliation");
  });

  it("re-proposes over a rejected bullet", async () => {
    const { application, bullets } = await seed(["Led settlement"]);
    respond(() => "First attempt");
    await run(application.id);
    await decide(patch({ tailorStatus: "REJECTED" }), context(bullets[0].id));

    respond(() => "Second attempt");
    await run(application.id);

    const stored = await prisma.draftItem.findUniqueOrThrow({
      where: { id: bullets[0].id },
    });
    expect(stored.tailorStatus).toBe("PROPOSED");
    expect(stored.tailoredText).toBe("Second attempt");
  });

  it("refuses an empty draft without calling the model", async () => {
    const user = await prisma.user.create({
      data: { email: `vitest-tailor-${crypto.randomUUID()}@example.com` },
    });
    userIds.push(user.id);
    mockRequireUser.mockResolvedValue(user);
    const application = await prisma.application.create({
      data: { userId: user.id, name: "Empty", jdText: "A posting with no draft." },
    });

    const response = await run(application.id);

    expect(response.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 404 for another user's application and draft item", async () => {
    const owner = await seed(["Led settlement"]);
    respond(() => "Owned settlement");
    await run(owner.application.id);

    await seed(["Someone else's bullet"]);

    const tailored = await run(owner.application.id);
    const decided = await decide(
      patch({ tailorStatus: "ACCEPTED" }),
      context(owner.bullets[0].id),
    );

    expect(tailored.status).toBe(404);
    expect(decided.status).toBe(404);

    const untouched = await prisma.draftItem.findUniqueOrThrow({
      where: { id: owner.bullets[0].id },
    });
    expect(untouched.tailorStatus).toBe("PROPOSED");
  });
});
