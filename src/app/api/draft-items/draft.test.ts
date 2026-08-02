import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireUser } = vi.hoisted(() => ({ mockRequireUser: vi.fn() }));

vi.mock("@/lib/require-user", () => ({ requireUser: mockRequireUser }));

const hasDatabase = Boolean(process.env.DATABASE_URL);

function post(body: unknown): Request {
  return new Request("http://test/api/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch(body: unknown): Request {
  return new Request("http://test/api/draft-items/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe.skipIf(!hasDatabase)("draft routes", () => {
  const userIds: string[] = [];
  let prisma: typeof import("@/lib/db").prisma;
  let addToDraft: typeof import("@/app/api/applications/[id]/draft/route").POST;
  let updateItem: typeof import("@/app/api/draft-items/[id]/route").PATCH;
  let removeItem: typeof import("@/app/api/draft-items/[id]/route").DELETE;

  /**
   * A user with two experiences of two bullets each — deliberately "two
   * resumes", since recombining across them is the point of RE-9.
   */
  async function seed() {
    const user = await prisma.user.create({
      data: { email: `vitest-draft-${crypto.randomUUID()}@example.com` },
    });
    userIds.push(user.id);
    mockRequireUser.mockResolvedValue(user);

    const make = async (title: string, sortOrder: number, texts: string[]) =>
      prisma.experience.create({
        data: {
          userId: user.id,
          kind: "JOB",
          title,
          organization: `${title} Co`,
          startDate: "Jan 2022",
          isCurrent: true,
          sortOrder,
          bullets: {
            create: texts.map((text, index) => ({
              userId: user.id,
              text,
              sortOrder: index,
            })),
          },
        },
        include: { bullets: { orderBy: { sortOrder: "asc" } } },
      });

    const resumeA = await make("Platform Engineer", 0, [
      "Ran Postgres at scale.",
      "Owned the settlement pipeline.",
    ]);
    const resumeB = await make("Barista", 1, [
      "Pulled espresso shots.",
      "Trained new staff.",
    ]);

    const application = await prisma.application.create({
      data: {
        userId: user.id,
        name: "Acme — Platform",
        jdText: "A job description long enough to be real, several times over.",
      },
    });

    return { user, resumeA, resumeB, application };
  }

  beforeEach(async () => {
    mockRequireUser.mockReset();
    ({ prisma } = await import("@/lib/db"));
    ({ POST: addToDraft } = await import(
      "@/app/api/applications/[id]/draft/route"
    ));
    ({ PATCH: updateItem, DELETE: removeItem } = await import(
      "@/app/api/draft-items/[id]/route"
    ));
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("adds an experience with one child per bullet, in library order", async () => {
    const { resumeA, application } = await seed();

    const response = await addToDraft(
      post({ kind: "EXPERIENCE", experienceId: resumeA.id }),
      context(application.id),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.item.kind).toBe("EXPERIENCE");
    expect(body.item.originalTitle).toBe("Platform Engineer");
    expect(body.item.children).toHaveLength(2);
    expect(body.item.children.map((c: { originalText: string }) => c.originalText)).toEqual([
      "Ran Postgres at scale.",
      "Owned the settlement pipeline.",
    ]);
    expect(body.item.children.map((c: { sortOrder: number }) => c.sortOrder)).toEqual([0, 1]);
  });

  it("nests a bullet from one resume under an experience from another", async () => {
    const { resumeA, resumeB, application } = await seed();

    const parent = await (
      await addToDraft(
        post({ kind: "EXPERIENCE", experienceId: resumeA.id }),
        context(application.id),
      )
    ).json();

    const response = await addToDraft(
      post({
        kind: "BULLET",
        bulletId: resumeB.bullets[0].id,
        parentDraftItemId: parent.item.id,
      }),
      context(application.id),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.item.parentDraftItemId).toBe(parent.item.id);
    expect(body.item.sourceBulletId).toBe(resumeB.bullets[0].id);

    // And it is still there when the draft is read back.
    const { getDraft } = await import("@/lib/queries/draft");
    const draft = await getDraft(
      (await prisma.application.findUniqueOrThrow({ where: { id: application.id } })).userId,
      application.id,
    );
    expect(draft[0].children).toHaveLength(3);
  });

  it("refuses the same source bullet twice", async () => {
    const { resumeA, resumeB, application } = await seed();

    const parent = await (
      await addToDraft(
        post({ kind: "EXPERIENCE", experienceId: resumeA.id }),
        context(application.id),
      )
    ).json();

    const body = { kind: "BULLET", bulletId: resumeB.bullets[0].id, parentDraftItemId: parent.item.id };
    await addToDraft(post(body), context(application.id));
    const second = await addToDraft(post(body), context(application.id));

    expect(second.status).toBe(409);
    expect((await second.json()).error).toMatch(/already in this draft/i);
    expect(
      await prisma.draftItem.count({
        where: { applicationId: application.id, sourceBulletId: resumeB.bullets[0].id },
      }),
    ).toBe(1);
  });

  it("refuses the same experience twice", async () => {
    const { resumeA, application } = await seed();

    await addToDraft(
      post({ kind: "EXPERIENCE", experienceId: resumeA.id }),
      context(application.id),
    );
    const second = await addToDraft(
      post({ kind: "EXPERIENCE", experienceId: resumeA.id }),
      context(application.id),
    );

    expect(second.status).toBe(409);
  });

  it("does not duplicate a bullet already pulled in on its own", async () => {
    const { resumeA, resumeB, application } = await seed();

    // Resume B's first bullet is added by hand under resume A's experience.
    const parent = await (
      await addToDraft(
        post({ kind: "EXPERIENCE", experienceId: resumeA.id }),
        context(application.id),
      )
    ).json();
    await addToDraft(
      post({
        kind: "BULLET",
        bulletId: resumeB.bullets[0].id,
        parentDraftItemId: parent.item.id,
      }),
      context(application.id),
    );

    // Now the whole of resume B is dragged in.
    const response = await addToDraft(
      post({ kind: "EXPERIENCE", experienceId: resumeB.id }),
      context(application.id),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.skipped).toBe(1);
    expect(body.item.children).toHaveLength(1);
    expect(
      await prisma.draftItem.count({
        where: { applicationId: application.id, sourceBulletId: resumeB.bullets[0].id },
      }),
    ).toBe(1);
  });

  it("refuses a bullet with no valid parent", async () => {
    const { resumeA, application } = await seed();

    const response = await addToDraft(
      post({ kind: "BULLET", bulletId: resumeA.bullets[0].id, parentDraftItemId: "nope" }),
      context(application.id),
    );

    expect(response.status).toBe(400);
    expect(await prisma.draftItem.count({ where: { applicationId: application.id } })).toBe(0);
  });

  it("removes an experience item and its bullets, leaving the bank alone", async () => {
    const { user, resumeA, application } = await seed();

    const parent = await (
      await addToDraft(
        post({ kind: "EXPERIENCE", experienceId: resumeA.id }),
        context(application.id),
      )
    ).json();

    const response = await removeItem(
      new Request("http://test", { method: "DELETE" }),
      context(parent.item.id),
    );

    expect(response.status).toBe(200);
    expect(
      await prisma.draftItem.count({ where: { applicationId: application.id } }),
    ).toBe(0);

    // The source rows are untouched — this is AC-6 and AC-7 together.
    expect(await prisma.experience.count({ where: { userId: user.id } })).toBe(2);
    expect(await prisma.bullet.count({ where: { userId: user.id } })).toBe(4);
  });

  it("removes a single bullet item without touching its source bullet", async () => {
    const { user, resumeA, application } = await seed();

    const parent = await (
      await addToDraft(
        post({ kind: "EXPERIENCE", experienceId: resumeA.id }),
        context(application.id),
      )
    ).json();
    const child = parent.item.children[0];

    await removeItem(
      new Request("http://test", { method: "DELETE" }),
      context(child.id),
    );

    expect(
      await prisma.draftItem.count({ where: { id: child.id } }),
    ).toBe(0);
    expect(
      await prisma.bullet.count({ where: { id: child.sourceBulletId } }),
    ).toBe(1);
    expect(await prisma.bullet.count({ where: { userId: user.id } })).toBe(4);
  });

  it("stores an edit in userText and reverts by clearing it", async () => {
    const { resumeA, application } = await seed();

    const parent = await (
      await addToDraft(
        post({ kind: "EXPERIENCE", experienceId: resumeA.id }),
        context(application.id),
      )
    ).json();
    const child = parent.item.children[0];

    await updateItem(patch({ userText: "My own wording." }), context(child.id));

    let stored = await prisma.draftItem.findUniqueOrThrow({
      where: { id: child.id },
    });
    expect(stored.userText).toBe("My own wording.");
    expect(stored.originalText).toBe("Ran Postgres at scale.");

    await updateItem(patch({ userText: null }), context(child.id));

    stored = await prisma.draftItem.findUniqueOrThrow({ where: { id: child.id } });
    expect(stored.userText).toBeNull();
    expect(stored.originalText).toBe("Ran Postgres at scale.");
  });

  it("persists a move across parents", async () => {
    const { resumeA, resumeB, application } = await seed();

    const first = await (
      await addToDraft(
        post({ kind: "EXPERIENCE", experienceId: resumeA.id }),
        context(application.id),
      )
    ).json();
    const second = await (
      await addToDraft(
        post({ kind: "EXPERIENCE", experienceId: resumeB.id }),
        context(application.id),
      )
    ).json();

    const moving = first.item.children[0];

    const response = await updateItem(
      patch({ move: { targetParentId: second.item.id, targetIndex: 0 } }),
      context(moving.id),
    );

    expect(response.status).toBe(200);

    const stored = await prisma.draftItem.findUniqueOrThrow({
      where: { id: moving.id },
    });
    expect(stored.parentDraftItemId).toBe(second.item.id);
    expect(stored.sortOrder).toBe(0);

    const siblings = await prisma.draftItem.findMany({
      where: { parentDraftItemId: second.item.id },
      orderBy: { sortOrder: "asc" },
    });
    expect(siblings.map((item) => item.sortOrder)).toEqual([0, 1, 2]);
  });

  it("refuses to move a bullet to the top level", async () => {
    const { resumeA, application } = await seed();

    const parent = await (
      await addToDraft(
        post({ kind: "EXPERIENCE", experienceId: resumeA.id }),
        context(application.id),
      )
    ).json();
    const child = parent.item.children[0];

    const response = await updateItem(
      patch({ move: { targetParentId: null, targetIndex: 0 } }),
      context(child.id),
    );

    expect(response.status).toBe(400);

    const stored = await prisma.draftItem.findUniqueOrThrow({
      where: { id: child.id },
    });
    expect(stored.parentDraftItemId).toBe(parent.item.id);
  });

  it("returns 404 for another user's application and draft item", async () => {
    const owner = await seed();
    const ownerParent = await (
      await addToDraft(
        post({ kind: "EXPERIENCE", experienceId: owner.resumeA.id }),
        context(owner.application.id),
      )
    ).json();

    // A second user takes over the mocked session.
    const stranger = await seed();

    const added = await addToDraft(
      post({ kind: "EXPERIENCE", experienceId: owner.resumeA.id }),
      context(owner.application.id),
    );
    const patched = await updateItem(
      patch({ userText: "Hijacked" }),
      context(ownerParent.item.id),
    );
    const deleted = await removeItem(
      new Request("http://test", { method: "DELETE" }),
      context(ownerParent.item.id),
    );

    expect(added.status).toBe(404);
    expect(patched.status).toBe(404);
    expect(deleted.status).toBe(404);
    expect(stranger.user.id).not.toBe(owner.user.id);

    const untouched = await prisma.draftItem.findUniqueOrThrow({
      where: { id: ownerParent.item.id },
    });
    expect(untouched.userText).toBeNull();
  });
});
