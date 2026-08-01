import { z } from "zod";

/** A score is a percentage; anything outside the range is a malformed answer. */
export const MIN_SCORE = 0;
export const MAX_SCORE = 100;

/** What the model is asked to produce. */
const apiResponseSchema = z.object({
  scores: z.array(
    z.object({
      bulletId: z.string(),
      score: z.number().int(),
      matchedKeywords: z.array(z.string()),
    }),
  ),
});

const RANGE_KEYWORDS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
] as const;

/**
 * Drop every range keyword from a generated schema, in place.
 *
 * The constrained decoder answers `minimum`/`maximum` on an integer with a 400,
 * and `z.number().int()` emits the safe-integer bounds whether we ask for them
 * or not. The range that matters is stated in the prompt and enforced against
 * the response, so nothing is lost by removing them here.
 */
function stripRanges(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) stripRanges(item);
    return;
  }

  if (node === null || typeof node !== "object") return;

  const record = node as Record<string, unknown>;
  for (const keyword of RANGE_KEYWORDS) delete record[keyword];
  for (const value of Object.values(record)) stripRanges(value);
}

/**
 * What the response is validated against. Strict on purpose: a score outside
 * 0–100 or a missing bullet id would be rendered as a real ranking, so the
 * whole batch is rejected and retried rather than partially trusted.
 */
export const relevanceResponseSchema = z.object({
  scores: z.array(
    z.object({
      bulletId: z.string().min(1),
      score: z.number().int().min(MIN_SCORE).max(MAX_SCORE),
      matchedKeywords: z.array(z.string()),
    }),
  ),
});

export type RelevanceResponse = z.infer<typeof relevanceResponseSchema>;
export type ScoredBullet = RelevanceResponse["scores"][number];

/** JSON Schema handed to the API. `$schema` is stripped — it is not accepted. */
export function relevanceResponseJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(apiResponseSchema) as Record<
    string,
    unknown
  >;
  delete generated.$schema;
  stripRanges(generated);
  return generated;
}
