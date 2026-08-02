import { NextResponse } from "next/server";
import { z } from "zod";

import { generateCoverLetter } from "@/lib/cover-letter";
import { COVER_LETTER_TONES } from "@/lib/cover-letter/prompt";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";

const generateSchema = z.object({
  tone: z.enum(COVER_LETTER_TONES),
});

/**
 * Follows the write convention in CLAUDE.md: a field absent from the body is
 * left alone, and one sent as `null` or `""` clears it.
 */
const editSchema = z.object({
  coverLetterText: z.string().nullish(),
});

type Context = { params: Promise<{ id: string }> };

/** Write a new letter, replacing whatever was there. */
export async function POST(
  request: Request,
  { params }: Context,
): Promise<NextResponse> {
  const user = await requireUser();
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = generateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Pick a tone: Formal, Conversational, or Direct." },
      { status: 400 },
    );
  }

  const outcome = await generateCoverLetter(id, user.id, parsed.data.tone);

  if (outcome.status === "FAILED") {
    const status =
      outcome.reason === "NOT_FOUND"
        ? 404
        : outcome.reason === "EMPTY_DRAFT"
          ? 400
          : 502;
    return NextResponse.json({ error: outcome.error }, { status });
  }

  return NextResponse.json(outcome);
}

/** Save the user's own edits to the letter. */
export async function PATCH(
  request: Request,
  { params }: Context,
): Promise<NextResponse> {
  const user = await requireUser();
  const { id } = await params;

  const owned = await prisma.application.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });

  if (!owned) {
    return NextResponse.json(
      { error: "Application not found." },
      { status: 404 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = editSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid letter." }, { status: 400 });
  }

  const input = parsed.data;
  const trimmed = input.coverLetterText?.trim() ?? "";

  const updated = await prisma.application.update({
    where: { id: owned.id },
    data: {
      ...(input.coverLetterText !== undefined
        ? { coverLetterText: trimmed.length === 0 ? null : trimmed }
        : {}),
    },
    select: { id: true, coverLetterText: true, coverLetterTone: true },
  });

  return NextResponse.json(updated);
}
