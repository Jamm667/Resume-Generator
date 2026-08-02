"use client";

import { useMemo, useState } from "react";

import type {
  ReviewBulletItem,
  ReviewExperienceItem,
  ReviewItem,
} from "@/lib/bank/review-queue";

export type ReviewActions = {
  approveExperience: (id: string) => Promise<void>;
  saveExperience: (
    id: string,
    fields: { title: string; organization: string; summary: string | null },
  ) => Promise<void>;
  approveBullet: (id: string) => Promise<void>;
  saveBullet: (id: string, text: string) => Promise<void>;
  resolveDuplicate: (id: string, action: "keep-both" | "delete") => Promise<void>;
};

function Shell({
  position,
  total,
  label,
  onSkip,
  onExit,
  children,
}: {
  position: number;
  total: number;
  label: string;
  onSkip: () => void;
  onExit: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {label}
          </p>
          <p
            role="status"
            aria-live="polite"
            className="text-sm font-semibold text-slate-900"
          >
            {position} of {total}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={onExit}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100"
          >
            Done for now
          </button>
        </div>
      </div>

      <div
        className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-100"
        aria-hidden
      >
        <div
          className="h-full bg-slate-900 transition-all"
          style={{ width: `${((position - 1) / total) * 100}%` }}
        />
      </div>

      <div className="mt-4">{children}</div>
    </section>
  );
}

function ExperienceReview({
  item,
  actions,
  onDone,
}: {
  item: ReviewExperienceItem;
  actions: ReviewActions;
  onDone: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [organization, setOrganization] = useState(item.organization);
  const [summary, setSummary] = useState(item.summary ?? "");
  const [isBusy, setIsBusy] = useState(false);

  const dates =
    [item.startDate, item.isCurrent ? "Present" : item.endDate]
      .filter(Boolean)
      .join(" – ") || "No dates";

  async function run(action: () => Promise<void>) {
    setIsBusy(true);
    try {
      await action();
      onDone();
    } finally {
      setIsBusy(false);
    }
  }

  if (isEditing) {
    return (
      <div className="space-y-3">
        <label className="block text-xs font-medium text-slate-700">
          Title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
          />
        </label>
        <label className="block text-xs font-medium text-slate-700">
          Organization
          <input
            value={organization}
            onChange={(event) => setOrganization(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
          />
        </label>
        <label className="block text-xs font-medium text-slate-700">
          Summary
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
          />
        </label>

        <div className="flex gap-2">
          <button
            type="button"
            disabled={
              isBusy || title.trim().length === 0 || organization.trim().length === 0
            }
            onClick={() =>
              void run(() =>
                actions.saveExperience(item.id, {
                  title: title.trim(),
                  organization: organization.trim(),
                  summary: summary.trim().length > 0 ? summary.trim() : null,
                }),
              )
            }
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Save and next
          </button>
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-base font-semibold text-slate-900">{item.title}</h3>
      <p className="mt-0.5 text-sm text-slate-600">
        {item.organization} · {dates}
      </p>
      {item.summary && (
        <p className="mt-2 text-sm text-slate-700">{item.summary}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isBusy}
          onClick={() => void run(() => actions.approveExperience(item.id))}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
        >
          Looks right
        </button>
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium transition-colors hover:bg-slate-100"
        >
          Edit
        </button>
      </div>
    </div>
  );
}

function BulletReview({
  item,
  actions,
  onDone,
}: {
  item: ReviewBulletItem;
  actions: ReviewActions;
  onDone: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const [isBusy, setIsBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setIsBusy(true);
    try {
      await action();
      onDone();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div>
      <p className="text-xs text-slate-500">
        {item.experienceTitle}
        {item.organization && ` · ${item.organization}`}
      </p>

      {isEditing ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={4}
            aria-label="Bullet text"
            className="w-full rounded-lg border border-slate-300 p-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isBusy || text.trim().length === 0}
              onClick={() => void run(() => actions.saveBullet(item.id, text.trim()))}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Save and next
            </button>
            <button
              type="button"
              onClick={() => {
                setText(item.text);
                setIsEditing(false);
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-800">{item.text}</p>
      )}

      {item.duplicateOf && !isEditing && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-900">
            This looks like a duplicate of another bullet:
          </p>
          <p className="mt-1 text-sm text-amber-950">{item.duplicateOf.text}</p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={() =>
                void run(() => actions.resolveDuplicate(item.id, "keep-both"))
              }
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 disabled:opacity-50"
            >
              Keep both
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() =>
                void run(() => actions.resolveDuplicate(item.id, "delete"))
              }
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              Delete this one
            </button>
          </div>
        </div>
      )}

      {!isEditing && (
        <div className="mt-4 flex flex-wrap gap-2">
          {item.needsReview && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void run(() => actions.approveBullet(item.id))}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              Looks right
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium transition-colors hover:bg-slate-100"
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * One item at a time, with a one-click confirm.
 *
 * The queue comes from the server on every render, so resolving an item drops
 * it and a reload resumes with whatever is left rather than starting over. Skips
 * live only in this session — a skipped item is still flagged, it just moves to
 * the back of the line so the queue keeps moving.
 */
export function ReviewQueue({
  queue,
  actions,
  onExit,
}: {
  queue: ReviewItem[];
  actions: ReviewActions;
  onExit: () => void;
}) {
  const [skipped, setSkipped] = useState<string[]>([]);
  // Fixed on mount so the denominator does not shrink under the user as they
  // work through the queue.
  const [total] = useState(queue.length);

  const ordered = useMemo(() => {
    const skippedSet = new Set(skipped);
    const pending = queue.filter((item) => !skippedSet.has(item.id));
    const deferred = queue.filter((item) => skippedSet.has(item.id));
    return [...pending, ...deferred];
  }, [queue, skipped]);

  const current = ordered[0];

  if (!current) {
    return (
      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <h2 className="text-base font-semibold text-emerald-900">
          Nothing left to review
        </h2>
        <p className="mt-1 text-sm text-emerald-800">
          Every entry has been confirmed. Your bank is ready to build from.
        </p>
        <button
          type="button"
          onClick={onExit}
          className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
        >
          Back to the bank
        </button>
      </section>
    );
  }

  // Counts how many have been cleared, not where we sit in the array — the
  // queue shrinks as items are resolved, and skipping only reorders it.
  const position = Math.min(Math.max(total - queue.length + 1, 1), total);

  return (
    <Shell
      position={position}
      total={total}
      label={current.type === "EXPERIENCE" ? "Experience" : "Bullet"}
      onSkip={() => setSkipped((previous) => [...previous, current.id])}
      onExit={onExit}
    >
      {current.type === "EXPERIENCE" ? (
        <ExperienceReview
          key={current.id}
          item={current}
          actions={actions}
          onDone={() => undefined}
        />
      ) : (
        <BulletReview
          key={current.id}
          item={current}
          actions={actions}
          onDone={() => undefined}
        />
      )}
    </Shell>
  );
}
