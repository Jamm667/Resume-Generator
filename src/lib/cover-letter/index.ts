import type { DraftItem, Profile } from "@prisma/client";

import { getAnthropicClient } from "@/lib/anthropic";
import { prisma } from "@/lib/db";
import {
  COVER_LETTER_SYSTEM_PROMPT,
  coverLetterUserPrompt,
  type CoverLetterTone,
} from "@/lib/cover-letter/prompt";
import {
  effectiveDateText,
  effectiveText,
  effectiveTitle,
} from "@/lib/draft/effective-text";
import { parseStoredLinks } from "@/lib/validation/profile";

const MODEL = "claude-opus-5";

/** Enough of the posting to write against. */
export const JD_LETTER_CHARS = 12_000;

export type CoverLetterFailure = "NOT_FOUND" | "EMPTY_DRAFT" | "UPSTREAM";

export type CoverLetterOutcome =
  | { status: "GENERATED"; text: string; words: number }
  | { status: "FAILED"; reason: CoverLetterFailure; error: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/**
 * The draft as prose the model can read, using each item's effective text so
 * an accepted rewrite is what the letter draws on and a rejected one is not.
 */
export function draftToText(items: readonly DraftItem[]): string {
  const experiences = items.filter((item) => item.kind === "EXPERIENCE");
  const sections: string[] = [];

  for (const experience of [...experiences].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  )) {
    const header = [
      effectiveTitle(experience),
      experience.organization,
      effectiveDateText(experience),
    ]
      .filter((part) => part && part.length > 0)
      .join(" · ");

    const bullets = items
      .filter(
        (item) => item.kind === "BULLET" && item.parentDraftItemId === experience.id,
      )
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((bullet) => `- ${effectiveText(bullet)}`);

    sections.push([header, ...bullets].join("\n"));
  }

  return sections.join("\n\n");
}

/** The contact block as prose. Absent fields are simply left out. */
export function profileToText(profile: Profile | null): string {
  if (!profile) return "No profile on file.";

  const links = parseStoredLinks(profile.links)
    .map((link) => `${link.label}: ${link.url}`)
    .join(", ");

  const lines = [
    profile.fullName && `Name: ${profile.fullName}`,
    profile.headline && `Headline: ${profile.headline}`,
    profile.location && `Location: ${profile.location}`,
    profile.email && `Email: ${profile.email}`,
    profile.phone && `Phone: ${profile.phone}`,
    links && `Links: ${links}`,
  ].filter((line): line is string => Boolean(line));

  return lines.length > 0 ? lines.join("\n") : "No profile on file.";
}

/**
 * Write one cover letter for an application.
 *
 * The letter is only stored once the model has returned something usable, so a
 * failure leaves any existing letter exactly as it was (AC-9).
 */
export async function generateCoverLetter(
  applicationId: string,
  userId: string,
  tone: CoverLetterTone,
): Promise<CoverLetterOutcome> {
  const application = await prisma.application.findFirst({
    where: { id: applicationId, userId },
    select: {
      id: true,
      jdText: true,
      companyName: true,
      roleTitle: true,
    },
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
  });

  if (!items.some((item) => item.kind === "BULLET")) {
    return {
      status: "FAILED",
      reason: "EMPTY_DRAFT",
      error:
        "Build a draft first — a letter with no experience behind it is not worth writing.",
    };
  }

  const profile = await prisma.profile.findUnique({ where: { userId } });

  try {
    const client = getAnthropicClient();

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: COVER_LETTER_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: coverLetterUserPrompt({
            companyName: application.companyName ?? "",
            roleTitle: application.roleTitle ?? "",
            tone,
            jdText: application.jdText.slice(0, JD_LETTER_CHARS).trim(),
            profile: profileToText(profile),
            draft: draftToText(items),
          }),
        },
      ],
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (text.length === 0) {
      return {
        status: "FAILED",
        reason: "UPSTREAM",
        error: "The model returned an empty letter. Try again.",
      };
    }

    await prisma.application.update({
      where: { id: application.id },
      data: { coverLetterText: text, coverLetterTone: tone },
    });

    return { status: "GENERATED", text, words: wordCount(text) };
  } catch (error) {
    return {
      status: "FAILED",
      reason: "UPSTREAM",
      error: `Could not write the letter, and it can be retried: ${messageOf(error)}`,
    };
  }
}
