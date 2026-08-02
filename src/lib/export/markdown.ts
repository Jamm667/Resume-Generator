import type { DraftItem, ExperienceKind } from "@prisma/client";

import {
  effectiveDateText,
  effectiveText,
  effectiveTitle,
} from "@/lib/draft/effective-text";

/**
 * Markdown export, kept pure so the document can be tested character by
 * character without a database.
 *
 * Everything here reads the draft through `effective-text`, which is the only
 * thing standing between the user and an export that quotes a rewrite they
 * rejected — or worse, one the numeric guard blocked.
 */

export type ExportProfile = {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  links: { label: string; url: string }[];
};

/** One draft experience with its bullets and the kind it came from. */
export type ExportExperience = DraftItem & {
  children: DraftItem[];
  sourceExperience: { kind: ExperienceKind } | null;
};

/** Section order is fixed: what you did, then what you built, then school. */
const SECTIONS: { kind: ExperienceKind; heading: string }[] = [
  { kind: "JOB", heading: "Experience" },
  { kind: "PROJECT", heading: "Projects" },
  { kind: "EDUCATION", heading: "Education" },
];

/**
 * A bank entry deleted after the draft was assembled leaves the item with no
 * source. It still belongs in the resume, so it falls into Experience rather
 * than disappearing.
 */
function kindOf(experience: ExportExperience): ExperienceKind {
  return experience.sourceExperience?.kind ?? "JOB";
}

/**
 * Collapse runs of blank lines and trim the ends.
 *
 * Sections are built by joining optional pieces, so an absent date or an
 * experience with no bullets would otherwise leave a gap behind (AC-9).
 */
function tidy(markdown: string): string {
  return markdown.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** `Dana Whitfield` → `dana-whitfield`; punctuation and accents included. */
export function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    // Strip combining marks so "Zoë" becomes "zoe" rather than losing the e.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : "application";
}

/** `email · phone · location · Label: url`, skipping whatever is missing. */
function contactLine(profile: ExportProfile): string {
  const parts = [
    profile.email,
    profile.phone,
    profile.location,
    ...profile.links.map((link) => `${link.label}: ${link.url}`),
  ].filter((part): part is string => Boolean(part && part.trim().length > 0));

  return parts.join(" · ");
}

function contactHeader(profile: ExportProfile): string {
  const lines: string[] = [];

  // No name means no `#` heading rather than an empty one (AC-9).
  if (profile.fullName && profile.fullName.trim().length > 0) {
    lines.push(`# ${profile.fullName.trim()}`);
  }

  const contact = contactLine(profile);
  if (contact.length > 0) lines.push(contact);

  return lines.join("\n\n");
}

function experienceBlock(experience: ExportExperience): string {
  const title = effectiveTitle(experience);
  const organization = experience.organization?.trim() ?? "";
  const heading =
    organization.length > 0 ? `### ${title} — ${organization}` : `### ${title}`;

  const lines = [heading];

  const dates = effectiveDateText(experience).trim();
  if (dates.length > 0) lines.push(dates);

  const bullets = [...experience.children]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((bullet) => `- ${effectiveText(bullet).trim()}`);

  if (bullets.length > 0) lines.push(bullets.join("\n"));

  return lines.join("\n\n");
}

/**
 * The tailored resume. Sections with nothing in them are omitted entirely
 * rather than left as a bare heading.
 */
export function buildResumeMarkdown(
  profile: ExportProfile,
  draft: readonly ExportExperience[],
): string {
  const ordered = [...draft].sort((a, b) => a.sortOrder - b.sortOrder);
  const blocks: string[] = [];

  const header = contactHeader(profile);
  if (header.length > 0) blocks.push(header);

  for (const section of SECTIONS) {
    const items = ordered.filter(
      (experience) => kindOf(experience) === section.kind,
    );
    if (items.length === 0) continue;

    blocks.push(`## ${section.heading}`);
    for (const item of items) blocks.push(experienceBlock(item));
  }

  return tidy(blocks.join("\n\n"));
}

/**
 * The cover letter as a standalone document: the same contact header, the
 * date, who it is addressed to, then the letter exactly as the user left it.
 */
export function buildCoverLetterMarkdown({
  profile,
  companyName,
  roleTitle,
  date,
  body,
}: {
  profile: ExportProfile;
  companyName: string | null;
  roleTitle: string | null;
  date: string;
  body: string;
}): string {
  const blocks: string[] = [];

  const header = contactHeader(profile);
  if (header.length > 0) blocks.push(header);

  blocks.push(date);

  const addressee = [companyName?.trim(), roleTitle?.trim()]
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join(" — ");
  if (addressee.length > 0) blocks.push(addressee);

  blocks.push(body.trim());

  return tidy(blocks.join("\n\n"));
}

/** `{name-slug}-resume.md` and `{name-slug}-cover-letter.md`. */
export function exportFilename(
  applicationName: string,
  document: "resume" | "cover-letter",
): string {
  return `${slugify(applicationName)}-${document}.md`;
}
