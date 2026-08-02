import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { planMove, type DraftNode } from "@/lib/draft/reorder";
import { requireUser } from "@/lib/require-user";

/**
 * Follows the write convention: a field absent from the body is left alone,
 * and one sent as `null` is cleared. Clearing `userText` is exactly what
 * "revert to original" does — the original was never overwritten (AC-8).
 */
const updateSchema = z.object({
  userText: z.string().nullish(),
  userTitle: z.string().nullish(),
  userDateText: z.string().nullish(),
  move: z
    .object({
      targetParentId: z.string().nullable(),
      targetIndex: z.number().int().min(0),
    })
    .optional(),
});

type Context = { params: Promise<{ id: string }> };

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Ownership check. Returns null for both "missing" and "not yours", so another
 * user's id is indistinguishable from one that does not exist.
 */
async function findOwned(userId: string, id: string) {
  return prisma.draftItem.findFirst({
    where: { id, application: { userId } },
    select: { id: true, applicationId: true, kind: true },
  });
}

export async function PATCH(
  request: Request,
  { params }: Context,
): Promise<NextResponse> {
  const user = await requireUser();
  const { id } = await params;

  const owned = await findOwned(user.id, id);
  if (!owned) {
    return NextResponse.json({ error: "Draft item not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid draft item." },
      { status: 400 },
    );
  }

  const input = parsed.data;

  if (input.move) {
    const items: DraftNode[] = await prisma.draftItem.findMany({
      where: { applicationId: owned.applicationId },
      select: { id: true, kind: true, parentDraftItemId: true, sortOrder: true },
    });

    const plan = planMove(items, {
      itemId: owned.id,
      targetParentId: input.move.targetParentId,
      targetIndex: input.move.targetIndex,
    });

    if (!plan.ok) {
      return NextResponse.json({ error: plan.error }, { status: 400 });
    }

    // One transaction: a half-applied reorder would leave duplicate sort
    // orders that the next move would then compound.
    await prisma.$transaction(
      plan.updates.map((update) =>
        prisma.draftItem.update({
          where: { id: update.id },
          data: {
            parentDraftItemId: update.parentDraftItemId,
            sortOrder: update.sortOrder,
          },
        }),
      ),
    );

    return NextResponse.json({ moved: plan.updates.length });
  }

  const updated = await prisma.draftItem.update({
    where: { id: owned.id },
    data: {
      ...(input.userText !== undefined
        ? { userText: blankToNull(input.userText) }
        : {}),
      ...(input.userTitle !== undefined
        ? { userTitle: blankToNull(input.userTitle) }
        : {}),
      ...(input.userDateText !== undefined
        ? { userDateText: blankToNull(input.userDateText) }
        : {}),
    },
  });

  return NextResponse.json(updated);
}

/**
 * Remove one item from the draft. Nested bullet items go with an experience
 * item (AC-7); the source rows in the data bank are never touched (AC-6).
 */
export async function DELETE(
  _request: Request,
  { params }: Context,
): Promise<NextResponse> {
  const user = await requireUser();
  const { id } = await params;

  const owned = await findOwned(user.id, id);
  if (!owned) {
    return NextResponse.json({ error: "Draft item not found." }, { status: 404 });
  }

  await prisma.draftItem.delete({ where: { id: owned.id } });

  return NextResponse.json({ id: owned.id, deleted: true });
}
