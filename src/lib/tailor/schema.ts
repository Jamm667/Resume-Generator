import { z } from "zod";

/**
 * What the model is asked to produce. No length or range constraints: the
 * constrained decoder rejects some of them outright, and every value is
 * validated on the way back in regardless.
 */
const apiResponseSchema = z.object({
  bullets: z.array(z.object({ id: z.string(), text: z.string() })),
  experiences: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      dateText: z.string(),
    }),
  ),
});

/** What the response is validated against. */
export const tailorResponseSchema = z.object({
  bullets: z.array(
    z.object({ id: z.string().min(1), text: z.string().min(1) }),
  ),
  experiences: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      dateText: z.string(),
    }),
  ),
});

export type TailorResponse = z.infer<typeof tailorResponseSchema>;

const RANGE_KEYWORDS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
] as const;

/** See `src/lib/relevance/schema.ts`: the decoder refuses these outright. */
function stripConstraints(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) stripConstraints(item);
    return;
  }
  if (node === null || typeof node !== "object") return;

  const record = node as Record<string, unknown>;
  for (const keyword of RANGE_KEYWORDS) delete record[keyword];
  for (const value of Object.values(record)) stripConstraints(value);
}

/** JSON Schema handed to the API. `$schema` is stripped — it is not accepted. */
export function tailorResponseJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(apiResponseSchema) as Record<string, unknown>;
  delete generated.$schema;
  stripConstraints(generated);
  return generated;
}
