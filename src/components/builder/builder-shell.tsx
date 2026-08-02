"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { DraftCanvas, type DraftActions } from "@/components/builder/draft-canvas";
import { LibraryPane } from "@/components/builder/library-pane";
import {
  TailorPanel,
  type TailorActions,
} from "@/components/builder/tailor-panel";
import {
  proposedBullets,
  proposedHeaders,
  type DraftExperienceView,
} from "@/lib/draft/view";
import type { ExperienceSummary } from "@/lib/queries/bank";
import type { LibraryBullet } from "@/lib/relevance/library";

/** Where a dragged bullet is allowed to land, worked out from the drop target. */
function targetExperienceOf(
  draft: readonly DraftExperienceView[],
  overId: string,
  overData: Record<string, unknown> | undefined,
): string | null {
  if (overData?.type === "experience-body") {
    return String(overData.experienceItemId);
  }
  if (overData?.type === "draft-experience") return overId;
  if (overData?.type === "draft-bullet") {
    const parent = draft.find((experience) =>
      experience.bullets.some((bullet) => bullet.id === overId),
    );
    return parent?.id ?? null;
  }
  // The bare canvas is not a valid home for a bullet (AC-10).
  return null;
}

export function BuilderShell({
  applicationId,
  bullets,
  experiences,
  draft,
}: {
  applicationId: string;
  bullets: LibraryBullet[];
  experiences: ExperienceSummary[];
  draft: DraftExperienceView[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isTailoring, setIsTailoring] = useState(false);
  const [tailorError, setTailorError] = useState<string | null>(null);

  // Same synchronous guard as the relevance pass: `isTailoring` is captured per
  // render, so two clicks in one tick would both read it as false.
  const isTailorRunning = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const usedBulletIds = draft.flatMap((experience) =>
    experience.bullets
      .map((bullet) => bullet.sourceBulletId)
      .filter((id): id is string => id !== null),
  );
  const usedExperienceIds = draft
    .map((experience) => experience.sourceExperienceId)
    .filter((id): id is string => id !== null);

  /** Every write goes through here so failures always surface in one place. */
  async function send(
    url: string,
    init: RequestInit,
    onOk?: (data: unknown) => void,
  ) {
    setIsBusy(true);
    try {
      const response = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...init,
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMessage(
          (data as { error?: string })?.error ??
            `That did not save (${response.status}).`,
        );
        return;
      }

      onOk?.(data);
      router.refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsBusy(false);
    }
  }

  function addFromLibrary(
    kind: "EXPERIENCE" | "BULLET",
    sourceId: string,
    parentDraftItemId?: string,
  ) {
    setMessage(null);
    const body =
      kind === "EXPERIENCE"
        ? { kind, experienceId: sourceId }
        : { kind, bulletId: sourceId, parentDraftItemId };

    return send(
      `/api/applications/${applicationId}/draft`,
      { method: "POST", body: JSON.stringify(body) },
      (data) => {
        const skipped = (data as { skipped?: number })?.skipped ?? 0;
        if (skipped > 0) {
          setMessage(
            `Added, minus ${skipped} bullet${skipped === 1 ? "" : "s"} already in the draft.`,
          );
        }
      },
    );
  }

  function move(itemId: string, targetParentId: string | null, targetIndex: number) {
    setMessage(null);
    return send(`/api/draft-items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ move: { targetParentId, targetIndex } }),
    });
  }

  const actions: DraftActions = {
    saveBullet: (id, text) =>
      send(`/api/draft-items/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ userText: text }),
      }),
    revertBullet: (id) =>
      send(`/api/draft-items/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ userText: null }),
      }),
    saveHeader: (id, patch) =>
      send(`/api/draft-items/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    removeItem: (id) =>
      send(`/api/draft-items/${id}`, { method: "DELETE" }),
    moveTo: (id, targetParentId, targetIndex) =>
      move(id, targetParentId, targetIndex),
    rejectTailored: (id) => decide(id, { tailorStatus: "REJECTED" }),
    rejectTailoredHeader: (id) => decide(id, { headerTailorStatus: "REJECTED" }),
  };

  /** One accept/reject decision. Kept out of `send` so bulk runs can batch. */
  async function decide(
    id: string,
    body: { tailorStatus?: string; headerTailorStatus?: string },
    refresh = true,
  ): Promise<void> {
    const response = await fetch(`/api/draft-items/${id}/tailor-status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setTailorError(
        (data as { error?: string })?.error ??
          `That decision did not save (${response.status}).`,
      );
      return;
    }

    if (refresh) router.refresh();
  }

  /** Apply one decision to every proposal currently on screen. */
  async function decideAll(decision: "ACCEPTED" | "REJECTED") {
    setIsBusy(true);
    setTailorError(null);

    try {
      // Blocked bullets are not in `proposedBullets`, so Accept all cannot
      // reach them (AC-7).
      await Promise.all([
        ...proposedBullets(draft).map((bullet) =>
          decide(bullet.id, { tailorStatus: decision }, false),
        ),
        ...proposedHeaders(draft).map((experience) =>
          decide(experience.id, { headerTailorStatus: decision }, false),
        ),
      ]);
      router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  const tailorActions: TailorActions = {
    run: async () => {
      if (isTailorRunning.current) return;
      isTailorRunning.current = true;
      setIsTailoring(true);
      setTailorError(null);

      try {
        const response = await fetch(
          `/api/applications/${applicationId}/tailor`,
          { method: "POST" },
        );
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          setTailorError(
            (data as { error?: string })?.error ??
              `Tailoring failed (${response.status}).`,
          );
          return;
        }

        router.refresh();
      } catch (caught) {
        setTailorError(
          caught instanceof Error ? caught.message : String(caught),
        );
      } finally {
        isTailorRunning.current = false;
        setIsTailoring(false);
      }
    },
    decideBullet: (id, decision) => decide(id, { tailorStatus: decision }),
    decideHeader: (id, decision) => decide(id, { headerTailorStatus: decision }),
    acceptAll: () => decideAll("ACCEPTED"),
    rejectAll: () => decideAll("REJECTED"),
  };

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current as Record<string, unknown> | undefined;
    const overData = over.data.current as Record<string, unknown> | undefined;
    const overId = String(over.id);

    // --- Dragged in from the library -------------------------------------
    if (activeData?.source === "library") {
      const sourceId = String(activeData.sourceId);

      if (activeData.kind === "EXPERIENCE") {
        void addFromLibrary("EXPERIENCE", sourceId);
        return;
      }

      const parentId = targetExperienceOf(draft, overId, overData);
      if (!parentId) {
        setMessage(
          "Drop a bullet onto an experience in the draft — it cannot sit on its own.",
        );
        return;
      }

      void addFromLibrary("BULLET", sourceId, parentId);
      return;
    }

    // --- Reordering something already in the draft ------------------------
    if (activeData?.type === "draft-experience") {
      const order = draft.map((experience) => experience.id);
      const targetIndex = order.indexOf(overId);
      if (targetIndex === -1 || overId === active.id) return;
      void move(String(active.id), null, targetIndex);
      return;
    }

    if (activeData?.type === "draft-bullet") {
      const parentId = targetExperienceOf(draft, overId, overData);
      if (!parentId) {
        setMessage("A bullet has to stay inside an experience.");
        return;
      }

      const parent = draft.find((experience) => experience.id === parentId);
      if (!parent) return;

      const siblings = parent.bullets.map((bullet) => bullet.id);
      const overIndex = siblings.indexOf(overId);
      const targetIndex = overIndex === -1 ? siblings.length : overIndex;

      if (parent.bullets.some((bullet) => bullet.id === active.id)) {
        if (siblings.indexOf(String(active.id)) === targetIndex) return;
      }

      void move(String(active.id), parentId, targetIndex);
    }
  }

  return (
    <DndContext
      id="builder"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      {message && (
        <p
          role="status"
          className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {message}
        </p>
      )}

      <div
        aria-busy={isBusy}
        className="grid gap-6 lg:grid-cols-2 lg:items-start"
      >
        <LibraryPane
          applicationId={applicationId}
          bullets={bullets}
          experiences={experiences}
          usedBulletIds={usedBulletIds}
          usedExperienceIds={usedExperienceIds}
        />
        <DraftCanvas draft={draft} actions={actions} />
      </div>

      <div className="mt-6">
        <TailorPanel
          draft={draft}
          isRunning={isTailoring}
          isBusy={isBusy}
          error={tailorError}
          actions={tailorActions}
        />
      </div>
    </DndContext>
  );
}
