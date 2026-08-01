import { getAnthropicClient } from "@/lib/anthropic";
import { prisma } from "@/lib/db";
import {
  JD_SCORING_CHARS,
  planBatches,
  type ScorableBullet,
} from "@/lib/relevance/batch";
import {
  RELEVANCE_SYSTEM_PROMPT,
  relevanceUserPrompt,
} from "@/lib/relevance/prompt";
import {
  relevanceResponseJsonSchema,
  relevanceResponseSchema,
  type ScoredBullet,
} from "@/lib/relevance/schema";

const MODEL = "claude-opus-5";

/** One retry per batch: a schema-invalid response is usually transient. */
const MAX_ATTEMPTS = 2;

export type RelevanceOutcome =
  | { status: "SCORED"; scored: number; unscored: number; batches: number }
  | { status: "FAILED"; error: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Trimmed, de-duplicated, and with blanks dropped. */
function cleanKeywords(keywords: readonly string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const keyword of keywords) {
    const trimmed = keyword.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(trimmed);
  }

  return cleaned;
}

/** One constrained call, parsed and validated. Throws on any failure. */
async function requestScores(
  jdText: string,
  batch: readonly ScorableBullet[],
): Promise<ScoredBullet[]> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: RELEVANCE_SYSTEM_PROMPT,
    output_config: {
      format: { type: "json_schema", schema: relevanceResponseJsonSchema() },
    },
    messages: [{ role: "user", content: relevanceUserPrompt(jdText, batch) }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return relevanceResponseSchema.parse(JSON.parse(text)).scores;
}

/**
 * Score one application's job description against the bullets it is given.
 *
 * Every model call happens before any write, and the replace happens in one
 * transaction, so a failed or malformed batch leaves the previous ranking
 * exactly as it was (AC-8) rather than half-replaced. Bullets the model does
 * not return get no row and read as unscored (AC-5); ids it invents are
 * discarded. No `Bullet` row is written anywhere in here (AC-6).
 */
export async function runRelevancePass({
  applicationId,
  jdText,
  bullets,
}: {
  applicationId: string;
  jdText: string;
  bullets: readonly ScorableBullet[];
}): Promise<RelevanceOutcome> {
  if (bullets.length === 0) {
    return { status: "FAILED", error: "There are no bullets to score." };
  }

  const excerpt = jdText.slice(0, JD_SCORING_CHARS).trim();
  if (excerpt.length === 0) {
    return {
      status: "FAILED",
      error: "This application has no job description.",
    };
  }

  const requested = new Set(bullets.map((bullet) => bullet.id));
  const batches = planBatches(bullets);
  const merged = new Map<string, ScoredBullet>();

  for (const batch of batches) {
    let scores: ScoredBullet[] | null = null;
    let lastError = "";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        scores = await requestScores(excerpt, batch);
        break;
      } catch (error) {
        lastError = messageOf(error);
      }
    }

    if (!scores) {
      return {
        status: "FAILED",
        error: `Scoring failed and can be retried: ${lastError}`,
      };
    }

    for (const score of scores) {
      // An id we never sent is not this user's bullet, and would break the
      // foreign key on write.
      if (!requested.has(score.bulletId)) continue;
      merged.set(score.bulletId, score);
    }
  }

  const rows = [...merged.values()].map((score) => ({
    applicationId,
    bulletId: score.bulletId,
    score: score.score,
    matchedKeywords: cleanKeywords(score.matchedKeywords),
  }));

  try {
    await prisma.$transaction([
      // Replace rather than merge: a score from a previous run would otherwise
      // outlive the bullet's current ranking. The unique constraint on
      // (applicationId, bulletId) makes duplicates impossible either way.
      prisma.relevanceScore.deleteMany({ where: { applicationId } }),
      prisma.relevanceScore.createMany({ data: rows }),
    ]);
  } catch (error) {
    return {
      status: "FAILED",
      error: `Could not save the scores: ${messageOf(error)}`,
    };
  }

  return {
    status: "SCORED",
    scored: rows.length,
    unscored: bullets.length - rows.length,
    batches: batches.length,
  };
}
