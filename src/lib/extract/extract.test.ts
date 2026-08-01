import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DOCX_MIME,
  MIN_TEXT_CHARS,
  PDF_MIME,
  validateUpload,
} from "@/lib/extract";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("@/lib/anthropic", () => ({
  getAnthropicClient: () => ({ messages: { create: mockCreate } }),
}));

// Imported after the mock so the vision path never reaches the real SDK.
const { extractDocument } = await import("@/lib/extract");

function fixture(name: string): Buffer {
  return readFileSync(
    fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)),
  );
}

function anthropicText(text: string) {
  return { content: [{ type: "text", text }] };
}

describe("validateUpload", () => {
  it("accepts a pdf and a docx, normalizing the mime type", () => {
    const { accepted, rejected } = validateUpload([
      { filename: "resume.pdf", size: 1024, mimeType: "application/pdf" },
      // Browsers frequently report an empty type for .docx.
      { filename: "resume.docx", size: 2048, mimeType: "" },
    ]);

    expect(rejected).toEqual([]);
    expect(accepted.map((c) => c.mimeType)).toEqual([PDF_MIME, DOCX_MIME]);
  });

  it("rejects a .txt file by name and reason, and never accepts it", () => {
    const { accepted, rejected } = validateUpload([
      { filename: "notes.txt", size: 10, mimeType: "text/plain" },
    ]);

    expect(accepted).toEqual([]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].filename).toBe("notes.txt");
    expect(rejected[0].reason).toMatch(/\.pdf and \.docx/);
  });

  it("rejects a file over 10 MB", () => {
    const { accepted, rejected } = validateUpload([
      { filename: "huge.pdf", size: 11 * 1024 * 1024, mimeType: PDF_MIME },
    ]);

    expect(accepted).toEqual([]);
    expect(rejected[0].filename).toBe("huge.pdf");
    expect(rejected[0].reason).toMatch(/11\.0 MB/);
    expect(rejected[0].reason).toMatch(/10 MB/);
  });

  it("accepts the first 10 files and rejects the rest", () => {
    const candidates = Array.from({ length: 12 }, (_, i) => ({
      filename: `resume-${i}.pdf`,
      size: 1024,
      mimeType: PDF_MIME,
    }));

    const { accepted, rejected } = validateUpload(candidates);

    expect(accepted).toHaveLength(10);
    expect(rejected).toHaveLength(2);
    expect(rejected[0].reason).toMatch(/up to 10/);
  });

  it("rejects an empty file", () => {
    const { rejected } = validateUpload([
      { filename: "blank.pdf", size: 0, mimeType: PDF_MIME },
    ]);

    expect(rejected[0].reason).toMatch(/empty/i);
  });
});

describe("extractDocument", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads a text-layer PDF without calling Claude", async () => {
    const outcome = await extractDocument(fixture("text-layer.pdf"), PDF_MIME);

    expect(outcome.status).toBe("EXTRACTED");
    if (outcome.status !== "EXTRACTED") return;
    expect(outcome.method).toBe("TEXT_LAYER");
    expect(outcome.rawText.length).toBeGreaterThan(MIN_TEXT_CHARS);
    expect(outcome.rawText).toContain("Dana Whitfield");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("reads a DOCX with mammoth", async () => {
    const outcome = await extractDocument(fixture("resume.docx"), DOCX_MIME);

    expect(outcome.status).toBe("EXTRACTED");
    if (outcome.status !== "EXTRACTED") return;
    expect(outcome.method).toBe("TEXT_LAYER");
    expect(outcome.rawText).toContain("Priya Raman");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("routes an image-only PDF to the vision path and records VISION_OCR", async () => {
    const transcription = "Transcribed resume. ".repeat(20);
    mockCreate.mockResolvedValue(anthropicText(transcription));

    const outcome = await extractDocument(fixture("image-only.pdf"), PDF_MIME);

    expect(outcome.status).toBe("EXTRACTED");
    if (outcome.status !== "EXTRACTED") return;
    expect(outcome.method).toBe("VISION_OCR");
    expect(outcome.rawText).toContain("Transcribed resume.");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("sends rendered PNG pages, capped at 5, to the vision model", async () => {
    mockCreate.mockResolvedValue(anthropicText("Transcribed resume. ".repeat(20)));

    await extractDocument(fixture("image-only.pdf"), PDF_MIME);

    const request = mockCreate.mock.calls[0][0];
    const images = request.messages[0].content.filter(
      (block: { type: string }) => block.type === "image",
    );

    expect(images.length).toBeGreaterThan(0);
    expect(images.length).toBeLessThanOrEqual(5);
    for (const image of images) {
      expect(image.source.media_type).toBe("image/png");
      // A real PNG, not an empty placeholder.
      expect(Buffer.from(image.source.data, "base64").subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    }
  });

  it("fails with a retry-able message when Anthropic errors", async () => {
    mockCreate.mockRejectedValue(new Error("529 overloaded_error"));

    const outcome = await extractDocument(fixture("image-only.pdf"), PDF_MIME);

    expect(outcome.status).toBe("FAILED");
    if (outcome.status !== "FAILED") return;
    expect(outcome.parseError).toMatch(/retried/i);
    expect(outcome.parseError).toContain("529 overloaded_error");
  });

  it("fails when the transcription comes back too short to be a resume", async () => {
    mockCreate.mockResolvedValue(anthropicText("blank page"));

    const outcome = await extractDocument(fixture("image-only.pdf"), PDF_MIME);

    expect(outcome.status).toBe("FAILED");
    if (outcome.status !== "FAILED") return;
    expect(outcome.parseError).toMatch(/paste the text/i);
  });

  it("fails rather than throwing when the file is not a readable PDF", async () => {
    mockCreate.mockRejectedValue(new Error("no pages"));

    const outcome = await extractDocument(Buffer.from("not a pdf"), PDF_MIME);

    expect(outcome.status).toBe("FAILED");
    if (outcome.status !== "FAILED") return;
    expect(outcome.parseError.length).toBeGreaterThan(0);
  });
});
