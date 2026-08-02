import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DOCX_MIME } from "@/lib/extract";

const { mockRequireUser, mockExtract, mockStructure } = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockExtract: vi.fn(),
  mockStructure: vi.fn(),
}));

vi.mock("@/lib/require-user", () => ({ requireUser: mockRequireUser }));

// Partial mock: the real validateUpload is what decides accept/reject, and it
// is the thing under test here. Only the slow extraction call is replaced.
vi.mock("@/lib/extract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/extract")>()),
  extractDocument: mockExtract,
}));

vi.mock("@/lib/structure", () => ({ structureDocument: mockStructure }));

const hasDatabase = Boolean(process.env.DATABASE_URL);

/** A file with real bytes, so `size` is non-zero and it is not rejected. */
function docx(name: string, bytes = 512): File {
  return new File([new Uint8Array(bytes)], name, { type: DOCX_MIME });
}

/**
 * A file that gets rejected, sharing a name with an accepted one.
 *
 * Empty rather than oversize: a patched `size` does not survive the FormData
 * round trip into the route, and an actually-oversize file would mean
 * allocating 10 MB per run. The route-level path is the same either way — a
 * rejection among same-named files — and `validateUpload` covers the size rule
 * directly.
 */
function emptyDocx(name: string): File {
  return docx(name, 0);
}

function upload(files: File[]): Request {
  const body = new FormData();
  for (const file of files) body.append("files", file);
  return new Request("http://test/api/documents", { method: "POST", body });
}

describe.skipIf(!hasDatabase)("POST /api/documents", () => {
  const userIds: string[] = [];
  let prisma: typeof import("@/lib/db").prisma;
  let POST: typeof import("@/app/api/documents/route").POST;

  async function makeUser() {
    const user = await prisma.user.create({
      data: { email: `vitest-docs-${crypto.randomUUID()}@example.com` },
    });
    userIds.push(user.id);
    mockRequireUser.mockResolvedValue(user);
    return user;
  }

  beforeEach(async () => {
    mockRequireUser.mockReset();
    mockExtract.mockReset();
    mockStructure.mockReset();
    // Extraction failing keeps every test off the structuring path, which is
    // not what these tests are about.
    mockExtract.mockResolvedValue({
      status: "FAILED",
      parseError: "Not a real document.",
    });
    ({ prisma } = await import("@/lib/db"));
    ({ POST } = await import("@/app/api/documents/route"));
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("creates a row for each of two files sharing a filename", async () => {
    const user = await makeUser();

    const response = await POST(upload([docx("resume.docx"), docx("resume.docx")]));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.documents).toHaveLength(2);
    expect(body.rejected).toEqual([]);

    // Two distinct rows, not one row returned twice.
    const ids = body.documents.map((d: { id: string }) => d.id);
    expect(new Set(ids).size).toBe(2);
    expect(
      await prisma.sourceDocument.count({ where: { userId: user.id } }),
    ).toBe(2);
  });

  it("tags each returned document with the position of its file", async () => {
    await makeUser();

    const response = await POST(
      upload([docx("resume.docx"), docx("resume.docx"), docx("resume.docx")]),
    );
    const body = await response.json();

    expect(body.documents.map((d: { index: number }) => d.index)).toEqual([
      0, 1, 2,
    ]);
  });

  it("attributes the rejection to the right file when the names collide", async () => {
    const user = await makeUser();

    // Same name, opposite verdicts. Only position tells them apart.
    const response = await POST(
      upload([emptyDocx("resume.docx"), docx("resume.docx")]),
    );
    const body = await response.json();

    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].index).toBe(0);
    expect(body.rejected[0].reason).toMatch(/empty/i);

    // The acceptable one still got its row, and it is the second file.
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].index).toBe(1);
    expect(
      await prisma.sourceDocument.count({ where: { userId: user.id } }),
    ).toBe(1);
  });

  it("returns one result per accepted file, so no row can be left unresolved", async () => {
    await makeUser();

    const files = [
      docx("a.docx"),
      docx("dup.docx"),
      docx("dup.docx"),
      docx("notes.txt"),
      docx("dup.docx"),
    ];

    const response = await POST(upload(files));
    const body = await response.json();

    const resolved = [
      ...body.documents.map((d: { index: number }) => d.index),
      ...body.rejected.map((r: { index: number }) => r.index),
    ].sort((a, b) => a - b);

    // Every uploaded position comes back exactly once, either as a document
    // or as a rejection — the client can then never strand a row.
    expect(resolved).toEqual([0, 1, 2, 3, 4]);
  });

  it("still handles distinct filenames exactly as before", async () => {
    const user = await makeUser();

    const response = await POST(upload([docx("one.docx"), docx("two.docx")]));
    const body = await response.json();

    expect(body.documents.map((d: { filename: string }) => d.filename)).toEqual(
      ["one.docx", "two.docx"],
    );
    expect(
      await prisma.sourceDocument.count({ where: { userId: user.id } }),
    ).toBe(2);
  });

  it("rejects an empty upload", async () => {
    await makeUser();

    const response = await POST(upload([]));

    expect(response.status).toBe(400);
    expect(mockExtract).not.toHaveBeenCalled();
  });
});
