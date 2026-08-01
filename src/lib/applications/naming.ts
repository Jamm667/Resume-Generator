/**
 * Naming rules for a new application.
 *
 * Kept out of the route module because a Next.js route file may only export
 * route handlers — an extra export there fails the build's route type check.
 */

/** Short enough to be a paste accident rather than a posting. */
export const MIN_JD_CHARS = 100;

/** Fallback name length when there is no company or role to build one from. */
const NAME_FALLBACK_CHARS = 60;

/**
 * A readable default the user can change. "{company} — {role}" when we have
 * them, otherwise the opening of the JD, which at least says which posting it
 * is.
 */
export function defaultApplicationName(
  companyName: string | null,
  roleTitle: string | null,
  jdText: string,
): string {
  if (companyName && roleTitle) return `${companyName} — ${roleTitle}`;
  if (companyName) return companyName;
  if (roleTitle) return roleTitle;

  const opening = jdText.trim().replace(/\s+/g, " ");
  return opening.length <= NAME_FALLBACK_CHARS
    ? opening
    : `${opening.slice(0, NAME_FALLBACK_CHARS).trimEnd()}…`;
}
