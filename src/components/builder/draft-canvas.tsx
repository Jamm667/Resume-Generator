"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useState } from "react";

import { DraftBullet } from "@/components/builder/draft-item";
import type { DraftExperienceView } from "@/lib/draft/view";

export type DraftActions = {
  saveBullet: (id: string, text: string) => Promise<void>;
  revertBullet: (id: string) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  saveHeader: (
    id: string,
    patch: { userTitle?: string | null; userDateText?: string | null },
  ) => Promise<void>;
  /** Move an item to an explicit position; used by the keyboard controls. */
  moveTo: (
    id: string,
    targetParentId: string | null,
    targetIndex: number,
  ) => Promise<void>;
  /** Undo an accepted rewrite; the proposal stays viewable (AC-8). */
  rejectTailored: (id: string) => Promise<void>;
  rejectTailoredHeader: (id: string) => Promise<void>;
};

function ExperienceCard({
  experience,
  position,
  total,
  actions,
}: {
  experience: DraftExperienceView;
  position: number;
  total: number;
  actions: DraftActions;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: experience.id, data: { type: "draft-experience" } });

  // A separate droppable for the body, so a bullet dropped anywhere inside the
  // card lands under it even when the card has no bullets to aim at yet.
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-${experience.id}`,
    data: { type: "experience-body", experienceItemId: experience.id },
  });

  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(experience.title);
  const [dateText, setDateText] = useState(experience.dateText);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setTitle(experience.title);
      setDateText(experience.dateText);
    }
  }, [experience.title, experience.dateText, isEditing]);

  const isHeaderTailored = experience.headerTailorStatus === "ACCEPTED";
  const isHeaderEdited =
    experience.isTitleEdited || experience.isDateEdited || isHeaderTailored;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-xl border bg-white p-3 ${
        isOver ? "border-slate-900 ring-2 ring-slate-900/10" : "border-slate-300"
      } ${isDragging ? "opacity-40" : ""}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex shrink-0 flex-col items-center">
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Reorder experience: ${experience.title}`}
            className="cursor-grab rounded px-1 text-slate-400 hover:bg-slate-100"
          >
            ⠿
          </button>
          <button
            type="button"
            disabled={position === 0}
            onClick={() => void actions.moveTo(experience.id, null, position - 1)}
            aria-label={`Move experience up: ${experience.title}`}
            className="rounded px-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            disabled={position === total - 1}
            onClick={() => void actions.moveTo(experience.id, null, position + 1)}
            aria-label={`Move experience down: ${experience.title}`}
            className="rounded px-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30"
          >
            ↓
          </button>
        </div>

        {isEditing ? (
          <div className="min-w-0 flex-1 space-y-2">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-label="Experience title"
              className="w-full rounded-lg border border-slate-300 p-2 text-sm font-semibold"
            />
            <input
              value={dateText}
              onChange={(event) => setDateText(event.target.value)}
              aria-label="Experience dates"
              placeholder="Jan 2022 – Present"
              className="w-full rounded-lg border border-slate-300 p-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={isBusy || title.trim().length === 0}
                onClick={() => {
                  setIsBusy(true);
                  void actions
                    .saveHeader(experience.id, {
                      userTitle: title,
                      userDateText: dateText,
                    })
                    .finally(() => {
                      setIsBusy(false);
                      setIsEditing(false);
                    });
                }}
                className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="rounded border border-slate-300 px-2 py-1 text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-900">
              {experience.title}
            </h3>
            <p className="text-xs text-slate-500">
              {[experience.organization, experience.dateText]
                .filter(Boolean)
                .join(" · ") || "No dates"}
            </p>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-1">
          {isHeaderEdited && !isEditing && (
            <span
              title={`Original: ${experience.originalTitle}${
                experience.originalDateText
                  ? ` · ${experience.originalDateText}`
                  : ""
              }`}
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
          {isHeaderEdited && !isEditing && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                setIsBusy(true);
                // An accepted header rewrite reverts by being rejected; a hand
                // edit reverts by being cleared.
                void (isHeaderTailored
                  ? actions.rejectTailoredHeader(experience.id)
                  : actions.saveHeader(experience.id, {
                      userTitle: null,
                      userDateText: null,
                    })
                ).finally(() => setIsBusy(false));
              }}
              className="rounded px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              Revert to original
            </button>
          )}
          <button
            type="button"
            onClick={() => void actions.removeItem(experience.id)}
            aria-label={`Remove ${experience.title} from draft`}
            className="rounded px-1.5 py-0.5 text-xs text-red-700 hover:bg-red-50"
          >
            Remove
          </button>
        </div>
      </div>

      <div ref={setDropRef} className="mt-2 pl-6">
        <SortableContext
          id={`bullets-${experience.id}`}
          items={experience.bullets.map((bullet) => bullet.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-2">
            {experience.bullets.map((bullet, index) => (
              <DraftBullet
                key={bullet.id}
                bullet={bullet}
                position={index}
                total={experience.bullets.length}
                onSave={(text) => actions.saveBullet(bullet.id, text)}
                onRevert={() => actions.revertBullet(bullet.id)}
                onRemove={() => actions.removeItem(bullet.id)}
                onMove={(direction) =>
                  actions.moveTo(bullet.id, experience.id, index + direction)
                }
                onRejectTailored={() => actions.rejectTailored(bullet.id)}
              />
            ))}
          </ul>
        </SortableContext>

        {experience.bullets.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-300 p-2 text-xs text-slate-500">
            Drop bullets here — they can come from any resume.
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * The master draft: experience items at the top level, bullets nested inside
 * them. The whole canvas is a drop target so a dragged experience has
 * somewhere to land even when the draft is empty.
 */
export function DraftCanvas({
  draft,
  actions,
}: {
  draft: DraftExperienceView[];
  actions: DraftActions;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: "draft-canvas",
    data: { type: "canvas" },
  });

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold">Master draft</h2>
      <p className="mt-1 text-xs text-slate-500">
        Nothing here is saved by hand — every change is written as you make it.
      </p>

      <div
        ref={setNodeRef}
        className={`mt-3 rounded-xl p-2 transition-colors ${
          isOver ? "bg-slate-100" : ""
        }`}
      >
        <SortableContext
          id="draft-experiences"
          items={draft.map((experience) => experience.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-3">
            {draft.map((experience, index) => (
              <ExperienceCard
                key={experience.id}
                experience={experience}
                position={index}
                total={draft.length}
                actions={actions}
              />
            ))}
          </ul>
        </SortableContext>

        {draft.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            Drag an experience from your library on the left to start the draft.
            Individual bullets can then be dropped onto it, whichever resume
            they came from.
          </p>
        )}
      </div>
    </section>
  );
}
