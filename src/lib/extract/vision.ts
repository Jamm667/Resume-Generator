import { getAnthropicClient } from "@/lib/anthropic";

/** Claude reads the rendered pages; nothing here needs deep reasoning. */
const VISION_MODEL = "claude-opus-5";

const PROMPT = [
  "Transcribe every word of this resume exactly as written, in reading order.",
  "Preserve section headings, job titles, organizations, dates, and bullet lines",
  "as separate lines. Do not summarize, reorder, correct, or invent anything —",
  "if a word is illegible, write [illegible] in its place.",
  "Return only the transcription, with no preamble or commentary.",
].join(" ");

/** Raised when the Anthropic call itself fails, as opposed to returning too little text. */
export class VisionTranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisionTranscriptionError";
  }
}

/**
 * Transcribe rendered PDF pages with Claude vision. Every page goes in one
 * request so the model sees the document as a whole rather than page by page.
 */
export async function transcribePages(pages: Uint8Array[]): Promise<string> {
  if (pages.length === 0) {
    throw new VisionTranscriptionError("The PDF produced no renderable pages.");
  }

  const client = getAnthropicClient();

  try {
    const response = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: 16000,
      output_config: { effort: "low" },
      messages: [
        {
          role: "user",
          content: [
            ...pages.map((page) => ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: "image/png" as const,
                data: Buffer.from(page).toString("base64"),
              },
            })),
            { type: "text" as const, text: PROMPT },
          ],
        },
      ],
    });

    return response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
  } catch (error) {
    // Surfaced to the user as a retry-able failure rather than a crash.
    const detail = error instanceof Error ? error.message : String(error);
    throw new VisionTranscriptionError(detail);
  }
}
