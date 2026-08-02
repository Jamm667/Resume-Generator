/**
 * A word-level diff, so the user can see exactly what the model changed rather
 * than reading two paragraphs and guessing.
 *
 * Written here rather than pulled in as a dependency: it is a textbook LCS over
 * a handful of words, and the diff is the main evidence the user has that
 * nothing was invented, so it is worth being able to read the code.
 */

export type DiffPart = {
  type: "same" | "added" | "removed";
  text: string;
};

/** Split into words while keeping the whitespace that separated them. */
function words(text: string): string[] {
  return text.split(/(\s+)/).filter((part) => part.length > 0);
}

/** Longest common subsequence table over two token lists. */
function lcsLengths(a: readonly string[], b: readonly string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  return table;
}

/** Merge neighbouring parts of the same type so the markup stays readable. */
function coalesce(parts: readonly DiffPart[]): DiffPart[] {
  const merged: DiffPart[] = [];

  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (last && last.type === part.type) last.text += part.text;
    else merged.push({ ...part });
  }

  return merged;
}

/**
 * The change from `original` to `rewrite`, as a flat run of parts.
 *
 * Comparison ignores case and surrounding punctuation so that re-casing a word
 * does not light up the whole line, but the text returned is always verbatim.
 */
export function wordDiff(original: string, rewrite: string): DiffPart[] {
  const a = words(original);
  const b = words(rewrite);
  const table = lcsLengths(a, b);

  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      parts.push({ type: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      parts.push({ type: "removed", text: a[i] });
      i += 1;
    } else {
      parts.push({ type: "added", text: b[j] });
      j += 1;
    }
  }

  while (i < a.length) {
    parts.push({ type: "removed", text: a[i] });
    i += 1;
  }
  while (j < b.length) {
    parts.push({ type: "added", text: b[j] });
    j += 1;
  }

  return coalesce(parts);
}

/** Only what the original contributes: the left-hand side of the comparison. */
export function originalParts(parts: readonly DiffPart[]): DiffPart[] {
  return parts.filter((part) => part.type !== "added");
}

/** Only what the rewrite contributes: the right-hand side. */
export function rewriteParts(parts: readonly DiffPart[]): DiffPart[] {
  return parts.filter((part) => part.type !== "removed");
}
