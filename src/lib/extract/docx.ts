import mammoth from "mammoth";

/** Plain text of a .docx, paragraph breaks preserved. */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}
