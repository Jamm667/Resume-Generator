import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";

/**
 * Manual fallback for a document neither extraction path could read.
 *
 * Scoped by `userId`: another user's document id is indistinguishable from one
 * that does not exist, so both return 404.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await requireUser();
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (text.length === 0) {
    return NextResponse.json({ error: "Paste some text first." }, { status: 400 });
  }

  const document = await prisma.sourceDocument.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });

  if (!document) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const updated = await prisma.sourceDocument.update({
    where: { id: document.id },
    data: {
      rawText: text,
      extractionMethod: "PASTED",
      parseStatus: "EXTRACTED",
      parseError: null,
    },
  });

  return NextResponse.json({
    id: updated.id,
    filename: updated.filename,
    parseStatus: updated.parseStatus,
    extractionMethod: updated.extractionMethod,
    parseError: null,
    characters: updated.rawText?.length ?? 0,
  });
}
