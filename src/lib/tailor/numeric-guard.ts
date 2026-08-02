/**
 * The deterministic half of the anti-fabrication defence.
 *
 * A model told not to invent metrics will still occasionally produce "led a
 * team of 12" from "led a team". Prompting cannot be relied on for that, and a
 * fabricated number in a resume is the single most damaging thing this app
 * could ship — so every number in a proposed rewrite must already exist in the
 * bullet it came from, checked here rather than asked for politely.
 *
 * Bullets only. Titles and dates are rewritten with full latitude by explicit
 * product decision (RE-10 NG-5), and this module must never be pointed at them.
 */

/**
 * One numeric literal with whatever makes it mean something: a currency sign
 * in front, a percent or magnitude suffix behind. `$2M` and `$3M` are
 * different tokens, and so are `30` and `30%`.
 */
const NUMERIC_TOKEN = /([$£€]?)(\d[\d,]*(?:\.\d+)?)(\s*%|[kmbx]\b)?/gi;

/** Same number written two ways should compare equal: 1,200 and 1200. */
function canonical(currency: string, digits: string, suffix: string): string {
  return (
    currency + digits.replace(/,/g, "") + suffix.replace(/\s+/g, "").toLowerCase()
  );
}

/**
 * Every numeric token in a piece of text, canonicalised.
 *
 * `24/7` is two tokens because the slash is not part of a number; `3.5x` is one
 * because the decimal and the magnitude suffix belong to it.
 */
export function numericTokens(text: string): string[] {
  const tokens: string[] = [];

  for (const match of text.matchAll(NUMERIC_TOKEN)) {
    tokens.push(canonical(match[1] ?? "", match[2], match[3] ?? ""));
  }

  return tokens;
}

/**
 * Numbers the rewrite introduced that the original never contained.
 *
 * Dropping a number is fine — that is editing. Reordering is fine. Only
 * addition is fabrication, so only addition is reported.
 */
export function addedNumbers(original: string, rewrite: string): string[] {
  const source = new Set(numericTokens(original));
  const added: string[] = [];

  for (const token of numericTokens(rewrite)) {
    if (!source.has(token) && !added.includes(token)) added.push(token);
  }

  return added;
}

/** True when the rewrite must not be offered to the user. */
export function isFabricated(original: string, rewrite: string): boolean {
  return addedNumbers(original, rewrite).length > 0;
}
