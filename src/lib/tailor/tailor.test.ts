import { describe, expect, it } from "vitest";

import {
  originalParts,
  rewriteParts,
  wordDiff,
} from "@/lib/tailor/diff";
import {
  addedNumbers,
  isFabricated,
  numericTokens,
} from "@/lib/tailor/numeric-guard";

// ---------------------------------------------------------------------------
// Tokenising
// ---------------------------------------------------------------------------

describe("numericTokens", () => {
  it("finds plain integers and years", () => {
    expect(numericTokens("shipped 3 services in 2021")).toEqual(["3", "2021"]);
  });

  it("keeps a percent attached to its number", () => {
    expect(numericTokens("improved speed 30%")).toEqual(["30%"]);
    expect(numericTokens("improved speed 30 %")).toEqual(["30%"]);
  });

  it("keeps a currency symbol and magnitude attached", () => {
    expect(numericTokens("grew revenue $2M")).toEqual(["$2m"]);
    expect(numericTokens("raised £1.5k")).toEqual(["£1.5k"]);
  });

  it("treats a decimal with a magnitude suffix as one token", () => {
    expect(numericTokens("a 3.5x speedup")).toEqual(["3.5x"]);
  });

  it("splits 24/7 into the two numbers it is made of", () => {
    expect(numericTokens("on call 24/7")).toEqual(["24", "7"]);
  });

  it("ignores thousands separators when comparing", () => {
    expect(numericTokens("served 1,200 requests")).toEqual(["1200"]);
    expect(numericTokens("served 1200 requests")).toEqual(["1200"]);
  });

  it("finds nothing in text with no numbers", () => {
    expect(numericTokens("led a team")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The guard itself — the cases the issue calls out by name
// ---------------------------------------------------------------------------

describe("the numeric guard", () => {
  it("blocks a team size the source never gave", () => {
    expect(isFabricated("led a team", "led a team of 12")).toBe(true);
    expect(addedNumbers("led a team", "led a team of 12")).toEqual(["12"]);
  });

  it("allows a rewrite that reuses the source's own figure", () => {
    expect(
      isFabricated("improved speed 30%", "drove a 30% latency reduction"),
    ).toBe(false);
  });

  it("blocks a changed currency amount", () => {
    expect(isFabricated("grew revenue $2M", "grew revenue $3M")).toBe(true);
    expect(addedNumbers("grew revenue $2M", "grew revenue $3M")).toEqual(["$3m"]);
  });

  it("blocks a changed year", () => {
    expect(isFabricated("shipped in 2021", "shipped in 2022")).toBe(true);
  });

  it("allows the same numbers in a different order", () => {
    expect(
      isFabricated(
        "cut latency 40% across 12 services",
        "across 12 services, cut latency 40%",
      ),
    ).toBe(false);
  });

  it("allows dropping a number entirely", () => {
    expect(isFabricated("led a team of 12", "led the team")).toBe(false);
  });

  it("allows reformatting the same number", () => {
    expect(
      isFabricated("served 1,200 requests", "served 1200 requests a second"),
    ).toBe(false);
  });

  it("blocks a percent invented from a bare number", () => {
    // 30 and 30% are not the same claim.
    expect(isFabricated("handled 30 tickets", "cut tickets 30%")).toBe(true);
  });

  it("reports every added number once", () => {
    expect(
      addedNumbers("led a team", "led 3 teams of 12 across 3 sites"),
    ).toEqual(["3", "12"]);
  });
});

// ---------------------------------------------------------------------------
// Word diff
// ---------------------------------------------------------------------------

describe("wordDiff", () => {
  const text = (parts: { text: string }[]) => parts.map((p) => p.text).join("");

  it("marks nothing when the text is unchanged", () => {
    const parts = wordDiff("led the team", "led the team");
    expect(parts).toEqual([{ type: "same", text: "led the team" }]);
  });

  it("reconstructs both sides exactly", () => {
    const original = "Owned the settlement pipeline end to end";
    const rewrite = "Owned payments reconciliation end to end";
    const parts = wordDiff(original, rewrite);

    expect(text(originalParts(parts))).toBe(original);
    expect(text(rewriteParts(parts))).toBe(rewrite);
  });

  it("marks a replaced word on both sides", () => {
    const parts = wordDiff("led the team", "led the squad");

    expect(parts.some((p) => p.type === "removed" && p.text.includes("team"))).toBe(true);
    expect(parts.some((p) => p.type === "added" && p.text.includes("squad"))).toBe(true);
  });

  it("marks a pure addition as added only", () => {
    const parts = wordDiff("led the team", "successfully led the team");

    expect(parts.some((p) => p.type === "removed")).toBe(false);
    expect(text(rewriteParts(parts))).toBe("successfully led the team");
  });

  it("marks a pure deletion as removed only", () => {
    const parts = wordDiff("successfully led the team", "led the team");

    expect(parts.some((p) => p.type === "added")).toBe(false);
    expect(text(originalParts(parts))).toBe("successfully led the team");
  });
});
