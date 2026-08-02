import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { nextSortOrder, type DraftNode } from "@/lib/draft/reorder";
import { getDraft } from "@/lib/queries/draft";
import { requireUser } from "@/lib/require-user";

const addSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("EXPERIENCE"),
    experienceId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("BULLET"),
    bulletId: z.string().min(1),
    parentDraftItemId: z.string().min(1, "Drop this onto an experience."),
  }),
]);

type Context = { params: Promise<{ id: string }> };

/** Placement fields plus the source ids the duplicate checks need. */
type DraftRow = DraftNode & {
  sourceBulletId: string | null;
  sourceExperienceId: string | null;
};

/** Every item in this draft, flattened into what the placement rules need. */
async function draftNodes(applicationId: string): Promise<DraftRow[]> {
  return prisma.draftItem.findMany({
    where: { applicationId },
    select: {
      id: true,
      kind: true,
      parentDraftItemId: true,
      sortOrder: true,
      sourceBulletId: true,
      sourceExperienceId: true,
    },
  });
}

/**
 * Add one library item to the master draft.
 *
 * A dragged experience brings its bullets with it (AC-2). A dragged bullet
 * lands under whichever experience item received the drop (AC-3), which is how
 * a bullet from one resume ends up under a job title from another.
 */
export async function POST(
  request: Request,
  { params }: Context,
): Promise<NextResponse> {
  const user = await requireUser();
  const { id } = await params;

  const application = await prisma.application.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });

  if (!application) {
    return NextResponse.json(
      { error: "Application not found." },
      { status: 404 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = addSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid draft item." },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const existing = await draftNodes(application.id);

  if (input.kind === "EXPERIENCE") {
    const experience = await prisma.experience.findFirst({
      where: { id: input.experienceId, userId: user.id },
      include: { bullets: { orderBy: { sortOrder: "asc" } } },
    });

    if (!experience) {
      return NextResponse.json(
        { error: "That experience is not in your data bank." },
        { status: 404 },
      );
    }

    const alreadyAdded = existing.some(
      (item) => item.sourceExperienceId === experience.id,
    );
    if (alreadyAdded) {
      return NextResponse.json(
        { error: `“${experience.title}” is already in this draft.` },
        { status: 409 },
      );
    }

    // Bullets already pulled in individually are not duplicated (AC-9). The
    // experience still comes in, and the response says what was left out.
    const usedBulletIds = new Set(
      existing
        .map((item) => item.sourceBulletId)
        .filter((value): value is string => value !== null),
    );
    const fresh = experience.bullets.filter(
      (bullet) => !usedBulletIds.has(bullet.id),
    );
    const skipped = experience.bullets.length - fresh.length;

    const created = await prisma.draftItem.create({
      data: {
        applicationId: application.id,
        kind: "EXPERIENCE",
        sourceExperienceId: experience.id,
        sortOrder: nextSortOrder(existing, null),
        // Non-null column; the header fields are what the UI actually renders.
        originalText: experience.title,
        originalTitle: experience.title,
        organization: experience.organization,
        originalDateText: dateTextOf(experience),
        children: {
          create: fresh.map((bullet, index) => ({
            applicationId: application.id,
            kind: "BULLET" as const,
            sourceBulletId: bullet.id,
            sortOrder: index,
            originalText: bullet.text,
          })),
        },
      },
      include: { children: { orderBy: { sortOrder: "asc" } } },
    });

    return NextResponse.json({ item: created, skipped }, { status: 201 });
  }

  const bullet = await prisma.bullet.findFirst({
    where: { id: input.bulletId, userId: user.id },
    select: { id: true, text: true },
  });

  if (!bullet) {
    return NextResponse.json(
      { error: "That bullet is not in your data bank." },
      { status: 404 },
    );
  }

  if (existing.some((item) => item.sourceBulletId === bullet.id)) {
    return NextResponse.json(
      { error: "That bullet is already in this draft." },
      { status: 409 },
    );
  }

  const parent = existing.find((item) => item.id === input.parentDraftItemId);
  if (!parent || parent.kind !== "EXPERIENCE") {
    return NextResponse.json(
      { error: "Drop a bullet onto an experience in the draft." },
      { status: 400 },
    );
  }

  const created = await prisma.draftItem.create({
    data: {
      applicationId: application.id,
      kind: "BULLET",
      sourceBulletId: bullet.id,
      parentDraftItemId: parent.id,
      sortOrder: nextSortOrder(existing, parent.id),
      originalText: bullet.text,
    },
  });

  return NextResponse.json({ item: created, skipped: 0 }, { status: 201 });
}

/** The date range as the bank shows it, frozen into the draft item. */
function dateTextOf(experience: {
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
}): string | null {
  const start = experience.startDate ?? "";
  const end = experience.isCurrent ? "Present" : (experience.endDate ?? "");
  const range = [start, end].filter(Boolean).join(" – ");
  return range.length === 0 ? null : range;
}

/** The current draft, used by the client after a change. */
export async function GET(
  _request: Request,
  { params }: Context,
): Promise<NextResponse> {
  const user = await requireUser();
  const { id } = await params;

  return NextResponse.json(await getDraft(user.id, id));
}
