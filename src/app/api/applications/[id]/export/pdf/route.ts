import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import {
  buildLetterDocument,
  buildResumeDocument,
  exportFilename,
  type ExportProfile,
} from "@/lib/export/document-model";
import { renderLetterPdf, renderResumePdf } from "@/lib/export/pdf";
import { requireUser } from "@/lib/require-user";
import { parseStoredLinks } from "@/lib/validation/profile";

type Context = { params: Promise<{ id: string }> };

/**
 * Download one application's resume or cover letter as a PDF.
 *
 * A GET so the browser can fetch it straight from a link and honour the
 * filename in `Content-Disposition`, with no client-side blob juggling. The
 * file is generated per request and never stored.
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

  let pdf: Uint8Array;

  try {
    if (wanted === "cover-letter") {
      const body = application.coverLetterText?.trim() ?? "";
      if (body.length === 0) {
        return NextResponse.json(
          { error: "This application has no cover letter yet." },
          { status: 404 },
        );
      }

      pdf = await renderLetterPdf(
        buildLetterDocument({
          profile,
          companyName: application.companyName,
          roleTitle: application.roleTitle,
          date: new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          }),
          body,
        }),
      );
    } else {
      const draft = await prisma.draftItem.findMany({
        where: { applicationId: application.id, parentDraftItemId: null },
        orderBy: { sortOrder: "asc" },
        include: {
          children: { orderBy: { sortOrder: "asc" } },
          sourceExperience: { select: { kind: true } },
        },
      });

      pdf = await renderResumePdf(buildResumeDocument(profile, draft));
    }
  } catch (error) {
    // A half-written PDF is worse than no PDF: answer with a readable reason
    // rather than streaming a file the user's reader cannot open (AC-8).
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not build the PDF. Try again.",
      },
      { status: 500 },
    );
  }

  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${exportFilename(
        application.name,
        wanted,
      )}"`,
    },
  }) as NextResponse;
}
