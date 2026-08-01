import { z } from "zod";

/** A score is a percentage; anything outside the range is a malformed answer. */
export const MIN_SCORE = 0;
export const MAX_SCORE = 100;

const scoreShape = {
  bulletId: z.string().min(1),
  score: z.number().int().min(MIN_SCORE).max(MAX_SCORE),
  matchedKeywords: z.array(z.string()),
};

/**
 * What the response is validated against. Strict on purpose: a score outside
 * 0–100 or a missing bullet id would be rendered as a real ranking, so the
 * whole batch is rejected and retried rather than partially trusted.
 */
export const relevanceResponseSchema = z.object({
  scores: z.array(z.object(scoreShape)),
});

export type RelevanceResponse = z.infer<typeof relevanceResponseSchema>;
export type ScoredBullet = RelevanceResponse["scores"][number];

/** JSON Schema handed to the API. `$schema` is stripped — it is not accepted. */
export function relevanceResponseJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(relevanceResponseSchema) as Record<
    string,
    unknown
  >;
  delete generated.$schema;
  return generated;
}
