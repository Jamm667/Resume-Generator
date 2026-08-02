import type { DraftItem, ExperienceKind } from "@prisma/client";

import {
  effectiveDateText,
  effectiveText,
  effectiveTitle,
} from "@/lib/draft/effective-text";

/**
 * The structured document both exports render from.
 *
 * There is one content path on purpose: every rule about *what* the resume
 * says — which text a tailored bullet uses, what order sections come in, what
 * belongs in the contact line — is decided here, once. A renderer's only job is
 * to put these strings on a page.
 *
 * Everything reads the draft through `effective-text`, which is the only thing
 * standing between the user and an export quoting a rewrite they rejected — or
 * worse, one the numeric guard blocked.
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

export type DocumentExperience = {
  /** `Title — Organization`, or just the title when there is no organization. */
  heading: string;
  dateText: string;
  bullets: string[];
};

export type DocumentSection = {
  heading: string;
  experiences: DocumentExperience[];
};

export type ResumeDocument = {
  name: string | null;
  contact: string;
  sections: DocumentSection[];
};

export type LetterDocument = {
  name: string | null;
  contact: string;
  date: string;
  addressee: string;
  paragraphs: string[];
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
export function contactLine(profile: ExportProfile): string {
  const parts = [
    profile.email,
    profile.phone,
    profile.location,
    ...profile.links.map((link) => `${link.label}: ${link.url}`),
  ].filter((part): part is string => Boolean(part && part.trim().length > 0));

  return parts.join(" · ");
}

function trimmedName(profile: ExportProfile): string | null {
  const name = profile.fullName?.trim() ?? "";
  return name.length > 0 ? name : null;
}

function experienceOf(experience: ExportExperience): DocumentExperience {
  const title = effectiveTitle(experience);
  const organization = experience.organization?.trim() ?? "";

  return {
    heading: organization.length > 0 ? `${title} — ${organization}` : title,
    dateText: effectiveDateText(experience).trim(),
    bullets: [...experience.children]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((bullet) => effectiveText(bullet).trim())
      .filter((text) => text.length > 0),
  };
}

/**
 * The tailored resume. Sections with nothing in them are omitted entirely
 * rather than surviving as a bare heading.
 */
export function buildResumeDocument(
  profile: ExportProfile,
  draft: readonly ExportExperience[],
): ResumeDocument {
  const ordered = [...draft].sort((a, b) => a.sortOrder - b.sortOrder);

  const sections: DocumentSection[] = [];
  for (const section of SECTIONS) {
    const experiences = ordered
      .filter((experience) => kindOf(experience) === section.kind)
      .map(experienceOf);

    if (experiences.length > 0) {
      sections.push({ heading: section.heading, experiences });
    }
  }

  return {
    name: trimmedName(profile),
    contact: contactLine(profile),
    sections,
  };
}

/**
 * The cover letter as a standalone document: the same contact header, the
 * date, who it is addressed to, then the letter exactly as the user left it.
 */
export function buildLetterDocument({
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
}): LetterDocument {
  const addressee = [companyName?.trim(), roleTitle?.trim()]
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join(" — ");

  return {
    name: trimmedName(profile),
    contact: contactLine(profile),
    date,
    addressee,
    paragraphs: body
      .trim()
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph.length > 0),
  };
}

/** Every bullet in the document, in reading order. */
export function resumeBullets(document: ResumeDocument): string[] {
  return document.sections.flatMap((section) =>
    section.experiences.flatMap((experience) => experience.bullets),
  );
}

/** `{name-slug}-resume.pdf` and `{name-slug}-cover-letter.pdf`. */
export function exportFilename(
  applicationName: string,
  document: "resume" | "cover-letter",
): string {
  return `${slugify(applicationName)}-${document}.pdf`;
}
