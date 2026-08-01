import { PDFParse } from "pdf-parse";

/** Pages rendered beyond this are dropped before transcription. */
export const MAX_VISION_PAGES = 5;

/** Scale factor for rendered pages — enough resolution for small resume type. */
const RENDER_SCALE = 2;

/**
 * Text sitting in the PDF's own text layer. Empty string for a scanned or
 * Figma-exported page, which is what routes the document to the vision path.
 */
export async function extractPdfText(data: Buffer): Promise<string> {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return result.text.trim();
  } finally {
    await parser.destroy();
  }
}

/**
 * Render the first `MAX_VISION_PAGES` pages to PNG for transcription. Capped
 * because each page costs a vision request, and a resume's signal is on its
 * opening pages.
 */
export async function renderPdfPages(data: Buffer): Promise<Uint8Array[]> {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getScreenshot({
      imageBuffer: true,
      scale: RENDER_SCALE,
      first: MAX_VISION_PAGES,
    });
    return result.pages
      .slice(0, MAX_VISION_PAGES)
      .map((page) => page.data)
      .filter((data): data is Uint8Array => Boolean(data?.length));
  } finally {
    await parser.destroy();
  }
}
