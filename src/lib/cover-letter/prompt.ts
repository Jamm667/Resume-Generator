export const COVER_LETTER_TONES = [
  "FORMAL",
  "CONVERSATIONAL",
  "DIRECT",
] as const;

export type CoverLetterTone = (typeof COVER_LETTER_TONES)[number];

export const MIN_WORDS = 250;
export const MAX_WORDS = 400;

const TONE_GUIDANCE: Record<CoverLetterTone, string> = {
  FORMAL:
    "Formal: complete sentences, professional register, no contractions, no exclamation marks. Respectful without being deferential.",
  CONVERSATIONAL:
    "Conversational: warm and human, contractions welcome, first person, the way a competent person writes to someone they respect. Never chatty or cute.",
  DIRECT:
    "Direct: short sentences, plain words, no throat-clearing. Every sentence earns its place. Never brusque or rude.",
};

/**
 * BLUF is the whole point of the letter: the reader decides in the first two
 * lines whether to keep reading, so the claim goes there rather than after a
 * paragraph of autobiography.
 *
 * The no-fabrication rule is the same one bullet tailoring is held to. This
 * letter is submitted as the user's own account of their history, so an
 * invented employer or metric would be a lie told on their behalf.
 */
export const COVER_LETTER_SYSTEM_PROMPT = [
  "You write one cover letter from a candidate's own resume draft.",
  "",
  "Bottom line up front:",
  "- The first paragraph states the specific claim for this role and the single",
  "  strongest reason to believe it. Name the role. No biography, no history of",
  "  how they came to apply, no 'I am writing to express my interest'.",
  "- Everything after it supports that claim with evidence from the draft.",
  "",
  "Never invent:",
  "- Use only what the draft and the profile contain. No employer, tool,",
  "  technology, credential, certification, degree, team size, duration, or",
  "  metric that is not already there.",
  "- Never introduce a number that is not in the draft or profile.",
  "- If the draft is thin on something the posting wants, say less rather than",
  "  filling the gap. Omitting is honest; inventing is not.",
  "",
  "Form:",
  `- Between ${MIN_WORDS} and ${MAX_WORDS} words.`,
  "- Plain prose in paragraphs. No headings, no bullet points, no markdown, no",
  "  bold or italics.",
  "- Open with a greeting that is already resolved. If no hiring manager is",
  '  named, write "Dear Hiring Team," or similar. Never emit a bracketed',
  '  placeholder such as "[Name]" or "[Company]" anywhere in the letter.',
  "- Close with a plain sign-off. Do not add a postal address block.",
  "- Return the letter text only, with no preamble, commentary, or quotation",
  "  marks around it.",
].join("\n");

export type CoverLetterPayload = {
  companyName: string;
  roleTitle: string;
  tone: CoverLetterTone;
  jdText: string;
  profile: string;
  draft: string;
};

export function coverLetterUserPrompt(payload: CoverLetterPayload): string {
  return [
    `Tone — ${TONE_GUIDANCE[payload.tone]}`,
    "",
    `Company: ${payload.companyName || "not named in the posting"}`,
    `Role: ${payload.roleTitle || "not named in the posting"}`,
    "",
    "Job description:",
    `<jd>\n${payload.jdText}\n</jd>`,
    "",
    "The candidate's contact block:",
    `<profile>\n${payload.profile}\n</profile>`,
    "",
    "The candidate's resume draft for this application — the only experience",
    "you may draw on:",
    `<draft>\n${payload.draft}\n</draft>`,
  ].join("\n");
}
