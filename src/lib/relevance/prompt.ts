/**
 * Ranking only. The model never sees a rewrite instruction here — RE-10 owns
 * rewriting, and a prompt that invites better wording would produce text the
 * user never wrote sitting next to text they did.
 */
export const RELEVANCE_SYSTEM_PROMPT = [
  "You rate how relevant each resume bullet is to one job description.",
  "",
  "Rules:",
  "- Score every bullet you are given, from 0 to 100. 100 means the bullet is",
  "  direct evidence for something the posting asks for; 0 means the posting",
  "  gives no reason to include it.",
  "- Judge the bullet on what it says, not on how well it is written. A plainly",
  "  worded bullet about the exact required skill outranks a polished one about",
  "  something the posting never mentions.",
  "- matchedKeywords must be terms copied from the job description itself —",
  "  skills, tools, responsibilities, or qualifications it names — that this",
  "  bullet is evidence for. Copy them as the posting writes them. Never invent",
  "  a keyword the posting does not contain, and return an empty array when the",
  "  bullet matches nothing.",
  "- Never rewrite, shorten, correct, or comment on a bullet. You return scores",
  "  and keywords only.",
  "- Return one entry per bullet id you were given, using that exact id, and no",
  "  entries for ids you were not given.",
].join("\n");

/** One batch of bullets, tagged with the ids the response must come back with. */
export function relevanceUserPrompt(
  jdText: string,
  bullets: readonly { id: string; text: string }[],
): string {
  const list = bullets
    .map((bullet) => `<bullet id="${bullet.id}">${bullet.text}</bullet>`)
    .join("\n");

  return [
    "Job description:",
    "",
    `<jd>\n${jdText}\n</jd>`,
    "",
    `Score these ${bullets.length} resume bullets against it.`,
    "",
    `<bullets>\n${list}\n</bullets>`,
  ].join("\n");
}
