import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireUser, mockInfer } = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockInfer: vi.fn(),
}));

vi.mock("@/lib/require-user", () => ({ requireUser: mockRequireUser }));
vi.mock("@/lib/jd/infer-company-role", () => ({
  inferCompanyAndRole: mockInfer,
  JD_INFERENCE_CHARS: 4000,
}));

// Imported from its own module, not the route: a Next.js route file may only
// export route handlers, and `next build` fails the route type check otherwise.
import { defaultApplicationName } from "@/lib/applications/naming";

const hasDatabase = Boolean(process.env.DATABASE_URL);

/** Long enough to clear the 100-character floor. */
const JD = `We are hiring a Senior Platform Engineer at Globex Analytics. You will own the
payments pipeline end to end, working across ingestion, reconciliation, and
reporting. Experience with Postgres and distributed systems is expected.`;

function post(body: unknown): Request {
  return new Request("http://test/api/applications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch(body: unknown): Request {
  return new Request("http://test/api/applications/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

describe("defaultApplicationName", () => {
  it("joins company and role when both are known", () => {
    expect(defaultApplicationName("Globex", "Senior Engineer", JD)).toBe(
      "Globex — Senior Engineer",
    );
  });

  it("uses whichever one is known on its own", () => {
    expect(defaultApplicationName("Globex", null, JD)).toBe("Globex");
    expect(defaultApplicationName(null, "Senior Engineer", JD)).toBe(
      "Senior Engineer",
    );
  });

  it("falls back to the opening of the JD, collapsed and truncated", () => {
    const name = defaultApplicationName(null, null, JD);
    expect(name.startsWith("We are hiring a Senior Platform Engineer")).toBe(true);
    expect(name.length).toBeLessThanOrEqual(61); // 60 plus the ellipsis
    expect(name).not.toContain("\n");
  });

  it("does not add an ellipsis to a short JD", () => {
    expect(defaultApplicationName(null, null, "Short posting")).toBe(
      "Short posting",
    );
  });
});

// ---------------------------------------------------------------------------
// Routes — require a database
// ---------------------------------------------------------------------------

describe.skipIf(!hasDatabase)("application routes", () => {
  const userIds: string[] = [];
  let prisma: typeof import("@/lib/db").prisma;
  let create: typeof import("@/app/api/applications/route").POST;
  let update: typeof import("@/app/api/applications/[id]/route").PATCH;
  let remove: typeof import("@/app/api/applications/[id]/route").DELETE;

  async function makeUser() {
    const user = await prisma.user.create({
      data: { email: `vitest-apps-${crypto.randomUUID()}@example.com` },
    });
    userIds.push(user.id);
    return user;
  }

  beforeEach(async () => {
    mockRequireUser.mockReset();
    mockInfer.mockReset();
    mockInfer.mockResolvedValue({ companyName: null, roleTitle: null });
    ({ prisma } = await import("@/lib/db"));
    ({ POST: create } = await import("@/app/api/applications/route"));
    ({ PATCH: update, DELETE: remove } = await import(
      "@/app/api/applications/[id]/route"
    ));
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("rejects a JD under 100 characters and creates nothing", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);

    const response = await create(post({ jdText: "hi" }));

    expect(response.status).toBe(400);
    expect((await response.json()).errors.jdText).toMatch(/at least 100/i);
    expect(await prisma.application.count({ where: { userId: user.id } })).toBe(0);
    // Nothing was worth asking the model about either.
    expect(mockInfer).not.toHaveBeenCalled();
  });

  it("fills blank company and role from inference", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);
    mockInfer.mockResolvedValue({
      companyName: "Globex Analytics",
      roleTitle: "Senior Platform Engineer",
    });

    const response = await create(post({ jdText: JD }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.companyName).toBe("Globex Analytics");
    expect(body.roleTitle).toBe("Senior Platform Engineer");
    expect(body.name).toBe("Globex Analytics — Senior Platform Engineer");
  });

  it("never overwrites company or role the user typed", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);
    mockInfer.mockResolvedValue({
      companyName: "Wrong Corp",
      roleTitle: "Wrong Title",
    });

    const response = await create(
      post({ jdText: JD, companyName: "My Company", roleTitle: "My Role" }),
    );
    const body = await response.json();

    expect(body.companyName).toBe("My Company");
    expect(body.roleTitle).toBe("My Role");
    // Both were supplied, so there was nothing to infer.
    expect(mockInfer).not.toHaveBeenCalled();
  });

  it("infers only the field the user left blank", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);
    mockInfer.mockResolvedValue({
      companyName: "Inferred Corp",
      roleTitle: "Inferred Role",
    });

    const response = await create(
      post({ jdText: JD, companyName: "My Company" }),
    );
    const body = await response.json();

    expect(body.companyName).toBe("My Company");
    expect(body.roleTitle).toBe("Inferred Role");
  });

  it("still creates the application when inference fails", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);
    // The real implementation swallows errors and returns nulls.
    mockInfer.mockResolvedValue({ companyName: null, roleTitle: null });

    const response = await create(post({ jdText: JD }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.companyName).toBeNull();
    expect(body.roleTitle).toBeNull();
    expect(body.name.startsWith("We are hiring")).toBe(true);
  });

  it("renames an application", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);
    const created = await create(post({ jdText: JD }));
    const { id } = await created.json();

    const response = await update(patch({ name: "Renamed" }), context(id));

    expect(response.status).toBe(200);
    expect((await response.json()).name).toBe("Renamed");
  });

  it("rejects an empty name", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);
    const created = await create(post({ jdText: JD }));
    const { id } = await created.json();

    const response = await update(patch({ name: "   " }), context(id));

    expect(response.status).toBe(400);
  });

  it("deletes an application and cascades its draft items and scores", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);
    const created = await create(post({ jdText: JD }));
    const { id } = await created.json();

    // A bullet to score against, plus a draft item and a relevance score.
    const experience = await prisma.experience.create({
      data: {
        userId: user.id,
        kind: "JOB",
        title: "Engineer",
        organization: "Acme",
        sortOrder: 0,
        bullets: { create: [{ userId: user.id, text: "A bullet", sortOrder: 0 }] },
      },
      include: { bullets: true },
    });

    await prisma.draftItem.create({
      data: { applicationId: id, kind: "BULLET", originalText: "A bullet" },
    });
    await prisma.relevanceScore.create({
      data: {
        applicationId: id,
        bulletId: experience.bullets[0].id,
        score: 80,
        matchedKeywords: ["postgres"],
      },
    });

    const response = await remove(
      new Request("http://test", { method: "DELETE" }),
      context(id),
    );

    expect(response.status).toBe(200);
    expect(await prisma.application.count({ where: { id } })).toBe(0);
    expect(
      await prisma.draftItem.count({ where: { applicationId: id } }),
    ).toBe(0);
    expect(
      await prisma.relevanceScore.count({ where: { applicationId: id } }),
    ).toBe(0);

    // The data bank is untouched — only the application's own rows went.
    expect(await prisma.bullet.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.experience.count({ where: { userId: user.id } })).toBe(1);
  });

  it("returns 404 for another user's application and changes nothing", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();

    mockRequireUser.mockResolvedValue(owner);
    const created = await create(post({ jdText: JD, companyName: "Owner Co" }));
    const { id } = await created.json();

    mockRequireUser.mockResolvedValue(stranger);

    const patched = await update(patch({ name: "Hijacked" }), context(id));
    const deleted = await remove(
      new Request("http://test", { method: "DELETE" }),
      context(id),
    );

    expect(patched.status).toBe(404);
    expect(deleted.status).toBe(404);

    const untouched = await prisma.application.findUniqueOrThrow({
      where: { id },
    });
    expect(untouched.companyName).toBe("Owner Co");
    expect(untouched.name).not.toBe("Hijacked");
  });

  it("lists a user's applications newest first", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);
    const { listApplications } = await import("@/lib/queries/applications");

    const first = await create(post({ jdText: JD, companyName: "First Co" }));
    await first.json();
    const second = await create(post({ jdText: JD, companyName: "Second Co" }));
    await second.json();

    const listed = await listApplications(user.id);

    expect(listed).toHaveLength(2);
    expect(listed[0].companyName).toBe("Second Co");
    expect(listed[1].companyName).toBe("First Co");
  });
});
