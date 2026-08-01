import { z } from "zod";

import { getAnthropicClient } from "@/lib/anthropic";

const MODEL = "claude-opus-5";

/** Enough of a posting to name the employer and the role. */
export const JD_INFERENCE_CHARS = 4000;

const inferenceSchema = z.object({
  companyName: z.string().nullable(),
  roleTitle: z.string().nullable(),
});

export type InferredCompanyRole = z.infer<typeof inferenceSchema>;

const SYSTEM_PROMPT = [
  "You read a job description and name the employer and the role.",
  "",
  "Use only what the posting states. If it never names the company — many",
  "listings are anonymous or posted through an agency — return null for it",
  "rather than guessing from context. Same for the role title: return the title",
  "as written, not a normalized or inferred one. Never return a placeholder",
  'such as "Unknown", "N/A", or an empty string.',
].join("\n");

function jsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(inferenceSchema) as Record<string, unknown>;
  delete generated.$schema;
  return generated;
}

function cleaned(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) return null;
  // The model is told not to do this; belt and braces, since a placeholder
  // would be silently saved as though it were the real company name.
  if (/^(unknown|n\/?a|none|not specified)$/i.test(trimmed)) return null;
  return trimmed;
}

/**
 * Best-effort company and role from a pasted JD.
 *
 * Never throws. This runs while the user is waiting for their application to
 * be created, and AC-5 is explicit that a failed or empty call must not block
 * creation — a blank field they can type into beats an error page.
 */
export async function inferCompanyAndRole(
  jdText: string,
): Promise<InferredCompanyRole> {
  const excerpt = jdText.slice(0, JD_INFERENCE_CHARS).trim();
  if (excerpt.length === 0) return { companyName: null, roleTitle: null };

  try {
    const client = getAnthropicClient();

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: jsonSchema() },
      },
      messages: [
        {
          role: "user",
          content: `Job description:\n\n<jd>\n${excerpt}\n</jd>`,
        },
      ],
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    const parsed = inferenceSchema.parse(JSON.parse(text));

    return {
      companyName: cleaned(parsed.companyName),
      roleTitle: cleaned(parsed.roleTitle),
    };
  } catch (error) {
    console.warn(
      "[jd] company/role inference failed, leaving both blank:",
      error instanceof Error ? error.message : String(error),
    );
    return { companyName: null, roleTitle: null };
  }
}
