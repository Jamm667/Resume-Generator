"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/bank/confirm-dialog";
import { DuplicateDialog } from "@/components/bank/duplicate-dialog";
import {
  ExperienceCard,
  type FieldDraft,
} from "@/components/bank/experience-card";
import type { Bank, BankBullet, BankExperience } from "@/lib/queries/bank";
import { EXPERIENCE_KINDS } from "@/lib/structure/schema";

const GROUP_LABEL: Record<BankExperience["kind"], string> = {
  JOB: "Jobs",
  PROJECT: "Projects",
  EDUCATION: "Education",
};

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });

  if (!response.ok) {
    const message = await response
      .json()
      .then((data) => data?.error as string)
      .catch(() => null);
    throw new Error(message ?? `Request failed (${response.status}).`);
  }

  return response.json() as Promise<T>;
}

type PendingDelete =
  | { type: "experience"; experience: BankExperience }
  | { type: "bullet"; bullet: BankBullet };

export function BankView({ initialBank }: { initialBank: Bank }) {
  const [experiences, setExperiences] = useState<BankExperience[]>(() =>
    EXPERIENCE_KINDS.flatMap((kind) => initialBank[kind]),
  );
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [duplicate, setDuplicate] = useState<BankBullet | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  function replaceExperience(updated: BankExperience) {
    setExperiences((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item)),
    );
  }

  function patchBullets(
    experienceId: string,
    update: (bullets: BankBullet[]) => BankBullet[],
  ) {
    setExperiences((prev) =>
      prev.map((item) =>
        item.id === experienceId
          ? { ...item, bullets: update(item.bullets) }
          : item,
      ),
    );
  }

  const visible = useMemo(() => {
    if (!needsReviewOnly) return experiences;
    // An experience stays visible when it, or any of its bullets, needs review.
    return experiences.filter(
      (experience) =>
        experience.needsReview ||
        experience.bullets.some((bullet) => bullet.needsReview),
    );
  }, [experiences, needsReviewOnly]);

  const reviewCount = useMemo(
    () =>
      experiences.filter(
        (experience) =>
          experience.needsReview ||
          experience.bullets.some((bullet) => bullet.needsReview),
      ).length,
    [experiences],
  );

  async function confirmDelete() {
    if (!pendingDelete) return;
    setIsDeleting(true);
    setError(null);
    try {
      if (pendingDelete.type === "experience") {
        const { experience } = pendingDelete;
        await send(`/api/experiences/${experience.id}`, "DELETE");
        setExperiences((prev) => prev.filter((item) => item.id !== experience.id));
      } else {
        const { bullet } = pendingDelete;
        await send(`/api/bullets/${bullet.id}`, "DELETE");
        patchBullets(bullet.experienceId, (bullets) =>
          bullets.filter((item) => item.id !== bullet.id),
        );
      }
      setPendingDelete(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsDeleting(false);
    }
  }

  if (experiences.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <h2 className="text-sm font-semibold">Your data bank is empty</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
          Upload a resume and everything in it becomes editable entries here.
        </p>
        <Link
          href="/upload"
          className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
        >
          Upload a resume
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={needsReviewOnly}
            onChange={(event) => setNeedsReviewOnly(event.target.checked)}
          />
          Needs review only
          <span className="text-slate-500">({reviewCount})</span>
        </label>

        <button
          type="button"
          onClick={() => setShowAdd((open) => !open)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-slate-100"
        >
          {showAdd ? "Close" : "Add experience"}
        </button>
      </div>

      {showAdd && (
        <AddExperience
          onCreated={(created) => {
            setExperiences((prev) => [...prev, created]);
            setShowAdd(false);
          }}
        />
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {visible.length === 0 && (
        <p className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-600">
          Nothing needs review right now.
        </p>
      )}

      {EXPERIENCE_KINDS.map((kind) => {
        const group = visible.filter((experience) => experience.kind === kind);
        if (group.length === 0) return null;

        return (
          <section key={kind}>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {GROUP_LABEL[kind]}
            </h2>
            <div className="space-y-4">
              {group.map((experience) => (
                <ExperienceCard
                  key={experience.id}
                  experience={experience}
                  onSaveFields={async (draft: FieldDraft) => {
                    const updated = await send<BankExperience>(
                      `/api/experiences/${experience.id}`,
                      "PATCH",
                      draft,
                    );
                    replaceExperience(updated);
                  }}
                  onDeleteExperience={() =>
                    setPendingDelete({ type: "experience", experience })
                  }
                  onSaveBullet={async (bulletId, text) => {
                    const updated = await send<BankBullet>(
                      `/api/bullets/${bulletId}`,
                      "PATCH",
                      { text },
                    );
                    patchBullets(experience.id, (bullets) =>
                      bullets.map((item) =>
                        item.id === updated.id ? updated : item,
                      ),
                    );
                  }}
                  onDeleteBullet={(bullet) =>
                    setPendingDelete({ type: "bullet", bullet })
                  }
                  onAddBullet={async (text) => {
                    const created = await send<BankBullet>("/api/bullets", "POST", {
                      experienceId: experience.id,
                      text,
                    });
                    patchBullets(experience.id, (bullets) => [...bullets, created]);
                  }}
                  onReorderBullets={async (orderedIds) => {
                    // Show the new order immediately, then persist it.
                    patchBullets(experience.id, (bullets) =>
                      orderedIds
                        .map((id) => bullets.find((item) => item.id === id))
                        .filter((item): item is BankBullet => Boolean(item)),
                    );
                    try {
                      const { bullets } = await send<{ bullets: BankBullet[] }>(
                        "/api/bullets/reorder",
                        "POST",
                        { experienceId: experience.id, orderedIds },
                      );
                      patchBullets(experience.id, () => bullets);
                    } catch (caught) {
                      setError(
                        caught instanceof Error ? caught.message : String(caught),
                      );
                    }
                  }}
                  onOpenDuplicate={(bullet) => setDuplicate(bullet)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {pendingDelete && (
        <ConfirmDialog
          title={
            pendingDelete.type === "experience"
              ? "Delete this experience?"
              : "Delete this bullet?"
          }
          description={
            pendingDelete.type === "experience"
              ? `“${pendingDelete.experience.title}” at ${pendingDelete.experience.organization} and its ${pendingDelete.experience.bullets.length} bullet${
                  pendingDelete.experience.bullets.length === 1 ? "" : "s"
                } will be permanently removed.`
              : `“${pendingDelete.bullet.text}” will be permanently removed.`
          }
          isBusy={isDeleting}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {duplicate && (
        <DuplicateDialog
          bullet={duplicate}
          onClose={() => setDuplicate(null)}
          onKeepBoth={async () => {
            const updated = await send<BankBullet>(
              `/api/bullets/${duplicate.id}/dedupe`,
              "POST",
              { action: "keep-both" },
            );
            patchBullets(duplicate.experienceId, (bullets) =>
              bullets.map((item) => (item.id === updated.id ? updated : item)),
            );
            setDuplicate(null);
          }}
          onDelete={async () => {
            await send(`/api/bullets/${duplicate.id}/dedupe`, "POST", {
              action: "delete",
            });
            patchBullets(duplicate.experienceId, (bullets) =>
              bullets.filter((item) => item.id !== duplicate.id),
            );
            setDuplicate(null);
          }}
        />
      )}
    </div>
  );
}

function AddExperience({
  onCreated,
}: {
  onCreated: (experience: BankExperience) => void;
}) {
  const [kind, setKind] = useState<BankExperience["kind"]>("JOB");
  const [title, setTitle] = useState("");
  const [organization, setOrganization] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setIsSaving(true);
    setError(null);
    try {
      const created = await send<BankExperience>("/api/experiences", "POST", {
        kind,
        title,
        organization,
        startDate,
        endDate,
      });
      onCreated(created);
      setTitle("");
      setOrganization("");
      setStartDate("");
      setEndDate("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold">New experience</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-slate-700">
          Kind
          <select
            value={kind}
            onChange={(event) =>
              setKind(event.target.value as BankExperience["kind"])
            }
            className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
          >
            {EXPERIENCE_KINDS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-700">
          Title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
          />
        </label>
        <label className="text-xs font-medium text-slate-700">
          Organization
          <input
            value={organization}
            onChange={(event) => setOrganization(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
          />
        </label>
        <label className="text-xs font-medium text-slate-700">
          Start
          <input
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            placeholder="Jan 2022"
            className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
          />
        </label>
        <label className="text-xs font-medium text-slate-700">
          End
          <input
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            placeholder="2024"
            className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
          />
        </label>
      </div>

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}

      <button
        type="button"
        onClick={() => void create()}
        disabled={isSaving || title.trim().length === 0 || organization.trim().length === 0}
        className="mt-3 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {isSaving ? "Adding…" : "Add experience"}
      </button>
    </div>
  );
}
