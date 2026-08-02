/**
 * Where every draft item ends up after one move.
 *
 * Kept pure and free of Prisma: the two-level rules — experiences at the top,
 * bullets only ever under an experience — are the part worth testing hard, and
 * they are just arithmetic over a list.
 */

export type DraftKind = "EXPERIENCE" | "BULLET";

/** The minimum of a draft item this module needs to place it. */
export type DraftNode = {
  id: string;
  kind: DraftKind;
  parentDraftItemId: string | null;
  sortOrder: number;
};

export type MoveRequest = {
  itemId: string;
  /** The experience item to land under; null means the top level. */
  targetParentId: string | null;
  /** Position among the destination's children, clamped to the ends. */
  targetIndex: number;
};

export type PositionUpdate = {
  id: string;
  parentDraftItemId: string | null;
  sortOrder: number;
};

export type MovePlan =
  | { ok: true; updates: PositionUpdate[] }
  | { ok: false; error: string };

/** Siblings of one parent, in their stored order. */
function childrenOf(
  items: readonly DraftNode[],
  parentId: string | null,
): DraftNode[] {
  return items
    .filter((item) => item.parentDraftItemId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Work out the new parent and sort order of everything one move disturbs.
 *
 * Returns only the rows that actually change, so a no-op move writes nothing.
 * Both the group the item left and the group it joined come back renumbered
 * contiguously from zero — gaps accumulate otherwise, and two items can end up
 * sharing a sort order after enough moves.
 */
export function planMove(
  items: readonly DraftNode[],
  move: MoveRequest,
): MovePlan {
  const item = items.find((candidate) => candidate.id === move.itemId);
  if (!item) return { ok: false, error: "That draft item no longer exists." };

  if (item.kind === "BULLET" && move.targetParentId === null) {
    return {
      ok: false,
      error: "A bullet has to sit under an experience in the draft.",
    };
  }

  if (item.kind === "EXPERIENCE" && move.targetParentId !== null) {
    return {
      ok: false,
      error: "An experience sits at the top level of the draft, not inside another.",
    };
  }

  if (move.targetParentId !== null) {
    const parent = items.find(
      (candidate) => candidate.id === move.targetParentId,
    );
    if (!parent) {
      return { ok: false, error: "That experience is not in the draft." };
    }
    if (parent.kind !== "EXPERIENCE") {
      return { ok: false, error: "A bullet cannot be nested under a bullet." };
    }
  }

  const sourceParentId = item.parentDraftItemId;
  const sameParent = sourceParentId === move.targetParentId;

  // Take the item out of where it was, then put it where it is going.
  const source = childrenOf(items, sourceParentId).filter(
    (candidate) => candidate.id !== item.id,
  );
  const destination = sameParent ? source : childrenOf(items, move.targetParentId);

  const index = Math.max(0, Math.min(move.targetIndex, destination.length));
  destination.splice(index, 0, item);

  const updates: PositionUpdate[] = [];

  const renumber = (group: DraftNode[], parentId: string | null) => {
    group.forEach((node, sortOrder) => {
      const moved =
        node.parentDraftItemId !== parentId || node.sortOrder !== sortOrder;
      if (moved) updates.push({ id: node.id, parentDraftItemId: parentId, sortOrder });
    });
  };

  renumber(destination, move.targetParentId);
  if (!sameParent) renumber(source, sourceParentId);

  return { ok: true, updates };
}

/**
 * The sort order a newly added item should take: after everything already
 * sharing its parent.
 */
export function nextSortOrder(
  items: readonly DraftNode[],
  parentId: string | null,
): number {
  const siblings = childrenOf(items, parentId);
  return siblings.length === 0
    ? 0
    : siblings[siblings.length - 1].sortOrder + 1;
}
