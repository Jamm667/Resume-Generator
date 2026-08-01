"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";

import type { BankBullet } from "@/lib/queries/bank";

export function BulletRow({
  bullet,
  onSave,
  onDelete,
  onOpenDuplicate,
}: {
  bullet: BankBullet;
  onSave: (text: string) => Promise<void>;
  onDelete: () => void;
  onOpenDuplicate: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(bullet.text);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: bullet.id });

  async function save() {
    if (draft.trim().length === 0) {
      setError("Bullet text cannot be empty.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await onSave(draft.trim());
      setIsEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-lg border bg-white px-3 py-2 ${
        isDragging ? "border-slate-400 shadow-md" : "border-slate-200"
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label="Reorder bullet"
          className="mt-0.5 cursor-grab px-1 text-slate-400 hover:text-slate-600 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>

        <div className="min-w-0 flex-1">
          {isEditing ? (
            <>
              <textarea
                aria-label="Bullet text"
                rows={3}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className="w-full rounded-lg border border-slate-300 p-2 text-sm"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={isSaving}
                  className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {isSaving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(bullet.text);
                    setError(null);
                    setIsEditing(false);
                  }}
                  disabled={isSaving}
                  className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-100 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-900">{bullet.text}</p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-2">
            {bullet.needsReview && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                Needs review
              </span>
            )}
            {bullet.duplicateOf && (
              <button
                type="button"
                onClick={onOpenDuplicate}
                className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-800 underline-offset-2 hover:underline"
              >
                Possible duplicate — compare
              </button>
            )}
          </div>

          {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
        </div>

        {!isEditing && (
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
              onClick={onDelete}
              className="rounded px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
