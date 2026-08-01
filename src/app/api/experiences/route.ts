import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { getBankExperience } from "@/lib/queries/bank";
import { requireUser } from "@/lib/require-user";
import { EXPERIENCE_KINDS } from "@/lib/structure/schema";

const createSchema = z.object({
  kind: z.enum(EXPERIENCE_KINDS),
  title: z.string().trim().min(1, "Title is required."),
  organization: z.string().trim().min(1, "Organization is required."),
  location: z.string().trim().nullish(),
  startDate: z.string().trim().nullish(),
  endDate: z.string().trim().nullish(),
  isCurrent: z.boolean().optional(),
  summary: z.string().trim().nullish(),
});

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
}

/** Create an experience by hand. Nothing the user typed needs review. */
export async function POST(request: Request): Promise<NextResponse> {
  const user = await requireUser();

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid experience." },
      { status: 400 },
    );
  }

  const highest = await prisma.experience.aggregate({
    where: { userId: user.id },
    _max: { sortOrder: true },
  });

  const created = await prisma.experience.create({
    data: {
      userId: user.id,
      kind: parsed.data.kind,
      title: parsed.data.title,
      organization: parsed.data.organization,
      location: blankToNull(parsed.data.location),
      startDate: blankToNull(parsed.data.startDate),
      endDate: parsed.data.isCurrent ? null : blankToNull(parsed.data.endDate),
      isCurrent: parsed.data.isCurrent ?? false,
      summary: blankToNull(parsed.data.summary),
      // Typed by hand, so there is nothing for the user to check.
      needsReview: false,
      sortOrder: (highest._max.sortOrder ?? -1) + 1,
    },
  });

  return NextResponse.json(await getBankExperience(user.id, created.id), {
    status: 201,
  });
}
