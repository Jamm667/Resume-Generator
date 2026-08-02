import { NextResponse } from "next/server";
import { z } from "zod";

import {
  findDependentDuplicateIds,
  findOwnedBullet,
} from "@/lib/bank/ownership";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";

const updateSchema = z.object({
  // Optional so an absent field means "leave it alone" rather than 400. It is
  // still the only editable field, and still cannot be set to empty.
  text: z.string().trim().min(1, "Bullet text cannot be empty.").optional(),
});

type Context = { params: Promise<{ id: string }> };

/**
 * Edit a bullet. Follows the write convention in CLAUDE.md: a field absent from
 * the body is left alone.
 *
 * Any save counts as the user having reviewed it — but a body that asks for no
 * changes is not a save, so it leaves `needsReview` alone too.
 */
export async function PATCH(
  request: Request,
  { params }: Context,
): Promise<NextResponse> {
  const user = await requireUser();
  const { id } = await params;

  const owned = await findOwnedBullet(user.id, id);
  if (!owned) {
    return NextResponse.json({ error: "Bullet not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid bullet." },
      { status: 400 },
    );
  }

  const { text } = parsed.data;

  const updated = await prisma.bullet.update({
    where: { id: owned.id },
    data: text !== undefined ? { text, needsReview: false } : {},
    include: { duplicateOf: { select: { id: true, text: true } } },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: Context,
): Promise<NextResponse> {
  const user = await requireUser();
  const { id } = await params;

  const owned = await findOwnedBullet(user.id, id);
  if (!owned) {
    return NextResponse.json({ error: "Bullet not found." }, { status: 404 });
  }

  // Read before deleting: afterwards the relation is already nulled.
  const clearedDuplicateIds = await findDependentDuplicateIds(user.id, [owned.id]);

  await prisma.bullet.delete({ where: { id: owned.id } });

  return NextResponse.json({
    id: owned.id,
    deleted: true,
    clearedDuplicateIds,
  });
}
