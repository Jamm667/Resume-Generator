"use client";

import { useMemo } from "react";

import {
  originalParts,
  rewriteParts,
  wordDiff,
  type DiffPart,
} from "@/lib/tailor/diff";

function Side({
  label,
  parts,
  highlight,
}: {
  label: string;
  parts: DiffPart[];
  highlight: "removed" | "added";
}) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-sm text-slate-800">
        {parts.map((part, index) =>
          part.type === highlight ? (
            <mark
              key={index}
              className={
                highlight === "added"
                  ? "rounded bg-emerald-100 text-emerald-900"
                  : "rounded bg-red-100 text-red-900 line-through"
              }
            >
              {part.text}
            </mark>
          ) : (
            <span key={index}>{part.text}</span>
          ),
        )}
      </p>
    </div>
  );
}

/**
 * One proposal, original on the left and rewrite on the right, with the words
 * that changed highlighted on each side.
 *
 * The diff is the user's main evidence that nothing was invented, so both texts
 * are always shown in full rather than collapsed to the changed words.
 */
export function TextDiff({
  original,
  rewrite,
  originalLabel = "Yours",
  rewriteLabel = "Proposed",
}: {
  original: string;
  rewrite: string;
  originalLabel?: string;
  rewriteLabel?: string;
}) {
  const parts = useMemo(() => wordDiff(original, rewrite), [original, rewrite]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Side
        label={originalLabel}
        parts={originalParts(parts)}
        highlight="removed"
      />
      <Side
        label={rewriteLabel}
        parts={rewriteParts(parts)}
        highlight="added"
      />
    </div>
  );
}
