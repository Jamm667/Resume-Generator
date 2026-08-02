import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireUser } = vi.hoisted(() => ({ mockRequireUser: vi.fn() }));

vi.mock("@/lib/require-user", () => ({ requireUser: mockRequireUser }));

const hasDatabase = Boolean(process.env.DATABASE_URL);

function get(id: string, doc?: string): Request {
  const query = doc ? `?doc=${doc}` : "";
  return new Request(
    `http://test/api/applications/${id}/export/markdown${query}`,
  );
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe.skipIf(!hasDatabase)("markdown export route", () => {
  const userIds: string[] = [];
  let prisma: typeof import("@/lib/db").prisma;
  let exportMarkdown: typeof import("@/app/api/applications/[id]/export/markdown/route").GET;

  async function seed({
    withDraft = true,
    withLetter = true,
  }: { withDraft?: boolean; withLetter?: boolean } = {}) {
    const user = await prisma.user.create({
      data: { email: `vitest-export-${crypto.randomUUID()}@example.com` },
    });
    userIds.push(user.id);
    mockRequireUser.mockResolvedValue(user);

    await prisma.profile.create({
      data: {
        userId: user.id,
        fullName: "Dana Whitfield",
        email: "dana@example.com",
        links: [{ label: "LinkedIn", url: "https://linkedin.com/in/dana" }],
      },
    });

    const application = await prisma.application.create({
      data: {
        userId: user.id,
        name: "Northwind — Coordinator",
        companyName: "Northwind",
        roleTitle: "Coordinator",
        jdText: "A posting.",
        coverLetterText: withLetter ? "Dear Hiring Team,\n\nA letter." : null,
      },
    });

    if (withDraft) {
      const experience = await prisma.experience.create({
        data: {
          userId: user.id,
          kind: "PROJECT",
          title: "Side project",
          organization: "Personal",
          sortOrder: 0,
        },
      });

      await prisma.draftItem.create({
        data: {
          applicationId: application.id,
          kind: "EXPERIENCE",
          sourceExperienceId: experience.id,
          sortOrder: 0,
          originalText: "Side project",
          originalTitle: "Side project",
          organization: "Personal",
          children: {
            create: [
              {
                applicationId: application.id,
                kind: "BULLET" as const,
                sortOrder: 0,
                originalText: "Built the thing",
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
    ({ prisma } = await import("@/lib/db"));
    ({ GET: exportMarkdown } = await import(
      "@/app/api/applications/[id]/export/markdown/route"
    ));
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("serves the resume as markdown with a slugified filename", async () => {
    const { application } = await seed();

    const response = await exportMarkdown(
      get(application.id, "resume"),
      context(application.id),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/text\/markdown/);
    expect(response.headers.get("Content-Disposition")).toContain(
      'filename="northwind-coordinator-resume.md"',
    );

    const body = await response.text();
    expect(body).toContain("# Dana Whitfield");
    // The draft's source experience is a PROJECT, so it must not land under
    // Experience.
    expect(body).toContain("## Projects");
    expect(body).not.toContain("## Experience");
    expect(body).toContain("- Built the thing");
  });

  it("serves the cover letter under its own filename", async () => {
    const { application } = await seed();

    const response = await exportMarkdown(
      get(application.id, "cover-letter"),
      context(application.id),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain(
      'filename="northwind-coordinator-cover-letter.md"',
    );
    expect(await response.text()).toContain("Dear Hiring Team,");
  });

  it("still exports the resume when there is no cover letter", async () => {
    const { application } = await seed({ withLetter: false });

    const resume = await exportMarkdown(
      get(application.id, "resume"),
      context(application.id),
    );
    const letter = await exportMarkdown(
      get(application.id, "cover-letter"),
      context(application.id),
    );

    expect(resume.status).toBe(200);
    expect(letter.status).toBe(404);
  });

  it("defaults to the resume when no document is named", async () => {
    const { application } = await seed();

    const response = await exportMarkdown(
      get(application.id),
      context(application.id),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("-resume.md");
  });

  it("rejects a document it does not know how to build", async () => {
    const { application } = await seed();

    const response = await exportMarkdown(
      get(application.id, "docx"),
      context(application.id),
    );

    expect(response.status).toBe(400);
  });

  it("returns 404 for another user's application", async () => {
    const owner = await seed();
    await seed();

    const response = await exportMarkdown(
      get(owner.application.id, "resume"),
      context(owner.application.id),
    );

    expect(response.status).toBe(404);
  });
});
