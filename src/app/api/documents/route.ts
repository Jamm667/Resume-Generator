import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import {
  extractDocument,
  validateUpload,
  type RejectedUpload,
  type UploadCandidate,
} from "@/lib/extract";
import { requireUser } from "@/lib/require-user";
import { structureDocument } from "@/lib/structure";

export type UploadedDocument = {
  id: string;
  filename: string;
  parseStatus: string;
  extractionMethod: string | null;
  parseError: string | null;
  characters: number;
};

export type UploadResponse = {
  documents: UploadedDocument[];
  rejected: RejectedUpload[];
};

/**
 * Accept a batch of resumes and extract each one inline.
 *
 * Extraction runs in the request rather than a queue (RE-3 NG-3), so the
 * response already carries each document's final status. Rows are created
 * PENDING first, so a document is always traceable even if extraction fails.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const user = await requireUser();

  const formData = await request.formData();
  const files = formData.getAll("files").filter((v): v is File => v instanceof File);

  if (files.length === 0) {
    return NextResponse.json({ error: "No files were uploaded." }, { status: 400 });
  }

  const candidates: UploadCandidate[] = files.map((file) => ({
    filename: file.name,
    size: file.size,
    mimeType: file.type,
  }));

  const { accepted, rejected } = validateUpload(candidates);
  const acceptedNames = new Set(accepted.map((c) => c.filename));
  const documents: UploadedDocument[] = [];

  for (const file of files) {
    if (!acceptedNames.has(file.name)) continue;

    const candidate = accepted.find((c) => c.filename === file.name);
    if (!candidate) continue;
    acceptedNames.delete(file.name);

    const document = await prisma.sourceDocument.create({
      data: {
        userId: user.id,
        filename: candidate.filename,
        mimeType: candidate.mimeType,
        extractionMethod: "TEXT_LAYER",
        parseStatus: "PENDING",
      },
    });

    const buffer = Buffer.from(await file.arrayBuffer());
    const outcome = await extractDocument(buffer, candidate.mimeType);

    let updated =
      outcome.status === "EXTRACTED"
        ? await prisma.sourceDocument.update({
            where: { id: document.id },
            data: {
              rawText: outcome.rawText,
              extractionMethod: outcome.method,
              parseStatus: "EXTRACTED",
              parseError: null,
            },
          })
        : await prisma.sourceDocument.update({
            where: { id: document.id },
            data: { parseStatus: "FAILED", parseError: outcome.parseError },
          });

    // Extraction only produces text; structuring is what puts it in the bank.
    if (updated.parseStatus === "EXTRACTED") {
      await structureDocument(updated.id, user.id);
      updated = await prisma.sourceDocument.findUniqueOrThrow({
        where: { id: updated.id },
      });
    }

    documents.push({
      id: updated.id,
      filename: updated.filename,
      parseStatus: updated.parseStatus,
      extractionMethod:
        updated.parseStatus === "FAILED" ? null : updated.extractionMethod,
      parseError: updated.parseError,
      characters: updated.rawText?.length ?? 0,
    });
  }

  return NextResponse.json({ documents, rejected } satisfies UploadResponse);
}
