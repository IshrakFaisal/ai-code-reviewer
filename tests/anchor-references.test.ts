import { describe, expect, it } from "vitest";
import {
  anchorReferences,
  excerptLineCount,
  findingAnchor,
} from "@/lib/ai/anchor-references";
import type { LineRef } from "@/lib/types";

const path = "src/example.ts";
const context = {
  files: [
    {
      path,
      status: "modified",
      patch:
        "@@ -5,2 +20,3 @@\n context\n-old\n+edit\n+extra\n@@ -80 +100 @@\n-more\n+last",
    },
    {
      path: "new.ts",
      previousPath: "old.ts",
      status: "renamed",
      patch: "@@ -50 +3 @@\n-old\n+new",
    },
    { path: "gone.ts", status: "removed", patch: "@@ -7 +0,0 @@\n-removed" },
    { path: "a/real.ts", status: "modified", patch: "@@ -1 +7 @@\n-old\n+new" },
  ],
  headLines: new Map([["dependency.ts", 4]]),
};
const check = (ref: LineRef) => anchorReferences([ref], context)[0];

describe("AI citation anchors", () => {
  it.each([
    [path, 20, "RIGHT"],
    ["src\\example.ts", 21, "RIGHT"],
    ["./src/example.ts", 22, "RIGHT"],
    ["b/src/example.ts", 100, "RIGHT"],
    ["a/src/example.ts", 5, "LEFT"],
    ["a/real.ts", 7, "RIGHT"],
    ["new.ts", 3, "RIGHT"],
    ["a/old.ts", 50, "LEFT"],
    ["dependency.ts", 4, "RIGHT"],
  ] as const)("grounds %s at absolute line %i on %s", (cited, line, side) => {
    const result = check({ path: cited, startLine: line });
    expect(result).toMatchObject({
      path: cited.endsWith("example.ts")
        ? path
        : cited === "a/old.ts"
          ? "old.ts"
          : cited,
      side,
      startLine: line,
      endLine: line,
      anchor: { status: "verified" },
    });
  });
  it.each([
    ["between hunks", { startLine: 23 }],
    ["range crosses a hunk boundary", { startLine: 22, endLine: 100 }],
    ["range partly overlaps", { startLine: 19, endLine: 20 }],
    ["missing", {}],
    ["missing start", { endLine: 21 }],
    ["zero", { startLine: 0 }],
    ["negative", { startLine: -10 }],
    ["fraction", { startLine: 20.5 }],
    ["inverted", { startLine: 21, endLine: 20 }],
    ["zero end", { startLine: 21, endLine: 0 }],
  ] as const)("keeps only the path for %s", (_label, ref) => {
    const result = check({ path, ...ref });
    expect(result).toMatchObject({ path, anchor: { status: "path-only" } });
    expect(result).not.toHaveProperty("startLine");
    expect(result).not.toHaveProperty("endLine");
  });
  it("verifies the entire cited hunk range, including unchanged context", () => {
    expect(check({ path, startLine: 20, endLine: 22 })).toMatchObject({
      startLine: 20,
      endLine: 22,
      anchor: { status: "verified" },
    });
  });
  it("checks a renamed file against the requested revision", () => {
    expect(
      check({ path: "old.ts", side: "LEFT", startLine: 50 }),
    ).toMatchObject({ path: "old.ts", anchor: { status: "verified" } });
    expect(
      check({ path: "old.ts", side: "RIGHT", startLine: 3 }).anchor.status,
    ).toBe("unanchored");
    expect(
      check({ path: "new.ts", side: "LEFT", startLine: 50 }),
    ).toMatchObject({ path: "old.ts", anchor: { status: "verified" } });
  });
  it("uses only the observed excerpt and never applies head lines to the base", () => {
    expect(check({ path: "dependency.ts", startLine: 5 }).anchor.status).toBe(
      "path-only",
    );
    expect(
      check({ path: "dependency.ts", startLine: 4, side: "LEFT" }).anchor
        .status,
    ).toBe("path-only");
    expect(
      ["", "\n", "one\r\ntwo\r\n", "one\npartial"].map(excerptLineCount),
    ).toEqual([0, 1, 2, 2]);
  });
  it("keeps a deleted path, verifying lines only on the base", () => {
    expect(check({ path: "gone.ts", startLine: 7 })).toMatchObject({
      side: "LEFT",
      anchor: { status: "path-only" },
    });
    expect(
      check({ path: "gone.ts", side: "LEFT", startLine: 7 }).anchor.status,
    ).toBe("verified");
  });
  it.each(["src/Example.ts", "nonexistent.ts"])(
    "preserves the unmatched citation %s",
    (path) => {
      expect(check({ path, startLine: 1 })).toMatchObject({
        path,
        anchor: { status: "unanchored" },
      });
    },
  );
  it("reports a missing citation even when another citation checks out", () => {
    expect(
      findingAnchor(
        anchorReferences(
          [{ path, startLine: 22 }, { path: "also.ts" }],
          context,
        ),
      )?.status,
    ).toBe("unanchored");
  });
});
