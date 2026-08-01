import { NextResponse } from "next/server";
import { z } from "zod";

import { findOwnedExperience } from "@/lib/bank/ownership";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";

const createSchema = z.object({
  experienceId: z.string().min(1),
  text: z.string().trim().min(1, "Bullet text is required."),
});

/** Add a bullet by hand to an experience the user owns. */
export async function POST(request: Request): Promise<NextResponse> {
  const user = await requireUser();

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid bullet." },
      { status: 400 },
    );
  }

  const experience = await findOwnedExperience(user.id, parsed.data.experienceId);
  if (!experience) {
    return NextResponse.json({ error: "Experience not found." }, { status: 404 });
  }

  const highest = await prisma.bullet.aggregate({
    where: { experienceId: experience.id },
    _max: { sortOrder: true },
  });

  const created = await prisma.bullet.create({
    data: {
      userId: user.id,
      experienceId: experience.id,
      text: parsed.data.text,
      // Typed by hand, so there is nothing for the user to check.
      needsReview: false,
      sortOrder: (highest._max.sortOrder ?? -1) + 1,
    },
    include: { duplicateOf: { select: { id: true, text: true } } },
  });

  return NextResponse.json(created, { status: 201 });
}
