import { NextResponse } from "next/server";
import { z } from "zod";

import { findOwnedExperience } from "@/lib/bank/ownership";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";

const reorderSchema = z.object({
  experienceId: z.string().min(1),
  orderedIds: z.array(z.string().min(1)).min(1),
});

/**
 * Persist a drag reorder as `sortOrder` values.
 *
 * The submitted list must be exactly the experience's current bullets — that
 * rejects both a stale client and an attempt to pull another experience's
 * bullet into this one, which NG-2 keeps out of this page entirely.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const user = await requireUser();

  const body = await request.json().catch(() => null);
  const parsed = reorderSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid reorder." }, { status: 400 });
  }

  const experience = await findOwnedExperience(user.id, parsed.data.experienceId);
  if (!experience) {
    return NextResponse.json({ error: "Experience not found." }, { status: 404 });
  }

  const current = await prisma.bullet.findMany({
    where: { experienceId: experience.id },
    select: { id: true },
  });

  const currentIds = new Set(current.map((bullet) => bullet.id));
  const submitted = new Set(parsed.data.orderedIds);

  const sameSize =
    currentIds.size === submitted.size &&
    parsed.data.orderedIds.length === submitted.size;
  const sameMembers =
    sameSize && parsed.data.orderedIds.every((id) => currentIds.has(id));

  if (!sameMembers) {
    return NextResponse.json(
      { error: "That ordering does not match this experience's bullets." },
      { status: 400 },
    );
  }

  await prisma.$transaction(
    parsed.data.orderedIds.map((id, index) =>
      prisma.bullet.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );

  const bullets = await prisma.bullet.findMany({
    where: { experienceId: experience.id },
    orderBy: { sortOrder: "asc" },
    include: { duplicateOf: { select: { id: true, text: true } } },
  });

  return NextResponse.json({ bullets });
}
