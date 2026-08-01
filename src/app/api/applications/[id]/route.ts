import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";

const updateSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty.").optional(),
  companyName: z.string().nullish(),
  roleTitle: z.string().nullish(),
});

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
}

type Context = { params: Promise<{ id: string }> };

/**
 * Ownership check. Returns null for both "missing" and "not yours", so another
 * user's id is indistinguishable from one that does not exist.
 */
async function findOwned(userId: string, id: string) {
  return prisma.application.findFirst({
    where: { id, userId },
    select: { id: true },
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
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { errors: { [issue?.path.join(".") || "form"]: issue?.message } },
      { status: 400 },
    );
  }

  const input = parsed.data;

  const updated = await prisma.application.update({
    where: { id: owned.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.companyName !== undefined
        ? { companyName: blankToNull(input.companyName) }
        : {}),
      ...(input.roleTitle !== undefined
        ? { roleTitle: blankToNull(input.roleTitle) }
        : {}),
    },
  });

  return NextResponse.json(updated);
}

/**
 * Delete an application. Its draft items and relevance scores cascade away
 * with it, and the cover letter is a column on the row itself.
 */
export async function DELETE(
  _request: Request,
  { params }: Context,
): Promise<NextResponse> {
  const user = await requireUser();
  const { id } = await params;

  const owned = await findOwned(user.id, id);
  if (!owned) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }

  await prisma.application.delete({ where: { id: owned.id } });

  return NextResponse.json({ id: owned.id, deleted: true });
}
