import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireUser } = vi.hoisted(() => ({ mockRequireUser: vi.fn() }));

vi.mock("@/lib/require-user", () => ({ requireUser: mockRequireUser }));

const hasDatabase = Boolean(process.env.DATABASE_URL);

function get(id: string, doc?: string): Request {
  const query = doc ? `?doc=${doc}` : "";
  return new Request(`http://test/api/applications/${id}/export/pdf${query}`);
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

/** The text layer of a generated PDF, which is what an ATS would read. */
async function extractText(response: Response): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const buffer = Buffer.from(await response.arrayBuffer());
  const parser = new PDFParse({ data: buffer });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

describe.skipIf(!hasDatabase)("PDF export route", () => {
  const userIds: string[] = [];
  let prisma: typeof import("@/lib/db").prisma;
  let exportPdf: typeof import("@/app/api/applications/[id]/export/pdf/route").GET;

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
              {
                applicationId: application.id,
                kind: "BULLET" as const,
                sortOrder: 1,
                originalText: "MUST NOT APPEAR",
                tailoredText: "Rejected rewrite",
                tailorStatus: "REJECTED",
                userText: "Shipped the other thing",
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
    ({ GET: exportPdf } = await import(
      "@/app/api/applications/[id]/export/pdf/route"
    ));
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("serves the resume as a PDF with a slugified filename", async () => {
    const { application } = await seed();

    const response = await exportPdf(
      get(application.id, "resume"),
      context(application.id),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toContain(
      'filename="northwind-coordinator-resume.pdf"',
    );
  });

  it("puts selectable text in the PDF, in reading order", async () => {
    const { application } = await seed();

    const response = await exportPdf(
      get(application.id, "resume"),
      context(application.id),
    );
    const text = await extractText(response);

    expect(text).toContain("Dana Whitfield");
    // The draft's source experience is a PROJECT, so it must not land under
    // Experience.
    expect(text).toContain("Projects");
    expect(text).not.toContain("Experience");
    expect(text).toContain("Built the thing");

    // The rejected rewrite must never reach the page; the user's text does.
    expect(text).toContain("Shipped the other thing");
    expect(text).not.toContain("Rejected rewrite");
    expect(text).not.toContain("MUST NOT APPEAR");

    // Reading order: the header precedes the section, which precedes its bullets.
    expect(text.indexOf("Dana Whitfield")).toBeLessThan(text.indexOf("Projects"));
    expect(text.indexOf("Projects")).toBeLessThan(text.indexOf("Built the thing"));
    expect(text.indexOf("Built the thing")).toBeLessThan(
      text.indexOf("Shipped the other thing"),
    );
  });

  it("serves the cover letter under its own filename", async () => {
    const { application } = await seed();

    const response = await exportPdf(
      get(application.id, "cover-letter"),
      context(application.id),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain(
      'filename="northwind-coordinator-cover-letter.pdf"',
    );
    expect(await extractText(response)).toContain("Dear Hiring Team,");
  });

  it("still exports the resume when there is no cover letter", async () => {
    const { application } = await seed({ withLetter: false });

    const resume = await exportPdf(
      get(application.id, "resume"),
      context(application.id),
    );
    const letter = await exportPdf(
      get(application.id, "cover-letter"),
      context(application.id),
    );

    expect(resume.status).toBe(200);
    expect(letter.status).toBe(404);
  });

  it("defaults to the resume when no document is named", async () => {
    const { application } = await seed();

    const response = await exportPdf(
      get(application.id),
      context(application.id),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("-resume.pdf");
  });

  it("rejects a document it does not know how to build", async () => {
    const { application } = await seed();

    const response = await exportPdf(
      get(application.id, "docx"),
      context(application.id),
    );

    expect(response.status).toBe(400);
  });

  it("answers with a readable error rather than a corrupt file", async () => {
    const { user, application } = await seed();
    // A name the standard PDF fonts cannot encode.
    await prisma.profile.update({
      where: { userId: user.id },
      data: { fullName: "周雨辰" },
    });

    const response = await exportPdf(
      get(application.id, "resume"),
      context(application.id),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toMatch(/json/);
    expect((await response.json()).error).toMatch(/cannot render/i);
  });

  it("returns 404 for another user's application", async () => {
    const owner = await seed();
    await seed();

    const response = await exportPdf(
      get(owner.application.id, "resume"),
      context(owner.application.id),
    );

    expect(response.status).toBe(404);
  });
});
