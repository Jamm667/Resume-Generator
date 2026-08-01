import { NextResponse } from "next/server";
import { z } from "zod";

import {
  findDependentDuplicateIds,
  findOwnedBullet,
} from "@/lib/bank/ownership";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";

const resolveSchema = z.object({
  action: z.enum(["keep-both", "delete"]),
});

type Context = { params: Promise<{ id: string }> };

/**
 * Resolve a flagged duplicate. Nothing here happens automatically — RE-4 only
 * ever flags, and this is the one place a pair is actually acted on.
 */
export async function POST(
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
  const parsed = resolveSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose either keep-both or delete." },
      { status: 400 },
    );
  }

  if (parsed.data.action === "delete") {
    // This bullet may itself be the reference for others; clear those markers.
    const clearedDuplicateIds = await findDependentDuplicateIds(user.id, [
      owned.id,
    ]);
    await prisma.bullet.delete({ where: { id: owned.id } });
    return NextResponse.json({
      id: owned.id,
      deleted: true,
      clearedDuplicateIds,
    });
  }

  // Keep both: drop the flag, leave both rows exactly where they are.
  const updated = await prisma.bullet.update({
    where: { id: owned.id },
    data: { duplicateOfBulletId: null },
    include: { duplicateOf: { select: { id: true, text: true } } },
  });

  return NextResponse.json(updated);
}
