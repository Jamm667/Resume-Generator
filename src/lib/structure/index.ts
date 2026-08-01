import type { Prisma } from "@prisma/client";

import { getAnthropicClient } from "@/lib/anthropic";
import { prisma } from "@/lib/db";
import { findDuplicate, type ExistingBullet } from "@/lib/structure/dedupe";
import {
  STRUCTURE_SYSTEM_PROMPT,
  structureUserPrompt,
} from "@/lib/structure/prompt";
import {
  structuredResponseJsonSchema,
  structuredResponseSchema,
  type StructuredResponse,
} from "@/lib/structure/schema";

const MODEL = "claude-opus-5";

/** One retry: a schema-invalid response is usually transient. */
const MAX_ATTEMPTS = 2;

/** Row creation can outlast Prisma's 5s interactive-transaction default. */
const TRANSACTION_TIMEOUT_MS = 30_000;

export type StructureOutcome =
  | {
      status: "STRUCTURED";
      experiences: number;
      bullets: number;
      duplicates: number;
    }
  | { status: "FAILED"; parseError: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One constrained call, parsed and validated. Throws on any failure. */
async function requestStructure(rawText: string): Promise<StructuredResponse> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: STRUCTURE_SYSTEM_PROMPT,
    output_config: {
      format: {
        type: "json_schema",
        schema: structuredResponseJsonSchema(),
      },
    },
    messages: [{ role: "user", content: structureUserPrompt(rawText) }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return structuredResponseSchema.parse(JSON.parse(text));
}

/** Fill only the profile fields that are still empty (AC-5). */
async function mergeProfile(
  tx: Prisma.TransactionClient,
  userId: string,
  incoming: StructuredResponse["profile"],
): Promise<void> {
  const existing = await tx.profile.findUnique({ where: { userId } });

  if (!existing) {
    await tx.profile.create({
      data: {
        userId,
        fullName: incoming.fullName,
        email: incoming.email,
        phone: incoming.phone,
        location: incoming.location,
        headline: incoming.headline,
        links: incoming.links.length > 0 ? incoming.links : undefined,
      },
    });
    return;
  }

  const data: Prisma.ProfileUpdateInput = {};
  if (existing.fullName === null && incoming.fullName) {
    data.fullName = incoming.fullName;
  }
  if (existing.email === null && incoming.email) data.email = incoming.email;
  if (existing.phone === null && incoming.phone) data.phone = incoming.phone;
  if (existing.location === null && incoming.location) {
    data.location = incoming.location;
  }
  if (existing.headline === null && incoming.headline) {
    data.headline = incoming.headline;
  }
  if (existing.links === null && incoming.links.length > 0) {
    data.links = incoming.links;
  }

  if (Object.keys(data).length > 0) {
    await tx.profile.update({ where: { userId }, data });
  }
}

/**
 * Turn one extracted document into data bank rows.
 *
 * The model call happens outside the transaction — it is slow and retried — and
 * every write happens inside one, so a failure leaves zero partial rows. New
 * bullets are compared only against bullets that existed *before* this run, so
 * a document never flags itself.
 */
export async function structureDocument(
  documentId: string,
  userId: string,
): Promise<StructureOutcome> {
  const document = await prisma.sourceDocument.findFirst({
    where: { id: documentId, userId },
    select: { id: true, rawText: true },
  });

  if (!document) {
    return { status: "FAILED", parseError: "Document not found." };
  }

  const rawText = document.rawText?.trim() ?? "";
  if (rawText.length === 0) {
    const parseError = "There is no extracted text to structure.";
    await prisma.sourceDocument.update({
      where: { id: document.id },
      data: { parseStatus: "FAILED", parseError },
    });
    return { status: "FAILED", parseError };
  }

  let structured: StructuredResponse | null = null;
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      structured = await requestStructure(rawText);
      break;
    } catch (error) {
      lastError = messageOf(error);
    }
  }

  if (!structured) {
    const parseError = `Could not structure this resume, and it can be retried: ${lastError}`;
    await prisma.sourceDocument.update({
      where: { id: document.id },
      data: { parseStatus: "FAILED", parseError },
    });
    return { status: "FAILED", parseError };
  }

  const response = structured;

  try {
    const counts = await prisma.$transaction(
      async (tx) => {
        // Read before writing: these are the bullets this run compares against.
        const existing: ExistingBullet[] = await tx.bullet.findMany({
          where: { userId },
          select: { id: true, text: true },
        });

        await mergeProfile(tx, userId, response.profile);

        const highest = await tx.experience.aggregate({
          where: { userId },
          _max: { sortOrder: true },
        });
        let sortOrder = (highest._max.sortOrder ?? -1) + 1;

        let bullets = 0;
        let duplicates = 0;

        for (const experience of response.experiences) {
          const created = await tx.experience.create({
            data: {
              userId,
              sourceDocumentId: document.id,
              kind: experience.kind,
              title: experience.title,
              organization: experience.organization,
              location: experience.location,
              startDate: experience.startDate,
              endDate: experience.isCurrent ? null : experience.endDate,
              isCurrent: experience.isCurrent,
              summary: experience.summary,
              needsReview: true,
              sortOrder,
              bullets: {
                create: experience.bullets.map((text, index) => ({
                  userId,
                  text,
                  needsReview: true,
                  sortOrder: index,
                })),
              },
            },
            include: { bullets: { orderBy: { sortOrder: "asc" } } },
          });

          sortOrder += 1;

          for (const bullet of created.bullets) {
            bullets += 1;
            const match = findDuplicate(bullet.text, existing);
            if (match) {
              await tx.bullet.update({
                where: { id: bullet.id },
                data: { duplicateOfBulletId: match.id },
              });
              duplicates += 1;
            }
          }
        }

        await tx.sourceDocument.update({
          where: { id: document.id },
          data: { parseStatus: "STRUCTURED", parseError: null },
        });

        return {
          experiences: response.experiences.length,
          bullets,
          duplicates,
        };
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );

    return { status: "STRUCTURED", ...counts };
  } catch (error) {
    const parseError = `Could not save the structured resume: ${messageOf(error)}`;
    await prisma.sourceDocument.update({
      where: { id: document.id },
      data: { parseStatus: "FAILED", parseError },
    });
    return { status: "FAILED", parseError };
  }
}
