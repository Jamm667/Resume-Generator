import { NextResponse } from "next/server";
import { z } from "zod";

import {
  findDependentDuplicateIds,
  findOwnedExperience,
} from "@/lib/bank/ownership";
import { prisma } from "@/lib/db";
import { getBankExperience } from "@/lib/queries/bank";
import { requireUser } from "@/lib/require-user";
import { EXPERIENCE_KINDS } from "@/lib/structure/schema";

const updateSchema = z.object({
  kind: z.enum(EXPERIENCE_KINDS).optional(),
  title: z.string().trim().min(1, "Title cannot be empty.").optional(),
  organization: z
    .string()
    .trim()
    .min(1, "Organization cannot be empty.")
    .optional(),
  location: z.string().nullish(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  isCurrent: z.boolean().optional(),
  summary: z.string().nullish(),
  // Confirming an entry without changing it. An empty body is a no-op by
  // convention, so approving has to say so explicitly.
  needsReview: z.boolean().optional(),
});

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
}

type Context = { params: Promise<{ id: string }> };

/**
 * Edit an experience. Follows the write convention in CLAUDE.md: a field absent
 * from the body is left alone, one sent as `null` or `""` is cleared.
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

  const owned = await findOwnedExperience(user.id, id);
  if (!owned) {
    return NextResponse.json({ error: "Experience not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid experience." },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const { needsReview, ...fields } = input;
  const editsContent = Object.values(fields).some(
    (value) => value !== undefined,
  );

  // An explicit flag wins; otherwise editing any field counts as reviewing.
  const reviewed =
    needsReview !== undefined ? needsReview : editsContent ? false : undefined;

  await prisma.experience.update({
    where: { id: owned.id },
    data: {
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.organization !== undefined
        ? { organization: input.organization }
        : {}),
      ...(input.location !== undefined
        ? { location: blankToNull(input.location) }
        : {}),
      ...(input.startDate !== undefined
        ? { startDate: blankToNull(input.startDate) }
        : {}),
      ...(input.endDate !== undefined
        ? { endDate: blankToNull(input.endDate) }
        : {}),
      ...(input.isCurrent !== undefined ? { isCurrent: input.isCurrent } : {}),
      ...(input.summary !== undefined
        ? { summary: blankToNull(input.summary) }
        : {}),
      ...(reviewed !== undefined ? { needsReview: reviewed } : {}),
    },
  });

  return NextResponse.json(await getBankExperience(user.id, owned.id));
}

/** Delete an experience. Its bullets cascade away with it. */
export async function DELETE(
  _request: Request,
  { params }: Context,
): Promise<NextResponse> {
  const user = await requireUser();
  const { id } = await params;

  const owned = await findOwnedExperience(user.id, id);
  if (!owned) {
    return NextResponse.json({ error: "Experience not found." }, { status: 404 });
  }

  // Every bullet here cascades away, so anything flagged against one of them
  // loses its reference too — including bullets in other experiences.
  const doomed = await prisma.bullet.findMany({
    where: { experienceId: owned.id },
    select: { id: true },
  });
  const clearedDuplicateIds = await findDependentDuplicateIds(
    user.id,
    doomed.map((bullet) => bullet.id),
  );

  await prisma.experience.delete({ where: { id: owned.id } });

  return NextResponse.json({
    id: owned.id,
    deleted: true,
    clearedDuplicateIds,
  });
}
