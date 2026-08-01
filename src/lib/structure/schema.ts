import { z } from "zod";

export const EXPERIENCE_KINDS = ["JOB", "PROJECT", "EDUCATION"] as const;
export type ExperienceKindValue = (typeof EXPERIENCE_KINDS)[number];

function isKnownKind(value: unknown): value is ExperienceKindValue {
  return (
    typeof value === "string" &&
    (EXPERIENCE_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Map whatever the model produced onto a known kind. Structured outputs
 * constrain the enum, so this should never fire — but an unknown value must
 * never reach the database as a new enum member, so it falls back to JOB.
 */
export function coerceKind(value: unknown): ExperienceKindValue {
  if (isKnownKind(value)) return value;
  console.warn(
    `[structure] unexpected experience kind ${JSON.stringify(value)} — coerced to JOB`,
  );
  return "JOB";
}

const linkSchema = z.object({
  label: z.string(),
  url: z.string(),
});

const profileShape = {
  fullName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  headline: z.string().nullable(),
  links: z.array(linkSchema),
};

const experienceShape = {
  title: z.string(),
  organization: z.string(),
  location: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  isCurrent: z.boolean(),
  summary: z.string().nullable(),
  bullets: z.array(z.string()),
};

/**
 * What the model is asked to produce. `kind` is a strict enum here so the
 * constrained decoder can enforce it.
 */
const strictResponseSchema = z.object({
  profile: z.object(profileShape),
  experiences: z.array(
    z.object({ kind: z.enum(EXPERIENCE_KINDS), ...experienceShape }),
  ),
});

/**
 * What the response is validated against. Identical except that `kind` accepts
 * any string and coerces, so a model that ignores the enum still yields a row
 * we can store rather than failing the whole document.
 */
export const structuredResponseSchema = z.object({
  profile: z.object(profileShape),
  experiences: z.array(
    z.object({
      kind: z.unknown().transform(coerceKind),
      ...experienceShape,
    }),
  ),
});

export type StructuredResponse = z.infer<typeof structuredResponseSchema>;
export type StructuredExperience = StructuredResponse["experiences"][number];
export type StructuredProfile = StructuredResponse["profile"];

/** JSON Schema handed to the API. `$schema` is stripped — it is not accepted. */
export function structuredResponseJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(strictResponseSchema) as Record<
    string,
    unknown
  >;
  delete generated.$schema;
  return generated;
}
