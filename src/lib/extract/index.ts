import type { ExtractionMethod } from "@prisma/client";

import { extractDocxText } from "@/lib/extract/docx";
import { extractPdfText, renderPdfPages } from "@/lib/extract/pdf";
import { transcribePages, VisionTranscriptionError } from "@/lib/extract/vision";

/** Below this many characters a PDF is treated as image-only. */
export const MIN_TEXT_CHARS = 200;

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 10;

export const PDF_MIME = "application/pdf";
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type UploadCandidate = {
  filename: string;
  size: number;
  mimeType: string;
};

/**
 * An accepted file, carrying the position it arrived in.
 *
 * Position rather than filename is what identifies a file from here on: two
 * files in one upload may legitimately share a name, and matching by name
 * silently loses the second.
 */
export type AcceptedUpload = UploadCandidate & {
  index: number;
};

export type RejectedUpload = {
  index: number;
  filename: string;
  reason: string;
};

export type ValidationResult = {
  accepted: AcceptedUpload[];
  rejected: RejectedUpload[];
};

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
}

/**
 * Resolve the canonical mime type from the extension, which browsers report
 * inconsistently for .docx. Returns null for anything we do not accept.
 */
function resolveMimeType(candidate: UploadCandidate): string | null {
  switch (extensionOf(candidate.filename)) {
    case ".pdf":
      return PDF_MIME;
    case ".docx":
      return DOCX_MIME;
    default:
      return null;
  }
}

/**
 * Split an upload into files worth processing and files to report back. Every
 * rejection names the file and the reason so the UI can show it inline, and no
 * rejected file reaches the database.
 */
export function validateUpload(candidates: UploadCandidate[]): ValidationResult {
  const accepted: AcceptedUpload[] = [];
  const rejected: RejectedUpload[] = [];

  candidates.forEach((candidate, index) => {
    if (index >= MAX_FILES_PER_UPLOAD) {
      rejected.push({
        index,
        filename: candidate.filename,
        reason: `Too many files — up to ${MAX_FILES_PER_UPLOAD} per upload.`,
      });
      return;
    }

    const mimeType = resolveMimeType(candidate);
    if (!mimeType) {
      rejected.push({
        index,
        filename: candidate.filename,
        reason: "Unsupported file type — only .pdf and .docx are accepted.",
      });
      return;
    }

    if (candidate.size > MAX_FILE_BYTES) {
      const mb = (candidate.size / 1024 / 1024).toFixed(1);
      rejected.push({
        index,
        filename: candidate.filename,
        reason: `Too large (${mb} MB) — the limit is 10 MB per file.`,
      });
      return;
    }

    if (candidate.size === 0) {
      rejected.push({
        index,
        filename: candidate.filename,
        reason: "File is empty.",
      });
      return;
    }

    accepted.push({ ...candidate, mimeType, index });
  });

  return { accepted, rejected };
}

export type ExtractionOutcome =
  | { status: "EXTRACTED"; rawText: string; method: ExtractionMethod }
  | { status: "FAILED"; parseError: string };

/**
 * Pull raw text out of one uploaded file.
 *
 * PDFs go through their text layer first; anything under `MIN_TEXT_CHARS` is
 * treated as image-only and re-read with Claude vision. Every failure path
 * resolves to a FAILED outcome carrying a human-readable reason — this never
 * throws, so a document can never be left stranded in PENDING.
 */
export async function extractDocument(
  buffer: Buffer,
  mimeType: string,
): Promise<ExtractionOutcome> {
  if (mimeType === DOCX_MIME) {
    try {
      const text = await extractDocxText(buffer);
      if (text.length === 0) {
        return {
          status: "FAILED",
          parseError: "No text found in this document.",
        };
      }
      return { status: "EXTRACTED", rawText: text, method: "TEXT_LAYER" };
    } catch (error) {
      return {
        status: "FAILED",
        parseError: `Could not read this .docx file: ${messageOf(error)}`,
      };
    }
  }

  let textLayer = "";
  let textLayerError: string | null = null;

  try {
    textLayer = await extractPdfText(buffer);
  } catch (error) {
    // Not fatal on its own — a corrupt text layer can still render as images.
    textLayerError = messageOf(error);
  }

  if (textLayer.length >= MIN_TEXT_CHARS) {
    return { status: "EXTRACTED", rawText: textLayer, method: "TEXT_LAYER" };
  }

  try {
    const pages = await renderPdfPages(buffer);
    const transcription = await transcribePages(pages);

    if (transcription.length >= MIN_TEXT_CHARS) {
      return {
        status: "EXTRACTED",
        rawText: transcription,
        method: "VISION_OCR",
      };
    }

    return {
      status: "FAILED",
      parseError:
        "Could not read enough text from this PDF, even after transcribing the pages. Paste the text instead.",
    };
  } catch (error) {
    if (error instanceof VisionTranscriptionError) {
      return {
        status: "FAILED",
        parseError: `Transcription failed and can be retried: ${error.message}`,
      };
    }

    const detail = textLayerError
      ? `${textLayerError}; ${messageOf(error)}`
      : messageOf(error);
    return {
      status: "FAILED",
      parseError: `Could not read this PDF: ${detail}`,
    };
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
