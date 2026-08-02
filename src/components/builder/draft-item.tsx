"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useState } from "react";

import type { DraftBulletView } from "@/lib/draft/view";

/**
 * One bullet inside the draft: sortable, editable in place, and removable.
 *
 * Editing writes `userText`; `originalText` is never overwritten, so "revert
 * to original" is a matter of clearing the edit rather than restoring a copy.
 */
export function DraftBullet({
  bullet,
  position,
  total,
  onSave,
  onRevert,
  onRemove,
  onMove,
}: {
  bullet: DraftBulletView;
  position: number;
  total: number;
  onSave: (text: string) => Promise<void>;
  onRevert: () => Promise<void>;
  onRemove: () => Promise<void>;
  /** Keyboard-operable reordering; pointer users drag the handle instead. */
  onMove: (direction: -1 | 1) => Promise<void>;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: bullet.id, data: { type: "draft-bullet" } });

  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(bullet.text);
  const [isBusy, setIsBusy] = useState(false);

  // A reorder or a revert re-renders this row with different text.
  useEffect(() => {
    if (!isEditing) setText(bullet.text);
  }, [bullet.text, isEditing]);

  async function run(action: () => Promise<void>) {
    setIsBusy(true);
    try {
      await action();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-lg border border-slate-200 bg-white p-2 ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="flex shrink-0 flex-col items-center">
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Reorder bullet: ${bullet.text.slice(0, 40)}`}
            className="cursor-grab rounded px-1 text-slate-400 hover:bg-slate-100"
          >
            ⠿
          </button>
          <button
            type="button"
            disabled={isBusy || position === 0}
            onClick={() => void run(() => onMove(-1))}
            aria-label={`Move bullet up: ${bullet.text.slice(0, 40)}`}
            className="rounded px-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            disabled={isBusy || position === total - 1}
            onClick={() => void run(() => onMove(1))}
            aria-label={`Move bullet down: ${bullet.text.slice(0, 40)}`}
            className="rounded px-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30"
          >
            ↓
          </button>
        </div>

        {isEditing ? (
          <div className="min-w-0 flex-1">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={3}
              aria-label="Bullet text"
              className="w-full rounded-lg border border-slate-300 p-2 text-sm"
            />
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                disabled={isBusy || text.trim().length === 0}
                onClick={() =>
                  void run(async () => {
                    await onSave(text);
                    setIsEditing(false);
                  })
                }
                className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setText(bullet.text);
                  setIsEditing(false);
                }}
                className="rounded border border-slate-300 px-2 py-1 text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="min-w-0 flex-1 text-sm text-slate-800">{bullet.text}</p>
        )}

        <div className="flex shrink-0 items-center gap-1">
          {bullet.isEdited && !isEditing && (
            <span
              title={`Original: ${bullet.originalText}`}
              className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800"
            >
              edited
            </span>
          )}
          {!isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="rounded px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
            >
              Edit
            </button>
          )}
          {bullet.isEdited && !isEditing && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void run(onRevert)}
              className="rounded px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              Revert to original
            </button>
          )}
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void run(onRemove)}
            aria-label="Remove bullet from draft"
            className="rounded px-1.5 py-0.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}
