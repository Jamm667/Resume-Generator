import { NextResponse } from "next/server";
import { z } from "zod";

import { findOwnedBullet } from "@/lib/bank/ownership";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";

const updateSchema = z.object({
  text: z.string().trim().min(1, "Bullet text cannot be empty."),
});

type Context = { params: Promise<{ id: string }> };

/** Edit a bullet. Any save counts as the user having reviewed it. */
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

  const updated = await prisma.bullet.update({
    where: { id: owned.id },
    data: { text: parsed.data.text, needsReview: false },
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

  await prisma.bullet.delete({ where: { id: owned.id } });

  return NextResponse.json({ id: owned.id, deleted: true });
}
