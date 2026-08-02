"use client";

import { useDraggable } from "@dnd-kit/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import type { ExperienceSummary } from "@/lib/queries/bank";
import {
  bandOf,
  hasAnyScore,
  MODERATE_SCORE,
  STRONG_SCORE,
  type LibraryBullet,
  type RelevanceBand,
} from "@/lib/relevance/library";

/** Three bands, visually distinct at a glance rather than by reading numbers. */
const BAND_STYLE: Record<RelevanceBand, string> = {
  strong: "border-emerald-300 bg-emerald-50",
  moderate: "border-amber-300 bg-amber-50",
  weak: "border-slate-200 bg-white",
  unscored: "border-dashed border-slate-300 bg-white",
};

const BADGE_STYLE: Record<RelevanceBand, string> = {
  strong: "bg-emerald-600 text-white",
  moderate: "bg-amber-500 text-white",
  weak: "bg-slate-200 text-slate-700",
  unscored: "bg-slate-100 text-slate-500",
};

const BAND_LABEL: Record<RelevanceBand, string> = {
  strong: "Strong match",
  moderate: "Moderate match",
  weak: "Weak match",
  unscored: "Not scored",
};

/** A grab handle that starts a drag, or an explanation of why it cannot. */
function DragHandle({
  id,
  data,
  label,
  disabled,
}: {
  id: string;
  data: Record<string, unknown>;
  label: string;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data,
    disabled,
  });

  return (
    <button
      type="button"
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      disabled={disabled}
      aria-label={label}
      className={`shrink-0 rounded px-1 text-slate-400 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 ${
        isDragging ? "opacity-40" : "cursor-grab"
      }`}
    >
      ⠿
    </button>
  );
}

function ExperienceRow({
  experience,
  isUsed,
}: {
  experience: ExperienceSummary;
  isUsed: boolean;
}) {
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-start gap-2">
        <DragHandle
          id={`lib-experience-${experience.id}`}
          data={{ source: "library", kind: "EXPERIENCE", sourceId: experience.id }}
          label={`Drag ${experience.title} into the draft`}
          disabled={isUsed}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800">
            {experience.title}
          </p>
          <p className="text-xs text-slate-500">
            {[experience.organization, experience.dateText]
              .filter(Boolean)
              .join(" · ")}{" "}
            · {experience.bulletCount} bullet
            {experience.bulletCount === 1 ? "" : "s"}
          </p>
        </div>
        {isUsed && (
          <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-700">
            In draft
          </span>
        )}
      </div>
    </li>
  );
}

function BulletRow({
  bullet,
  isUsed,
}: {
  bullet: LibraryBullet;
  isUsed: boolean;
}) {
  const band = bandOf(bullet.score);

  return (
    <li className={`rounded-xl border p-3 ${BAND_STYLE[band]}`}>
      <div className="flex items-start justify-between gap-3">
        <DragHandle
          id={`lib-bullet-${bullet.id}`}
          data={{ source: "library", kind: "BULLET", sourceId: bullet.id }}
          label={`Drag bullet into the draft: ${bullet.text.slice(0, 40)}`}
          disabled={isUsed}
        />
        <p className="min-w-0 flex-1 text-sm text-slate-800">{bullet.text}</p>
        {isUsed && (
          <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-700">
            In draft
          </span>
        )}
        <span
          title={BAND_LABEL[band]}
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE_STYLE[band]}`}
        >
          {bullet.score === null ? "Not scored" : bullet.score}
        </span>
      </div>

      <p className="mt-1 text-xs text-slate-500">
        {bullet.experienceTitle}
        {bullet.experienceOrganization && ` · ${bullet.experienceOrganization}`}
      </p>

      {bullet.matchedKeywords.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {bullet.matchedKeywords.map((keyword) => (
            <li
              key={keyword}
              className="rounded-full bg-white/70 px-2 py-0.5 text-xs text-slate-700 ring-1 ring-slate-300"
            >
              {keyword}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The data bank ranked against this application's job description.
 *
 * Bullets arrive already sorted by score. Nothing here writes to the bank —
 * the only request it makes is the scoring pass itself.
 */
export function LibraryPane({
  applicationId,
  bullets,
  experiences,
  usedBulletIds,
  usedExperienceIds,
}: {
  applicationId: string;
  bullets: LibraryBullet[];
  experiences: ExperienceSummary[];
  /** Source ids already in the draft, so they can be marked and not re-added. */
  usedBulletIds: string[];
  usedExperienceIds: string[];
}) {
  const router = useRouter();
  const usedBullets = useMemo(() => new Set(usedBulletIds), [usedBulletIds]);
  const usedExperiences = useMemo(
    () => new Set(usedExperienceIds),
    [usedExperienceIds],
  );
  const [isScoring, setIsScoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The real double-fire guard. `isScoring` is captured per render, so two
   * clicks landing before React commits the state update would both read it as
   * false and both send a request — measured, not theorised. A ref updates
   * synchronously, so the second click sees the first immediately.
   */
  const isRunning = useRef(false);

  const [hideWeak, setHideWeak] = useState(false);

  const isBankEmpty = bullets.length === 0;
  const hasScores = hasAnyScore(bullets);

  const counts = useMemo(() => {
    const tally = { strong: 0, moderate: 0, weak: 0, unscored: 0 };
    for (const bullet of bullets) tally[bandOf(bullet.score)] += 1;
    return tally;
  }, [bullets]);

  // Unscored bullets are never hidden by the filter: they are not weak, they
  // are unmeasured, and burying them is exactly what AC-5 forbids.
  const visible = useMemo(
    () =>
      hideWeak
        ? bullets.filter((bullet) => bandOf(bullet.score) !== "weak")
        : bullets,
    [bullets, hideWeak],
  );

  const scored = visible.filter((bullet) => bullet.score !== null);
  const unscored = visible.filter((bullet) => bullet.score === null);

  async function findRelevant() {
    if (isRunning.current) return;
    isRunning.current = true;

    setIsScoring(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/applications/${applicationId}/relevance`,
        { method: "POST" },
      );
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(data?.error ?? `Scoring failed (${response.status}).`);
        return;
      }

      // Only on success: a failed run must leave the ranking on screen.
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      isRunning.current = false;
      setIsScoring(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Relevant experience</h2>
        {hasScores && (
          <span className="text-xs text-slate-500">
            {counts.strong} strong · {counts.moderate} moderate · {counts.weak}{" "}
            weak
            {counts.unscored > 0 && ` · ${counts.unscored} not scored`}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void findRelevant()}
          disabled={isScoring || isBankEmpty}
          aria-busy={isScoring}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
        >
          {isScoring
            ? "Scoring…"
            : hasScores
              ? "Score again"
              : "Find relevant experience"}
        </button>

        {isScoring && (
          <span role="status" className="text-sm text-slate-600">
            Scoring {bullets.length} bullet{bullets.length === 1 ? "" : "s"}{" "}
            against this posting…
          </span>
        )}

        {hasScores && !isScoring && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={hideWeak}
              onChange={(event) => setHideWeak(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Hide weak matches (below {MODERATE_SCORE})
          </label>
        )}
      </div>

      {isBankEmpty && (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Your data bank is empty, so there is nothing to rank yet.{" "}
          <Link href="/upload" className="font-medium underline">
            Upload a resume
          </Link>{" "}
          to fill it.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error} Your previous ranking is unchanged — try again.
        </p>
      )}

      {!isBankEmpty && !hasScores && (
        <p className="mt-3 text-sm text-slate-500">
          {bullets.length} bullet{bullets.length === 1 ? "" : "s"} in your bank.
          Score them to see which ones this posting actually asks for, ranked
          strongest first.
        </p>
      )}

      {experiences.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Experiences
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Drag a whole experience into the draft and its bullets come with it.
          </p>
          <ul className="mt-2 space-y-2">
            {experiences.map((experience) => (
              <ExperienceRow
                key={experience.id}
                experience={experience}
                isUsed={usedExperiences.has(experience.id)}
              />
            ))}
          </ul>
        </div>
      )}

      {(scored.length > 0 || unscored.length > 0) && (
        <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Bullets
        </h3>
      )}

      {scored.length > 0 && (
        <ul className="mt-2 space-y-2">
          {scored.map((bullet) => (
            <BulletRow
              key={bullet.id}
              bullet={bullet}
              isUsed={usedBullets.has(bullet.id)}
            />
          ))}
        </ul>
      )}

      {hasScores && unscored.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Not scored yet
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Added to your bank after the last run, so they have no score — not a
            low one. Score again to rank them.
          </p>
          <ul className="mt-2 space-y-2">
            {unscored.map((bullet) => (
              <BulletRow key={bullet.id} bullet={bullet} isUsed={usedBullets.has(bullet.id)} />
            ))}
          </ul>
        </div>
      )}

      {hasScores && visible.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">
          Every bullet scored below {MODERATE_SCORE} and the filter is hiding
          them. Uncheck it to see them, or score again after adding experience
          closer to this posting.
        </p>
      )}

      {hasScores && (
        <p className="mt-4 text-xs text-slate-400">
          Strong is {STRONG_SCORE} and above, moderate {MODERATE_SCORE} to{" "}
          {STRONG_SCORE - 1}, weak below {MODERATE_SCORE}.
        </p>
      )}
    </section>
  );
}
