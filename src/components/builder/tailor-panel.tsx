"use client";

import { TextDiff } from "@/components/builder/bullet-diff";
import {
  blockedBullets,
  proposedBullets,
  proposedHeaders,
  type DraftExperienceView,
} from "@/lib/draft/view";

export type TailorActions = {
  run: () => Promise<void>;
  decideBullet: (id: string, decision: "ACCEPTED" | "REJECTED") => Promise<void>;
  decideHeader: (id: string, decision: "ACCEPTED" | "REJECTED") => Promise<void>;
  acceptAll: () => Promise<void>;
  rejectAll: () => Promise<void>;
};

function Decision({
  onAccept,
  onReject,
  disabled,
}: {
  onAccept: () => void;
  onReject: () => void;
  disabled: boolean;
}) {
  return (
    <div className="mt-2 flex gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={onAccept}
        className="rounded bg-emerald-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        Accept
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onReject}
        className="rounded border border-slate-300 px-2 py-1 text-xs font-medium disabled:opacity-50"
      >
        Reject
      </button>
    </div>
  );
}

/**
 * The review queue for one tailoring run: proposals to rule on, and the
 * rewrites the numeric guard refused to offer.
 *
 * Blocked rewrites are shown rather than hidden — the point is that the user
 * sees exactly what was caught, and why.
 */
export function TailorPanel({
  draft,
  isRunning,
  isBusy,
  error,
  actions,
}: {
  draft: DraftExperienceView[];
  isRunning: boolean;
  isBusy: boolean;
  error: string | null;
  actions: TailorActions;
}) {
  const proposals = proposedBullets(draft);
  const blocked = blockedBullets(draft);
  const headers = proposedHeaders(draft);
  const isDraftEmpty = draft.length === 0;
  const pending = proposals.length + headers.length;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Tailoring</h2>
        {(pending > 0 || blocked.length > 0) && (
          <span className="text-xs text-slate-500">
            {pending} to review
            {blocked.length > 0 && ` · ${blocked.length} blocked`}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void actions.run()}
          disabled={isRunning || isDraftEmpty}
          aria-busy={isRunning}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
        >
          {isRunning ? "Tailoring…" : "Tailor to JD"}
        </button>

        {isRunning && (
          <span role="status" className="text-sm text-slate-600">
            Rewriting your draft against this posting…
          </span>
        )}

        {pending > 0 && !isRunning && (
          <>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void actions.acceptAll()}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              Accept all
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void actions.rejectAll()}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              Reject all
            </button>
          </>
        )}
      </div>

      {isDraftEmpty && (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Build a draft first — there is nothing to tailor yet.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error} Nothing was changed — you can try again.
        </p>
      )}

      {headers.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Job titles and dates
          </h3>
          <ul className="mt-2 space-y-3">
            {headers.map((experience) => (
              <li
                key={experience.id}
                className="rounded-xl border border-slate-200 p-3"
              >
                <TextDiff
                  original={experience.titleBaseline}
                  rewrite={experience.tailoredTitle ?? experience.titleBaseline}
                  originalLabel="Your title"
                  rewriteLabel="Proposed title"
                />
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <TextDiff
                    original={experience.dateBaseline || "—"}
                    rewrite={experience.tailoredDateText || "—"}
                    originalLabel="Your dates"
                    rewriteLabel="Proposed dates"
                  />
                </div>
                {experience.organization && (
                  <p className="mt-2 text-xs text-slate-400">
                    {experience.organization} — company names are never
                    rewritten.
                  </p>
                )}
                <Decision
                  disabled={isBusy}
                  onAccept={() =>
                    void actions.decideHeader(experience.id, "ACCEPTED")
                  }
                  onReject={() =>
                    void actions.decideHeader(experience.id, "REJECTED")
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {proposals.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Bullets
          </h3>
          <ul className="mt-2 space-y-3">
            {proposals.map((bullet) => (
              <li
                key={bullet.id}
                className="rounded-xl border border-slate-200 p-3"
              >
                <TextDiff
                  original={bullet.tailorBaseline}
                  rewrite={bullet.tailoredText ?? bullet.tailorBaseline}
                />
                <Decision
                  disabled={isBusy}
                  onAccept={() =>
                    void actions.decideBullet(bullet.id, "ACCEPTED")
                  }
                  onReject={() =>
                    void actions.decideBullet(bullet.id, "REJECTED")
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {blocked.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-red-700">
            Blocked — AI added a number that isn&apos;t in your source
          </h3>
          <p className="mt-1 text-xs text-slate-600">
            These rewrites introduced a figure your bullet does not contain, so
            they cannot be accepted. Both texts are shown so you can see exactly
            what was caught.
          </p>
          <ul className="mt-2 space-y-3">
            {blocked.map((bullet) => (
              <li
                key={bullet.id}
                className="rounded-xl border border-red-200 bg-red-50 p-3"
              >
                <TextDiff
                  original={bullet.tailorBaseline}
                  rewrite={bullet.tailoredText ?? ""}
                  rewriteLabel="Rejected rewrite"
                />
                {bullet.addedNumbers.length > 0 && (
                  <p className="mt-2 text-xs font-medium text-red-800">
                    Not in your bullet: {bullet.addedNumbers.join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
