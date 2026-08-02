import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";

/**
 * Follows the write convention in CLAUDE.md: a field absent from the body is
 * left alone. The two statuses move independently, so an accepted title can
 * sit alongside a rejected bullet rewrite on the same item.
 */
const decisionSchema = z.object({
  tailorStatus: z.enum(["ACCEPTED", "REJECTED"]).optional(),
  headerTailorStatus: z.enum(["ACCEPTED", "REJECTED"]).optional(),
});

type Context = { params: Promise<{ id: string }> };

export async function PATCH(
  request: Request,
  { params }: Context,
): Promise<NextResponse> {
  const user = await requireUser();
  const { id } = await params;

  const owned = await prisma.draftItem.findFirst({
    where: { id, application: { userId: user.id } },
    select: { id: true, tailorStatus: true, headerTailorStatus: true },
  });

  if (!owned) {
    return NextResponse.json({ error: "Draft item not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = decisionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid decision." },
      { status: 400 },
    );
  }

  const input = parsed.data;

  // The whole point of the guard: a rewrite that invented a number must never
  // become the text on someone's resume, however the request arrives.
  if (input.tailorStatus === "ACCEPTED" && owned.tailorStatus === "BLOCKED") {
    return NextResponse.json(
      {
        error:
          "This rewrite added a number that is not in your bullet. It cannot be accepted.",
      },
      { status: 409 },
    );
  }

  const updated = await prisma.draftItem.update({
    where: { id: owned.id },
    data: {
      ...(input.tailorStatus !== undefined
        ? { tailorStatus: input.tailorStatus }
        : {}),
      ...(input.headerTailorStatus !== undefined
        ? { headerTailorStatus: input.headerTailorStatus }
        : {}),
    },
  });

  return NextResponse.json(updated);
}
