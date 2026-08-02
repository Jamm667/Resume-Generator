/**
 * The no-fabrication rule is the point of this prompt. Everything it emits is
 * offered to the user as their own history, and a number or an employer the
 * model invented would be indistinguishable from one they actually earned.
 *
 * Bullets are held to that rule; titles and dates are deliberately not. That
 * asymmetry is a product decision (RE-10 AC-12, AC-13), spelled out here so the
 * model is not left guessing which fields it may reshape.
 */
export const TAILOR_SYSTEM_PROMPT = [
  "You reframe an existing resume draft in the vocabulary of one job",
  "description. You are not writing a new resume — you are re-wording the one",
  "you are given.",
  "",
  "Bullets — strict:",
  "- Never add a fact the bullet does not already contain. No employer, tool,",
  "  technology, credential, certification, team size, duration, or metric that",
  "  is not already there.",
  "- Never introduce a number. If the bullet has no figure, the rewrite has no",
  "  figure. If it has one, reuse it exactly — do not round it, scale it, or",
  "  convert its units.",
  "- What you may do: reorder the clauses, lead with the outcome, and swap",
  "  wording for the posting's own vocabulary where it genuinely means the same",
  "  thing.",
  "- Keep it one bullet. Do not split, merge, or add bullets.",
  "- If a bullet already reads well against this posting, return it unchanged.",
  "",
  "Job titles and date strings — full latitude:",
  "- Rewrite the title to the closest equivalent the posting would recognise,",
  '  even if that is a different discipline ("UX Designer" to "Project',
  '  Coordinator"). Seniority may change.',
  "- Rewrite the date string freely, including month and year values.",
  "- These two fields are exempt from every rule above. The numeric restriction",
  "  applies to bullet text only.",
  "",
  "Never rewrite the company or organisation name. You are not given it, and",
  "you must not infer or introduce one.",
  "",
  "Return every id you were given, exactly once, using that exact id.",
].join("\n");

export type TailorPayload = {
  jdText: string;
  bullets: readonly { id: string; text: string }[];
  experiences: readonly { id: string; title: string; dateText: string }[];
};

/**
 * The draft as the model sees it. Note what is absent: no organisation, no
 * source resume, no scores — only the text it is allowed to touch (AC-16).
 */
export function tailorUserPrompt(payload: TailorPayload): string {
  const bullets = payload.bullets
    .map((bullet) => `<bullet id="${bullet.id}">${bullet.text}</bullet>`)
    .join("\n");

  const experiences = payload.experiences
    .map(
      (experience) =>
        `<experience id="${experience.id}">\n  <title>${experience.title}</title>\n  <dates>${experience.dateText}</dates>\n</experience>`,
    )
    .join("\n");

  return [
    "Job description:",
    "",
    `<jd>\n${payload.jdText}\n</jd>`,
    "",
    "Rewrite each of these against it.",
    "",
    `<bullets>\n${bullets}\n</bullets>`,
    "",
    `<experiences>\n${experiences}\n</experiences>`,
  ].join("\n");
}
