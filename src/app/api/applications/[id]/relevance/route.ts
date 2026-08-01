import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { runRelevancePass } from "@/lib/relevance";
import { requireUser } from "@/lib/require-user";

type Context = { params: Promise<{ id: string }> };

/**
 * Score this application's job description against the whole data bank.
 *
 * Triggered explicitly by the user (NG-3) — nothing scores on save. The pass
 * itself never writes a `Bullet` row, so running it cannot change the bank.
 */
export async function POST(
  _request: Request,
  { params }: Context,
): Promise<NextResponse> {
  const user = await requireUser();
  const { id } = await params;

  // Scoped by userId, so another user's id is a 404 like any missing row.
  const application = await prisma.application.findFirst({
    where: { id, userId: user.id },
    select: { id: true, jdText: true },
  });

  if (!application) {
    return NextResponse.json(
      { error: "Application not found." },
      { status: 404 },
    );
  }

  // Read in bank order so batching is reproducible across runs.
  const experiences = await prisma.experience.findMany({
    where: { userId: user.id },
    orderBy: { sortOrder: "asc" },
    select: {
      bullets: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, text: true },
      },
    },
  });

  const bullets = experiences.flatMap((experience) => experience.bullets);

  if (bullets.length === 0) {
    return NextResponse.json(
      {
        error:
          "Your data bank is empty. Upload a resume first, then come back to rank it against this posting.",
      },
      { status: 400 },
    );
  }

  const outcome = await runRelevancePass({
    applicationId: application.id,
    jdText: application.jdText,
    bullets,
  });

  if (outcome.status === "FAILED") {
    // 502: the model call, not the request, is what went wrong. The previous
    // ranking is untouched, so the client can simply offer a retry.
    return NextResponse.json({ error: outcome.error }, { status: 502 });
  }

  return NextResponse.json(outcome);
}
