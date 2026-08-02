import type { Prisma } from "@prisma/client";

import { getAnthropicClient } from "@/lib/anthropic";
import { prisma } from "@/lib/db";
// The three-layer rule lives here so the cover letter and the exports read the
// draft exactly the way tailoring does.
import {
  effectiveDateText,
  effectiveText,
  effectiveTitle,
} from "@/lib/draft/effective-text";
import { isFabricated } from "@/lib/tailor/numeric-guard";
import { TAILOR_SYSTEM_PROMPT, tailorUserPrompt } from "@/lib/tailor/prompt";
import {
  tailorResponseJsonSchema,
  tailorResponseSchema,
  type TailorResponse,
} from "@/lib/tailor/schema";

const MODEL = "claude-opus-5";

/** One retry: a schema-invalid response is usually transient. */
const MAX_ATTEMPTS = 2;

/** Enough of the posting to reframe against. */
export const JD_TAILOR_CHARS = 12_000;

/**
 * `reason` separates "you asked for something impossible" from "the model or
 * the database let us down", so the route can answer 404/400 rather than
 * blaming Anthropic for a missing application.
 */
export type TailorFailure = "NOT_FOUND" | "EMPTY_DRAFT" | "UPSTREAM";

export type TailorOutcome =
  | { status: "TAILORED"; proposed: number; blocked: number; headers: number }
  | { status: "FAILED"; reason: TailorFailure; error: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One constrained call, parsed and validated. Throws on any failure. */
async function requestTailoring(
  jdText: string,
  bullets: readonly { id: string; text: string }[],
  experiences: readonly { id: string; title: string; dateText: string }[],
): Promise<TailorResponse> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: TAILOR_SYSTEM_PROMPT,
    output_config: {
      format: { type: "json_schema", schema: tailorResponseJsonSchema() },
    },
    messages: [
      {
        role: "user",
        content: tailorUserPrompt({ jdText, bullets, experiences }),
      },
    ],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return tailorResponseSchema.parse(JSON.parse(text));
}

/**
 * Propose a rewrite for every bullet and experience header in one draft.
 *
 * The model call happens before any write and the whole result lands in one
 * transaction, so a failure leaves every existing status exactly as it was
 * (AC-10). Accepted items are shown to the model as context but are never
 * overwritten — there is one `tailoredText` column, so re-proposing over an
 * accepted rewrite would destroy the text the user chose (AC-9).
 */
export async function runTailorPass(
  applicationId: string,
  userId: string,
): Promise<TailorOutcome> {
  const application = await prisma.application.findFirst({
    where: { id: applicationId, userId },
    select: { id: true, jdText: true },
  });

  if (!application) {
    return {
      status: "FAILED",
      reason: "NOT_FOUND",
      error: "Application not found.",
    };
  }

  const items = await prisma.draftItem.findMany({
    where: { applicationId: application.id },
    orderBy: { sortOrder: "asc" },
  });

  if (items.length === 0) {
    return {
      status: "FAILED",
      reason: "EMPTY_DRAFT",
      error: "There is nothing in the draft to tailor yet.",
    };
  }

  const bulletItems = items.filter((item) => item.kind === "BULLET");
  const experienceItems = items.filter((item) => item.kind === "EXPERIENCE");

  // `organization` is deliberately absent from everything below (AC-16).
  const bullets = bulletItems.map((item) => ({
    id: item.id,
    text: effectiveText(item),
  }));
  const experiences = experienceItems.map((item) => ({
    id: item.id,
    title: effectiveTitle(item),
    dateText: effectiveDateText(item),
  }));

  const excerpt = application.jdText.slice(0, JD_TAILOR_CHARS).trim();

  let response: TailorResponse | null = null;
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      response = await requestTailoring(excerpt, bullets, experiences);
      break;
    } catch (error) {
      lastError = messageOf(error);
    }
  }

  if (!response) {
    return {
      status: "FAILED",
      reason: "UPSTREAM",
      error: `Tailoring failed and can be retried: ${lastError}`,
    };
  }

  const sourceById = new Map(items.map((item) => [item.id, item]));
  const updates: Prisma.PrismaPromise<unknown>[] = [];
  let proposed = 0;
  let blocked = 0;
  let headers = 0;

  for (const rewrite of response.bullets) {
    const item = sourceById.get(rewrite.id);
    if (!item || item.kind !== "BULLET") continue;
    // Never overwrite what the user already accepted.
    if (item.tailorStatus === "ACCEPTED") continue;

    // The guard runs on bullets only, and against the same text the model saw.
    const fabricated = isFabricated(effectiveText(item), rewrite.text);
    if (fabricated) blocked += 1;
    else proposed += 1;

    updates.push(
      prisma.draftItem.update({
        where: { id: item.id },
        data: {
          tailoredText: rewrite.text,
          tailorStatus: fabricated ? "BLOCKED" : "PROPOSED",
        },
      }),
    );
  }

  for (const rewrite of response.experiences) {
    const item = sourceById.get(rewrite.id);
    if (!item || item.kind !== "EXPERIENCE") continue;
    if (item.headerTailorStatus === "ACCEPTED") continue;

    headers += 1;
    updates.push(
      prisma.draftItem.update({
        where: { id: item.id },
        data: {
          // No guard here, by explicit product decision (NG-5).
          tailoredTitle: rewrite.title,
          tailoredDateText: rewrite.dateText,
          headerTailorStatus: "PROPOSED",
        },
      }),
    );
  }

  try {
    await prisma.$transaction(updates);
  } catch (error) {
    return {
      status: "FAILED",
      reason: "UPSTREAM",
      error: `Could not save the proposals: ${messageOf(error)}`,
    };
  }

  return { status: "TAILORED", proposed, blocked, headers };
}
