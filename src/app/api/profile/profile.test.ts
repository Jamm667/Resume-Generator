import { readFileSync } from "node:fs";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fieldErrors,
  parseStoredLinks,
  profileUpdateSchema,
} from "@/lib/validation/profile";

const { mockRequireUser } = vi.hoisted(() => ({ mockRequireUser: vi.fn() }));

vi.mock("@/lib/require-user", () => ({ requireUser: mockRequireUser }));

const hasDatabase = Boolean(process.env.DATABASE_URL);

function patch(body: unknown): Request {
  return new Request("http://test/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function valid(overrides: Record<string, unknown> = {}) {
  return {
    fullName: "Dana Whitfield",
    email: "dana@example.com",
    phone: "+1 555 0142",
    location: "Toronto, ON",
    headline: "Senior Platform Engineer",
    links: [{ label: "LinkedIn", url: "https://linkedin.com/in/dana" }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("profileUpdateSchema", () => {
  it("accepts a complete profile", () => {
    expect(profileUpdateSchema.safeParse(valid()).success).toBe(true);
  });

  it("rejects a malformed email with a field-level path", () => {
    const result = profileUpdateSchema.safeParse(valid({ email: "not-an-email" }));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldErrors(result.error).email).toMatch(/valid email/i);
  });

  it("treats an empty email as cleared rather than invalid", () => {
    expect(profileUpdateSchema.safeParse(valid({ email: "" })).success).toBe(true);
  });

  it("rejects a link that is not a URL, keyed to its index", () => {
    const result = profileUpdateSchema.safeParse(
      valid({
        links: [
          { label: "LinkedIn", url: "https://linkedin.com/in/dana" },
          { label: "Portfolio", url: "not-a-url" },
        ],
      }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    const errors = fieldErrors(result.error);
    expect(errors["links.1.url"]).toMatch(/full URL/i);
    // The valid first link is not blamed.
    expect(errors["links.0.url"]).toBeUndefined();
  });

  it("rejects a link with no label", () => {
    const result = profileUpdateSchema.safeParse(
      valid({ links: [{ label: "  ", url: "https://example.com" }] }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldErrors(result.error)["links.0.label"]).toMatch(/label/i);
  });

  it("caps the number of links", () => {
    const links = Array.from({ length: 21 }, (_, i) => ({
      label: `Link ${i}`,
      url: `https://example.com/${i}`,
    }));

    expect(profileUpdateSchema.safeParse(valid({ links })).success).toBe(false);
  });
});

describe("parseStoredLinks", () => {
  it("returns an empty array for null or a non-array", () => {
    expect(parseStoredLinks(null)).toEqual([]);
    expect(parseStoredLinks("nonsense")).toEqual([]);
    expect(parseStoredLinks({ label: "x" })).toEqual([]);
  });

  it("drops entries with no usable shape instead of throwing", () => {
    const links = parseStoredLinks([
      { label: "LinkedIn", url: "https://linkedin.com/in/dana" },
      { nope: true },
      "a bare string",
      { label: "Missing url" },
      { label: 42, url: "https://example.com" },
      null,
    ]);

    expect(links).toEqual([
      { label: "LinkedIn", url: "https://linkedin.com/in/dana" },
    ]);
  });

  it("keeps a scheme-less URL, which is what RE-4 stores from a resume header", () => {
    // RE-4's schema types both fields as a plain string, so this is real data.
    // Dropping it here would hide the link and let the next save delete it.
    const links = parseStoredLinks([
      { label: "LinkedIn", url: "linkedin.com/in/dana" },
      { label: "", url: "dana.dev" },
    ]);

    expect(links).toEqual([
      { label: "LinkedIn", url: "linkedin.com/in/dana" },
      { label: "", url: "dana.dev" },
    ]);
  });

  it("still refuses to save a scheme-less URL, so the user fixes it deliberately", () => {
    const result = profileUpdateSchema.safeParse(
      valid({ links: [{ label: "LinkedIn", url: "linkedin.com/in/dana" }] }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldErrors(result.error)["links.0.url"]).toMatch(/full URL/i);
  });
});

// ---------------------------------------------------------------------------
// Handlers exported — source-level, so it runs with or without a database
// ---------------------------------------------------------------------------

describe("profile route module", () => {
  // Read as text rather than imported: importing the route constructs a Prisma
  // client, which the database-less run cannot do.
  const source = readFileSync(
    new URL("./route.ts", import.meta.url),
    "utf8",
  );

  it("exports PATCH and no longer exports PUT", () => {
    expect(source).toMatch(/export async function PATCH\(/);
    expect(source).not.toMatch(/export async function PUT\(/);
  });
});

// ---------------------------------------------------------------------------
// Route — requires a database
// ---------------------------------------------------------------------------

describe.skipIf(!hasDatabase)("profile route", () => {
  const userIds: string[] = [];
  let prisma: typeof import("@/lib/db").prisma;
  let GET: typeof import("@/app/api/profile/route").GET;
  let PATCH: typeof import("@/app/api/profile/route").PATCH;

  async function makeUser() {
    const user = await prisma.user.create({
      data: { email: `vitest-profile-${crypto.randomUUID()}@example.com` },
    });
    userIds.push(user.id);
    return user;
  }

  beforeEach(async () => {
    mockRequireUser.mockReset();
    ({ prisma } = await import("@/lib/db"));
    ({ GET, PATCH } = await import("@/app/api/profile/route"));
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("creates a profile on first read instead of erroring", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);

    expect(
      await prisma.profile.count({ where: { userId: user.id } }),
    ).toBe(0);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.fullName).toBeNull();
    expect(body.links).toEqual([]);
    expect(await prisma.profile.count({ where: { userId: user.id } })).toBe(1);
  });

  it("persists every field and the links array", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);

    const response = await PATCH(
      patch(
        valid({
          links: [
            { label: "LinkedIn", url: "https://linkedin.com/in/dana" },
            { label: "Portfolio", url: "https://dana.dev" },
          ],
        }),
      ),
    );

    expect(response.status).toBe(200);

    const stored = await prisma.profile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(stored.fullName).toBe("Dana Whitfield");
    expect(stored.phone).toBe("+1 555 0142");
    expect(parseStoredLinks(stored.links)).toEqual([
      { label: "LinkedIn", url: "https://linkedin.com/in/dana" },
      { label: "Portfolio", url: "https://dana.dev" },
    ]);
  });

  it("persists a reorder as the new array order", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);

    await PATCH(
      patch(
        valid({
          links: [
            { label: "LinkedIn", url: "https://linkedin.com/in/dana" },
            { label: "Portfolio", url: "https://dana.dev" },
          ],
        }),
      ),
    );

    await PATCH(
      patch(
        valid({
          links: [
            { label: "Portfolio", url: "https://dana.dev" },
            { label: "LinkedIn", url: "https://linkedin.com/in/dana" },
          ],
        }),
      ),
    );

    const stored = await prisma.profile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(parseStoredLinks(stored.links).map((l) => l.label)).toEqual([
      "Portfolio",
      "LinkedIn",
    ]);
  });

  it("removes a link when it is dropped from the array", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);

    await PATCH(patch(valid()));
    await PATCH(patch(valid({ links: [] })));

    const stored = await prisma.profile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(parseStoredLinks(stored.links)).toEqual([]);
  });

  it("blocks the save and writes nothing when a field is invalid", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);

    await PATCH(patch(valid({ phone: "+1 555 0142" })));

    const response = await PATCH(
      patch(valid({ email: "not-an-email", phone: "+1 999 CHANGED" })),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errors.email).toMatch(/valid email/i);

    // The rejected request left the previous values untouched.
    const stored = await prisma.profile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(stored.phone).toBe("+1 555 0142");
    expect(stored.email).toBe("dana@example.com");
  });

  it("writes only to the signed-in user's profile", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();

    mockRequireUser.mockResolvedValue(owner);
    await PATCH(patch(valid({ fullName: "Owner Name" })));

    mockRequireUser.mockResolvedValue(stranger);
    await PATCH(patch(valid({ fullName: "Stranger Name" })));

    const ownerProfile = await prisma.profile.findUniqueOrThrow({
      where: { userId: owner.id },
    });
    const strangerProfile = await prisma.profile.findUniqueOrThrow({
      where: { userId: stranger.id },
    });

    expect(ownerProfile.fullName).toBe("Owner Name");
    expect(strangerProfile.fullName).toBe("Stranger Name");
  });

  it("surfaces a resume-parsed link instead of hiding it", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);

    // Exactly what RE-4 writes from a resume header: no scheme.
    await prisma.profile.create({
      data: {
        userId: user.id,
        phone: "+1 555 0142",
        links: [
          { label: "LinkedIn", url: "linkedin.com/in/dana" },
          { label: "Portfolio", url: "https://dana.dev" },
        ],
      },
    });

    const response = await GET();
    const body = await response.json();

    // The form receives both, so the user can see and repair the broken one.
    expect(body.links).toEqual([
      { label: "LinkedIn", url: "linkedin.com/in/dana" },
      { label: "Portfolio", url: "https://dana.dev" },
    ]);
  });

  it("refuses the save rather than silently dropping a resume-parsed link", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);

    await prisma.profile.create({
      data: {
        userId: user.id,
        phone: "+1 555 0142",
        links: [{ label: "LinkedIn", url: "linkedin.com/in/dana" }],
      },
    });

    // The user edits their phone and saves the form as loaded.
    const response = await PATCH(
      patch(
        valid({
          phone: "+1 555 9999",
          links: [{ label: "LinkedIn", url: "linkedin.com/in/dana" }],
        }),
      ),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).errors["links.0.url"]).toMatch(/full URL/i);

    // Nothing was written — crucially, the link is still there to be fixed.
    const stored = await prisma.profile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(parseStoredLinks(stored.links)).toEqual([
      { label: "LinkedIn", url: "linkedin.com/in/dana" },
    ]);
    expect(stored.phone).toBe("+1 555 0142");
  });

  it("saves once the user has corrected the link", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);

    await prisma.profile.create({
      data: {
        userId: user.id,
        links: [{ label: "LinkedIn", url: "linkedin.com/in/dana" }],
      },
    });

    const response = await PATCH(
      patch(
        valid({
          links: [{ label: "LinkedIn", url: "https://linkedin.com/in/dana" }],
        }),
      ),
    );

    expect(response.status).toBe(200);

    const stored = await prisma.profile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(parseStoredLinks(stored.links)).toEqual([
      { label: "LinkedIn", url: "https://linkedin.com/in/dana" },
    ]);
  });

  it("normalizes blank text fields to null", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);

    await PATCH(patch(valid({ phone: "   ", headline: "" })));

    const stored = await prisma.profile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(stored.phone).toBeNull();
    expect(stored.headline).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Merge semantics
  // -------------------------------------------------------------------------

  it("leaves out-of-body fields alone", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);
    await PATCH(patch(valid()));

    // Only the phone is mentioned.
    const response = await PATCH(patch({ phone: "+1 555 0100" }));

    expect(response.status).toBe(200);

    const stored = await prisma.profile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(stored.phone).toBe("+1 555 0100");
    expect(stored.fullName).toBe("Dana Whitfield");
    expect(stored.email).toBe("dana@example.com");
    expect(stored.location).toBe("Toronto, ON");
    expect(stored.headline).toBe("Senior Platform Engineer");
  });

  it("clears a field sent as an empty string, and one sent as null", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);
    await PATCH(patch(valid()));

    await PATCH(patch({ headline: "", location: null }));

    const stored = await prisma.profile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(stored.headline).toBeNull();
    expect(stored.location).toBeNull();
    // Untouched by the same request.
    expect(stored.fullName).toBe("Dana Whitfield");
  });

  it("leaves links alone when the body does not mention them", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);
    await PATCH(patch(valid()));

    await PATCH(patch({ fullName: "Dana W." }));

    const stored = await prisma.profile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(stored.fullName).toBe("Dana W.");
    expect(parseStoredLinks(stored.links)).toEqual([
      { label: "LinkedIn", url: "https://linkedin.com/in/dana" },
    ]);
  });

  it("replaces the whole links array when it is present", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);
    await PATCH(patch(valid()));

    await PATCH(
      patch({ links: [{ label: "Portfolio", url: "https://dana.dev" }] }),
    );

    const stored = await prisma.profile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(parseStoredLinks(stored.links)).toEqual([
      { label: "Portfolio", url: "https://dana.dev" },
    ]);
  });

  it("clears links when an empty array is sent", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);
    await PATCH(patch(valid()));

    await PATCH(patch({ links: [] }));

    const stored = await prisma.profile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(parseStoredLinks(stored.links)).toEqual([]);
  });

  it("treats an empty body as a no-op rather than a wipe", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);
    await PATCH(patch(valid()));

    const response = await PATCH(patch({}));

    expect(response.status).toBe(200);

    const stored = await prisma.profile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(stored.fullName).toBe("Dana Whitfield");
    expect(stored.email).toBe("dana@example.com");
    expect(parseStoredLinks(stored.links)).toHaveLength(1);
  });

  it("creates the profile from a partial body when there is none yet", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);

    expect(await prisma.profile.count({ where: { userId: user.id } })).toBe(0);

    const response = await PATCH(patch({ fullName: "Dana Whitfield" }));

    expect(response.status).toBe(200);

    const stored = await prisma.profile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(stored.fullName).toBe("Dana Whitfield");
    expect(stored.headline).toBeNull();
  });

  it("still rejects an invalid field in a partial body, writing nothing", async () => {
    const user = await makeUser();
    mockRequireUser.mockResolvedValue(user);
    await PATCH(patch(valid()));

    const response = await PATCH(patch({ email: "not-an-email" }));

    expect(response.status).toBe(400);

    const stored = await prisma.profile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(stored.email).toBe("dana@example.com");
  });

});
