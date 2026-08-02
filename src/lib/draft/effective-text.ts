import type { DraftItem } from "@prisma/client";

/**
 * What a draft item actually says right now.
 *
 * Three layers, in order: a tailored rewrite the user accepted, then their own
 * edit, then the text as it came out of the bank. Anything downstream of the
 * builder — the cover letter, and later the exports — must read the draft
 * through here, or it will quote text the user rejected.
 */
export function effectiveText(item: DraftItem): string {
  if (item.tailorStatus === "ACCEPTED" && item.tailoredText) {
    return item.tailoredText;
  }
  return item.userText ?? item.originalText;
}

export function effectiveTitle(item: DraftItem): string {
  if (item.headerTailorStatus === "ACCEPTED" && item.tailoredTitle) {
    return item.tailoredTitle;
  }
  return item.userTitle ?? item.originalTitle ?? item.originalText;
}

export function effectiveDateText(item: DraftItem): string {
  if (item.headerTailorStatus === "ACCEPTED" && item.tailoredDateText) {
    return item.tailoredDateText;
  }
  return item.userDateText ?? item.originalDateText ?? "";
}
