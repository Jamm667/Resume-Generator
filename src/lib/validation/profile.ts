import { z } from "zod";

/** Sanity bound; the contact block is not a link farm. */
export const MAX_LINKS = 20;

export const profileLinkSchema = z.object({
  label: z.string().trim().min(1, "Give this link a label."),
  url: z.url("Enter a full URL, including https://"),
});

/**
 * An optional free-text field. Empty is how the UI says "not set", so it is
 * accepted and normalized to null rather than rejected.
 */
function optionalText(max = 200) {
  return z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .nullish();
}

export const profileUpdateSchema = z.object({
  fullName: optionalText(),
  // Empty clears the field; anything else has to be a real address.
  email: z
    .union([z.literal(""), z.email("Enter a valid email address.")])
    .nullish(),
  phone: optionalText(50),
  location: optionalText(),
  headline: optionalText(300),
  links: z.array(profileLinkSchema).max(MAX_LINKS, `At most ${MAX_LINKS} links.`),
});

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;
export type ProfileLink = z.infer<typeof profileLinkSchema>;

/**
 * Flatten Zod issues into `field -> message`, using dotted paths for links
 * (`links.0.url`) so the form can show the error against the exact input.
 * The first message per field wins; the form shows one at a time.
 */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (!(key in errors)) {
      errors[key] = issue.message;
    }
  }

  return errors;
}

/** Empty string and whitespace both mean "not set". */
export function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Shape only — two strings. Deliberately looser than `profileLinkSchema`.
 *
 * RE-4 writes this column through its own schema, where both fields are a
 * plain `z.string()`. Resume headers routinely spell links without a scheme
 * ("linkedin.com/in/dana"), so that is genuinely what lands in the database.
 */
const storedLinkSchema = z.object({
  label: z.string(),
  url: z.string(),
});

/**
 * Coerce the stored `links` JSON back into a typed array.
 *
 * Reading is permissive on purpose. Applying the save-time rules here would
 * hide a scheme-less link from the form, and the next save — which writes the
 * form's array wholesale — would delete it without ever telling the user. A
 * link the user came here to fix is exactly the link that must survive the
 * round trip; `profileUpdateSchema` is what stops them at save time, with a
 * field-level error they can act on.
 *
 * Genuinely malformed entries (not an object, missing fields, wrong types) are
 * still dropped, since there is nothing to render or repair.
 */
export function parseStoredLinks(value: unknown): ProfileLink[] {
  if (!Array.isArray(value)) return [];

  const links: ProfileLink[] = [];
  for (const entry of value) {
    const parsed = storedLinkSchema.safeParse(entry);
    if (parsed.success) links.push(parsed.data);
  }

  return links;
}
