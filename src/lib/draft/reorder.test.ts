import { describe, expect, it } from "vitest";

import {
  nextSortOrder,
  planMove,
  type DraftNode,
} from "@/lib/draft/reorder";

/** Two experiences, two bullets each, in order. */
function bank(): DraftNode[] {
  return [
    { id: "expA", kind: "EXPERIENCE", parentDraftItemId: null, sortOrder: 0 },
    { id: "expB", kind: "EXPERIENCE", parentDraftItemId: null, sortOrder: 1 },
    { id: "a1", kind: "BULLET", parentDraftItemId: "expA", sortOrder: 0 },
    { id: "a2", kind: "BULLET", parentDraftItemId: "expA", sortOrder: 1 },
    { id: "b1", kind: "BULLET", parentDraftItemId: "expB", sortOrder: 0 },
    { id: "b2", kind: "BULLET", parentDraftItemId: "expB", sortOrder: 1 },
  ];
}

/** Apply a plan to a list so the result can be asserted as a whole. */
function applied(items: DraftNode[], plan: ReturnType<typeof planMove>) {
  if (!plan.ok) throw new Error(`expected a valid move: ${plan.error}`);

  const byId = new Map(items.map((item) => [item.id, { ...item }]));
  for (const update of plan.updates) {
    const node = byId.get(update.id);
    if (node) {
      node.parentDraftItemId = update.parentDraftItemId;
      node.sortOrder = update.sortOrder;
    }
  }

  return [...byId.values()];
}

function childIds(items: DraftNode[], parentId: string | null): string[] {
  return items
    .filter((item) => item.parentDraftItemId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item) => item.id);
}

describe("planMove — bullets across parents", () => {
  it("moves a bullet to another experience and renumbers both sides", () => {
    const items = bank();
    const plan = planMove(items, {
      itemId: "a1",
      targetParentId: "expB",
      targetIndex: 1,
    });

    const result = applied(items, plan);

    expect(childIds(result, "expB")).toEqual(["b1", "a1", "b2"]);
    expect(childIds(result, "expA")).toEqual(["a2"]);

    // Contiguous from zero on both sides — no gaps, no collisions.
    const orders = (parent: string) =>
      result
        .filter((item) => item.parentDraftItemId === parent)
        .map((item) => item.sortOrder)
        .sort((x, y) => x - y);
    expect(orders("expB")).toEqual([0, 1, 2]);
    expect(orders("expA")).toEqual([0]);
  });

  it("sets the new parent on the moved bullet", () => {
    const items = bank();
    const plan = planMove(items, {
      itemId: "a1",
      targetParentId: "expB",
      targetIndex: 0,
    });

    if (!plan.ok) throw new Error("expected ok");
    const moved = plan.updates.find((update) => update.id === "a1");
    expect(moved?.parentDraftItemId).toBe("expB");
    expect(moved?.sortOrder).toBe(0);
  });

  it("reorders within one experience", () => {
    const items = bank();
    const plan = planMove(items, {
      itemId: "a1",
      targetParentId: "expA",
      targetIndex: 1,
    });

    expect(childIds(applied(items, plan), "expA")).toEqual(["a2", "a1"]);
  });

  it("clamps an index past the end", () => {
    const items = bank();
    const plan = planMove(items, {
      itemId: "a1",
      targetParentId: "expB",
      targetIndex: 99,
    });

    expect(childIds(applied(items, plan), "expB")).toEqual(["b1", "b2", "a1"]);
  });

  it("writes nothing for a move that changes no positions", () => {
    const plan = planMove(bank(), {
      itemId: "a1",
      targetParentId: "expA",
      targetIndex: 0,
    });

    expect(plan).toEqual({ ok: true, updates: [] });
  });
});

describe("planMove — experiences", () => {
  it("reorders experiences among themselves", () => {
    const items = bank();
    const plan = planMove(items, {
      itemId: "expB",
      targetParentId: null,
      targetIndex: 0,
    });

    const result = applied(items, plan);
    expect(childIds(result, null)).toEqual(["expB", "expA"]);
    // The bullets went with their parents, untouched.
    expect(childIds(result, "expA")).toEqual(["a1", "a2"]);
    expect(childIds(result, "expB")).toEqual(["b1", "b2"]);
  });
});

describe("planMove — rejections", () => {
  it("rejects a bullet with no parent", () => {
    const plan = planMove(bank(), {
      itemId: "a1",
      targetParentId: null,
      targetIndex: 0,
    });

    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error).toMatch(/under an experience/i);
  });

  it("rejects an experience nested inside another", () => {
    const plan = planMove(bank(), {
      itemId: "expA",
      targetParentId: "expB",
      targetIndex: 0,
    });

    expect(plan.ok).toBe(false);
  });

  it("rejects a bullet nested under another bullet", () => {
    const plan = planMove(bank(), {
      itemId: "a1",
      targetParentId: "b1",
      targetIndex: 0,
    });

    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error).toMatch(/under a bullet/i);
  });

  it("rejects a parent that is not in the draft", () => {
    const plan = planMove(bank(), {
      itemId: "a1",
      targetParentId: "nope",
      targetIndex: 0,
    });

    expect(plan.ok).toBe(false);
  });

  it("rejects an item that is not in the draft", () => {
    const plan = planMove(bank(), {
      itemId: "ghost",
      targetParentId: "expA",
      targetIndex: 0,
    });

    expect(plan.ok).toBe(false);
  });
});

describe("nextSortOrder", () => {
  it("starts at zero for an empty parent", () => {
    expect(nextSortOrder([], null)).toBe(0);
    expect(nextSortOrder(bank(), "expA")).toBe(2);
  });

  it("lands after the highest sibling, gaps and all", () => {
    const items: DraftNode[] = [
      { id: "x", kind: "EXPERIENCE", parentDraftItemId: null, sortOrder: 0 },
      { id: "y", kind: "EXPERIENCE", parentDraftItemId: null, sortOrder: 7 },
    ];
    expect(nextSortOrder(items, null)).toBe(8);
  });
});
