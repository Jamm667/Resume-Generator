import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// These exercise real SQL — grouping, ordering, nesting, and cascade deletes
// are database behavior, not logic a mock would prove anything about.
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("data model queries", () => {
  let prisma: PrismaClient;
  let getBankForUser: typeof import("@/lib/queries/bank").getBankForUser;
  let getApplication: typeof import("@/lib/queries/applications").getApplication;

  let userId: string;
  let otherUserId: string;
  let applicationId: string;

  // Unique per run so a failed run never collides with the next one, and so
  // this can never touch a real account.
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `vitest-${suffix}@resume-engine.test`;
  const otherEmail = `vitest-other-${suffix}@resume-engine.test`;

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    ({ getBankForUser } = await import("@/lib/queries/bank"));
    ({ getApplication } = await import("@/lib/queries/applications"));

    const user = await prisma.user.create({
      data: {
        email,
        name: "Vitest User",
        profile: {
          create: {
            fullName: "Vitest User",
            links: [{ label: "GitHub", url: "https://github.com/vitest" }],
          },
        },
      },
    });
    userId = user.id;

    const other = await prisma.user.create({ data: { email: otherEmail } });
    otherUserId = other.id;

    const document = await prisma.sourceDocument.create({
      data: {
        userId,
        filename: "resume.pdf",
        mimeType: "application/pdf",
        extractionMethod: "TEXT_LAYER",
        parseStatus: "PENDING",
      },
    });

    // Deliberately inserted out of order so an ordered result proves the
    // orderBy rather than insertion order.
    const job = await prisma.experience.create({
      data: {
        userId,
        sourceDocumentId: document.id,
        kind: "JOB",
        title: "Senior Engineer",
        organization: "Acme",
        sortOrder: 1,
        bullets: {
          create: [
            { userId, text: "second bullet", sortOrder: 1 },
            { userId, text: "first bullet", sortOrder: 0 },
          ],
        },
      },
    });

    await prisma.experience.create({
      data: {
        userId,
        kind: "JOB",
        title: "Junior Engineer",
        organization: "Initech",
        sortOrder: 0,
      },
    });

    await prisma.experience.create({
      data: {
        userId,
        kind: "PROJECT",
        title: "Resume Engine",
        organization: "Personal",
        sortOrder: 0,
      },
    });

    await prisma.experience.create({
      data: {
        userId,
        kind: "EDUCATION",
        title: "BSc",
        organization: "UofT",
        sortOrder: 0,
      },
    });

    const application = await prisma.application.create({
      data: {
        userId,
        name: "Globex",
        jdText: "Staff engineer wanted.",
      },
    });
    applicationId = application.id;

    const header = await prisma.draftItem.create({
      data: {
        applicationId,
        kind: "EXPERIENCE",
        sourceExperienceId: job.id,
        sortOrder: 0,
        originalText: "Senior Engineer at Acme",
        originalTitle: "Senior Engineer",
        organization: "Acme",
      },
    });

    await prisma.draftItem.create({
      data: {
        applicationId,
        kind: "BULLET",
        parentDraftItemId: header.id,
        sortOrder: 1,
        originalText: "child two",
      },
    });

    await prisma.draftItem.create({
      data: {
        applicationId,
        kind: "BULLET",
        parentDraftItemId: header.id,
        sortOrder: 0,
        originalText: "child one",
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
    await prisma.$disconnect();
  });

  it("groups the bank by kind with every list in sortOrder", async () => {
    const bank = await getBankForUser(userId);

    expect(Object.keys(bank).sort()).toEqual(["EDUCATION", "JOB", "PROJECT"]);
    expect(bank.JOB.map((e) => e.title)).toEqual([
      "Junior Engineer",
      "Senior Engineer",
    ]);
    expect(bank.PROJECT).toHaveLength(1);
    expect(bank.EDUCATION).toHaveLength(1);
  });

  it("nests bullets under their experience in sortOrder", async () => {
    const bank = await getBankForUser(userId);
    const senior = bank.JOB.find((e) => e.title === "Senior Engineer");

    expect(senior?.bullets.map((b) => b.text)).toEqual([
      "first bullet",
      "second bullet",
    ]);
  });

  it("returns an empty group rather than a missing key", async () => {
    const bank = await getBankForUser(otherUserId);

    expect(bank.JOB).toEqual([]);
    expect(bank.PROJECT).toEqual([]);
    expect(bank.EDUCATION).toEqual([]);
  });

  it("nests draft bullets under their parent experience item, ordered", async () => {
    const application = await getApplication(userId, applicationId);

    expect(application).not.toBeNull();
    expect(application?.draftItems).toHaveLength(1);

    const [header] = application!.draftItems;
    expect(header.kind).toBe("EXPERIENCE");
    expect(header.children.map((c) => c.originalText)).toEqual([
      "child one",
      "child two",
    ]);
  });

  it("does not return another user's application", async () => {
    await expect(getApplication(otherUserId, applicationId)).resolves.toBeNull();
  });

  it("cascades every owned row away when the user is deleted", async () => {
    const doomed = await prisma.user.create({
      data: { email: `vitest-cascade-${suffix}@resume-engine.test` },
    });

    const experience = await prisma.experience.create({
      data: {
        userId: doomed.id,
        kind: "JOB",
        title: "Temp",
        organization: "Temp Co",
        bullets: { create: [{ userId: doomed.id, text: "temp bullet" }] },
      },
    });

    const application = await prisma.application.create({
      data: { userId: doomed.id, name: "Temp App", jdText: "jd" },
    });

    const bullet = await prisma.bullet.findFirstOrThrow({
      where: { experienceId: experience.id },
    });

    await prisma.draftItem.create({
      data: {
        applicationId: application.id,
        kind: "BULLET",
        originalText: "temp draft",
      },
    });

    await prisma.relevanceScore.create({
      data: {
        applicationId: application.id,
        bulletId: bullet.id,
        score: 80,
        matchedKeywords: ["temp"],
      },
    });

    await prisma.profile.create({
      data: { userId: doomed.id, fullName: "Temp" },
    });

    await prisma.sourceDocument.create({
      data: {
        userId: doomed.id,
        filename: "temp.pdf",
        mimeType: "application/pdf",
        extractionMethod: "PASTED",
      },
    });

    await prisma.user.delete({ where: { id: doomed.id } });

    expect(await prisma.profile.count({ where: { userId: doomed.id } })).toBe(0);
    expect(
      await prisma.sourceDocument.count({ where: { userId: doomed.id } }),
    ).toBe(0);
    expect(
      await prisma.experience.count({ where: { userId: doomed.id } }),
    ).toBe(0);
    expect(await prisma.bullet.count({ where: { userId: doomed.id } })).toBe(0);
    expect(
      await prisma.application.count({ where: { userId: doomed.id } }),
    ).toBe(0);
    expect(
      await prisma.draftItem.count({
        where: { applicationId: application.id },
      }),
    ).toBe(0);
    expect(
      await prisma.relevanceScore.count({
        where: { applicationId: application.id },
      }),
    ).toBe(0);
  });
});
