import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import {
  buildCoverLetterMarkdown,
  buildResumeMarkdown,
  exportFilename,
  type ExportProfile,
} from "@/lib/export/markdown";
import { requireUser } from "@/lib/require-user";
import { parseStoredLinks } from "@/lib/validation/profile";

type Context = { params: Promise<{ id: string }> };

/**
 * Download one application's resume or cover letter as markdown.
 *
 * A GET so the browser can fetch it straight from a link and honour the
 * filename in `Content-Disposition`, with no client-side blob juggling.
 */
export async function GET(
  request: Request,
  { params }: Context,
): Promise<NextResponse> {
  const user = await requireUser();
  const { id } = await params;

  const wanted = new URL(request.url).searchParams.get("doc") ?? "resume";
  if (wanted !== "resume" && wanted !== "cover-letter") {
    return NextResponse.json(
      { error: "Ask for doc=resume or doc=cover-letter." },
      { status: 400 },
    );
  }

  // Scoped by userId, so another user's id is a 404 like any missing row.
  const application = await prisma.application.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      name: true,
      companyName: true,
      roleTitle: true,
      coverLetterText: true,
    },
  });

  if (!application) {
    return NextResponse.json(
      { error: "Application not found." },
      { status: 404 },
    );
  }

  const stored = await prisma.profile.findUnique({ where: { userId: user.id } });
  const profile: ExportProfile = {
    fullName: stored?.fullName ?? null,
    email: stored?.email ?? null,
    phone: stored?.phone ?? null,
    location: stored?.location ?? null,
    links: parseStoredLinks(stored?.links),
  };

  let markdown: string;

  if (wanted === "cover-letter") {
    const body = application.coverLetterText?.trim() ?? "";
    if (body.length === 0) {
      return NextResponse.json(
        { error: "This application has no cover letter yet." },
        { status: 404 },
      );
    }

    markdown = buildCoverLetterMarkdown({
      profile,
      companyName: application.companyName,
      roleTitle: application.roleTitle,
      date: new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      body,
    });
  } else {
    const draft = await prisma.draftItem.findMany({
      where: { applicationId: application.id, parentDraftItemId: null },
      orderBy: { sortOrder: "asc" },
      include: {
        children: { orderBy: { sortOrder: "asc" } },
        sourceExperience: { select: { kind: true } },
      },
    });

    markdown = buildResumeMarkdown(profile, draft);
  }

  return new NextResponse(markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(
        application.name,
        wanted,
      )}"`,
    },
  }) as NextResponse;
}
