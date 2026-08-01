"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useState } from "react";

import { BulletRow } from "@/components/bank/bullet-row";
import type { BankBullet, BankExperience } from "@/lib/queries/bank";
import { EXPERIENCE_KINDS } from "@/lib/structure/schema";

type FieldDraft = {
  kind: BankExperience["kind"];
  title: string;
  organization: string;
  location: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  summary: string;
};

function toDraft(experience: BankExperience): FieldDraft {
  return {
    kind: experience.kind,
    title: experience.title,
    organization: experience.organization,
    location: experience.location ?? "",
    startDate: experience.startDate ?? "",
    endDate: experience.endDate ?? "",
    isCurrent: experience.isCurrent,
    summary: experience.summary ?? "",
  };
}

function dateRange(experience: BankExperience): string {
  const start = experience.startDate ?? "";
  const end = experience.isCurrent ? "Present" : (experience.endDate ?? "");
  if (!start && !end) return "No dates";
  return [start, end].filter(Boolean).join(" – ");
}

export function ExperienceCard({
  experience,
  onSaveFields,
  onDeleteExperience,
  onSaveBullet,
  onDeleteBullet,
  onAddBullet,
  onReorderBullets,
  onOpenDuplicate,
}: {
  experience: BankExperience;
  onSaveFields: (draft: FieldDraft) => Promise<void>;
  onDeleteExperience: () => void;
  onSaveBullet: (bulletId: string, text: string) => Promise<void>;
  onDeleteBullet: (bullet: BankBullet) => void;
  onAddBullet: (text: string) => Promise<void>;
  onReorderBullets: (orderedIds: string[]) => Promise<void>;
  onOpenDuplicate: (bullet: BankBullet) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<FieldDraft>(() => toDraft(experience));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newBullet, setNewBullet] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  async function saveFields() {
    if (draft.title.trim().length === 0 || draft.organization.trim().length === 0) {
      setError("Title and organization are required.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await onSaveFields(draft);
      setIsEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsSaving(false);
    }
  }

  async function addBullet() {
    if (newBullet.trim().length === 0) return;
    setIsAdding(true);
    setError(null);
    try {
      await onAddBullet(newBullet.trim());
      setNewBullet("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsAdding(false);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const ids = experience.bullets.map((bullet) => bullet.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;

    void onReorderBullets(arrayMove(ids, from, to));
  }

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5">
      {isEditing ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-slate-700">
            Kind
            <select
              value={draft.kind}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  kind: event.target.value as BankExperience["kind"],
                })
              }
              className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
            >
              {EXPERIENCE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-slate-700">
            Title
            <input
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
            />
          </label>

          <label className="text-xs font-medium text-slate-700">
            Organization
            <input
              value={draft.organization}
              onChange={(event) =>
                setDraft({ ...draft, organization: event.target.value })
              }
              className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
            />
          </label>

          <label className="text-xs font-medium text-slate-700">
            Location
            <input
              value={draft.location}
              onChange={(event) =>
                setDraft({ ...draft, location: event.target.value })
              }
              className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
            />
          </label>

          <label className="text-xs font-medium text-slate-700">
            Start
            <input
              value={draft.startDate}
              onChange={(event) =>
                setDraft({ ...draft, startDate: event.target.value })
              }
              placeholder="Jan 2022"
              className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
            />
          </label>

          <label className="text-xs font-medium text-slate-700">
            End
            <input
              value={draft.endDate}
              disabled={draft.isCurrent}
              onChange={(event) =>
                setDraft({ ...draft, endDate: event.target.value })
              }
              placeholder="2024"
              className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm disabled:bg-slate-100"
            />
          </label>

          <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked={draft.isCurrent}
              onChange={(event) =>
                setDraft({ ...draft, isCurrent: event.target.checked })
              }
            />
            Current role
          </label>

          <label className="text-xs font-medium text-slate-700 sm:col-span-2">
            Summary
            <textarea
              rows={2}
              value={draft.summary}
              onChange={(event) =>
                setDraft({ ...draft, summary: event.target.value })
              }
              className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
            />
          </label>

          <div className="flex gap-2 sm:col-span-2">
            <button
              type="button"
              onClick={() => void saveFields()}
              disabled={isSaving}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(toDraft(experience));
                setError(null);
                setIsEditing(false);
              }}
              disabled={isSaving}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">
              {experience.title}
              <span className="font-normal text-slate-600">
                {" "}
                · {experience.organization}
              </span>
            </h3>
            <p className="mt-0.5 text-xs text-slate-600">
              {dateRange(experience)}
              {experience.location ? ` · ${experience.location}` : ""}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {experience.sourceDocument
                ? `From ${experience.sourceDocument.filename}`
                : "Added manually"}
            </p>
            {experience.summary && (
              <p className="mt-2 text-sm text-slate-700">{experience.summary}</p>
            )}
            {experience.needsReview && (
              <span className="mt-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                Needs review
              </span>
            )}
          </div>

          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onDeleteExperience}
              className="rounded px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        </header>
      )}

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}

      <DndContext
        // Without an explicit id, dnd-kit derives its internal accessibility
        // ids from a render-order counter that differs between the server and
        // client passes, which React reports as a hydration mismatch.
        id={`bullets-${experience.id}`}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={experience.bullets.map((bullet) => bullet.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="mt-4 space-y-2">
            {experience.bullets.map((bullet) => (
              <BulletRow
                key={bullet.id}
                bullet={bullet}
                onSave={(text) => onSaveBullet(bullet.id, text)}
                onDelete={() => onDeleteBullet(bullet)}
                onOpenDuplicate={() => onOpenDuplicate(bullet)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {experience.bullets.length === 0 && (
        <p className="mt-4 text-xs text-slate-500">No bullets yet.</p>
      )}

      <div className="mt-3 flex gap-2">
        <input
          aria-label={`Add a bullet to ${experience.title}`}
          value={newBullet}
          onChange={(event) => setNewBullet(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void addBullet();
          }}
          placeholder="Add a bullet…"
          className="flex-1 rounded-lg border border-slate-300 p-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void addBullet()}
          disabled={isAdding || newBullet.trim().length === 0}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 disabled:opacity-50"
        >
          {isAdding ? "Adding…" : "Add"}
        </button>
      </div>
    </article>
  );
}

export type { FieldDraft };
