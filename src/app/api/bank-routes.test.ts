import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireUser } = vi.hoisted(() => ({ mockRequireUser: vi.fn() }));

vi.mock("@/lib/require-user", () => ({ requireUser: mockRequireUser }));

const hasDatabase = Boolean(process.env.DATABASE_URL);

function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch(url: string, body: unknown): Request {
  return new Request(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe.skipIf(!hasDatabase)("bank route handlers", () => {
  const userIds: string[] = [];
  let prisma: typeof import("@/lib/db").prisma;

  let createExperience: typeof import("@/app/api/experiences/route").POST;
  let updateExperience: typeof import("@/app/api/experiences/[id]/route").PATCH;
  let deleteExperience: typeof import("@/app/api/experiences/[id]/route").DELETE;
  let createBullet: typeof import("@/app/api/bullets/route").POST;
  let updateBullet: typeof import("@/app/api/bullets/[id]/route").PATCH;
  let deleteBullet: typeof import("@/app/api/bullets/[id]/route").DELETE;
  let resolveDuplicate: typeof import("@/app/api/bullets/[id]/dedupe/route").POST;
  let reorderBullets: typeof import("@/app/api/bullets/reorder/route").POST;

  async function makeUser() {
    const user = await prisma.user.create({
      data: { email: `vitest-bank-${crypto.randomUUID()}@example.com` },
    });
    userIds.push(user.id);
    return user;
  }

  /** An experience with two AI-extracted bullets, as RE-4 would leave it. */
  async function seedExperience(userId: string) {
    return prisma.experience.create({
      data: {
        userId,
        kind: "JOB",
        title: "Senior Engineer",
        organization: "Acme Payments",
        needsReview: true,
        sortOrder: 0,
        bullets: {
          create: [
            { userId, text: "First bullet", needsReview: true, sortOrder: 0 },
            { userId, text: "Second bullet", needsReview: true, sortOrder: 1 },
          ],
        },
      },
      include: { bullets: { orderBy: { sortOrder: "asc" } } },
    });
  }

  beforeEach(async () => {
    mockRequireUser.mockReset();
    ({ prisma } = await import("@/lib/db"));
    ({ POST: createExperience } = await import("@/app/api/experiences/route"));
    ({ PATCH: updateExperience, DELETE: deleteExperience } = await import(
      "@/app/api/experiences/[id]/route"
    ));
    ({ POST: createBullet } = await import("@/app/api/bullets/route"));
    ({ PATCH: updateBullet, DELETE: deleteBullet } = await import(
      "@/app/api/bullets/[id]/route"
    ));
    ({ POST: resolveDuplicate } = await import(
      "@/app/api/bullets/[id]/dedupe/route"
    ));
    ({ POST: reorderBullets } = await import("@/app/api/bullets/reorder/route"));
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("clears needsReview when an experience is edited", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);
    const experience = await seedExperience(user.id);

    const response = await updateExperience(
      patch("http://test/api/experiences", { title: "Staff Engineer" }),
      context(experience.id),
    );

    expect(response.status).toBe(200);

    const refreshed = await prisma.experience.findUniqueOrThrow({
      where: { id: experience.id },
    });
    expect(refreshed.title).toBe("Staff Engineer");
    expect(refreshed.needsReview).toBe(false);
  });

  it("clears needsReview when a bullet is edited", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);
    const experience = await seedExperience(user.id);

    const response = await updateBullet(
      patch("http://test/api/bullets", { text: "Corrected bullet" }),
      context(experience.bullets[0].id),
    );

    expect(response.status).toBe(200);

    const refreshed = await prisma.bullet.findUniqueOrThrow({
      where: { id: experience.bullets[0].id },
    });
    expect(refreshed.text).toBe("Corrected bullet");
    expect(refreshed.needsReview).toBe(false);
  });

  it("deletes an experience and cascades its bullets", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);
    const experience = await seedExperience(user.id);

    const response = await deleteExperience(
      new Request("http://test", { method: "DELETE" }),
      context(experience.id),
    );

    expect(response.status).toBe(200);
    expect(
      await prisma.experience.count({ where: { id: experience.id } }),
    ).toBe(0);
    expect(
      await prisma.bullet.count({ where: { experienceId: experience.id } }),
    ).toBe(0);
  });

  it("creates manual entries with no source document and no review flag", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);

    const experienceResponse = await createExperience(
      post("http://test/api/experiences", {
        kind: "PROJECT",
        title: "Resume Engine",
        organization: "Personal",
      }),
    );
    expect(experienceResponse.status).toBe(201);
    const created = await experienceResponse.json();

    expect(created.needsReview).toBe(false);
    expect(created.sourceDocumentId).toBeNull();

    const bulletResponse = await createBullet(
      post("http://test/api/bullets", {
        experienceId: created.id,
        text: "Typed by hand",
      }),
    );
    expect(bulletResponse.status).toBe(201);
    const bullet = await bulletResponse.json();
    expect(bullet.needsReview).toBe(false);
  });

  it("persists a reorder as sortOrder", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);
    const experience = await seedExperience(user.id);
    const [first, second] = experience.bullets;

    const response = await reorderBullets(
      post("http://test/api/bullets/reorder", {
        experienceId: experience.id,
        orderedIds: [second.id, first.id],
      }),
    );

    expect(response.status).toBe(200);

    const reordered = await prisma.bullet.findMany({
      where: { experienceId: experience.id },
      orderBy: { sortOrder: "asc" },
    });
    expect(reordered.map((bullet) => bullet.id)).toEqual([second.id, first.id]);
    expect(reordered.map((bullet) => bullet.sortOrder)).toEqual([0, 1]);
  });

  it("rejects a reorder that does not match the experience's bullets", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);
    const experience = await seedExperience(user.id);

    const response = await reorderBullets(
      post("http://test/api/bullets/reorder", {
        experienceId: experience.id,
        orderedIds: [experience.bullets[0].id],
      }),
    );

    expect(response.status).toBe(400);
  });

  it("keep-both clears the flag without deleting either bullet", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);
    const experience = await seedExperience(user.id);
    const [original, flagged] = experience.bullets;

    await prisma.bullet.update({
      where: { id: flagged.id },
      data: { duplicateOfBulletId: original.id },
    });

    const response = await resolveDuplicate(
      post("http://test/api/bullets/dedupe", { action: "keep-both" }),
      context(flagged.id),
    );

    expect(response.status).toBe(200);

    const refreshed = await prisma.bullet.findUniqueOrThrow({
      where: { id: flagged.id },
    });
    expect(refreshed.duplicateOfBulletId).toBeNull();
    expect(
      await prisma.bullet.count({ where: { experienceId: experience.id } }),
    ).toBe(2);
  });

  it("delete removes only the flagged bullet", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);
    const experience = await seedExperience(user.id);
    const [original, flagged] = experience.bullets;

    await prisma.bullet.update({
      where: { id: flagged.id },
      data: { duplicateOfBulletId: original.id },
    });

    const response = await resolveDuplicate(
      post("http://test/api/bullets/dedupe", { action: "delete" }),
      context(flagged.id),
    );

    expect(response.status).toBe(200);
    expect(await prisma.bullet.count({ where: { id: flagged.id } })).toBe(0);
    expect(await prisma.bullet.count({ where: { id: original.id } })).toBe(1);
  });

  it("returns 404 for every mutation against another user's rows", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const experience = await seedExperience(owner.id);
    const bullet = experience.bullets[0];

    mockRequireUser.mockResolvedValue(stranger);

    const responses = await Promise.all([
      updateExperience(
        patch("http://test", { title: "Hijacked" }),
        context(experience.id),
      ),
      deleteExperience(
        new Request("http://test", { method: "DELETE" }),
        context(experience.id),
      ),
      updateBullet(patch("http://test", { text: "Hijacked" }), context(bullet.id)),
      deleteBullet(
        new Request("http://test", { method: "DELETE" }),
        context(bullet.id),
      ),
      resolveDuplicate(
        post("http://test", { action: "delete" }),
        context(bullet.id),
      ),
      reorderBullets(
        post("http://test", {
          experienceId: experience.id,
          orderedIds: [bullet.id],
        }),
      ),
      createBullet(
        post("http://test", { experienceId: experience.id, text: "Hijacked" }),
      ),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(404);
    }

    // Nothing the stranger did touched the owner's data.
    const untouched = await prisma.experience.findUniqueOrThrow({
      where: { id: experience.id },
      include: { bullets: true },
    });
    expect(untouched.title).toBe("Senior Engineer");
    expect(untouched.bullets).toHaveLength(2);
    expect(untouched.bullets.every((b) => b.text !== "Hijacked")).toBe(true);
  });

  it("rejects empty text rather than storing it", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);
    const experience = await seedExperience(user.id);

    const bulletResponse = await updateBullet(
      patch("http://test", { text: "   " }),
      context(experience.bullets[0].id),
    );
    expect(bulletResponse.status).toBe(400);

    const experienceResponse = await updateExperience(
      patch("http://test", { title: "  " }),
      context(experience.id),
    );
    expect(experienceResponse.status).toBe(400);
  });
});
