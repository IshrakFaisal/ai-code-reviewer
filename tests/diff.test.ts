import { describe, expect, it } from "vitest";
import {
  diffRows,
  matchingDiffRows,
  nextDiffPosition,
  diffPageSize,
} from "@/lib/reports/diff";

describe("workbench unified diff", () => {
  it("finds literal case-insensitive matches beyond the first page without changing line numbers", () => {
    const rows = diffRows(
      [
        "@@ -1,501 +1,501 @@",
        ...Array.from({ length: 501 }, (_, i) => ` line ${i}`),
        "@@ -900 +900 @@",
        "-old [token]",
        "+new [TOKEN]",
      ].join("\n"),
    );
    const matches = matchingDiffRows(rows, " [token] ");
    expect(matches).toEqual([503, 504]);
    expect(Math.floor(matches[0] / diffPageSize)).toBe(1);
    expect(rows[matches[0]].before).toBe(900);
    expect(rows[matches[1]].after).toBe(900);
    expect(matchingDiffRows(rows, " ")).toEqual([]);
    expect(matchingDiffRows(rows, ".*")).toEqual([]);
  });
  it("navigates multiple hunks in both directions and wraps at boundaries", () => {
    const rows = diffRows(
      "@@ -1 +1 @@\n-a\n+b\n@@ -20 +20 @@\n-c\n+d\n@@ -30 +30 @@\n-e\n+f",
    );
    const hunks = rows.flatMap((row, index) =>
      row.kind === "hunk" ? [index] : [],
    );
    expect(hunks).toEqual([0, 3, 6]);
    expect(nextDiffPosition(-1, hunks.length, 1)).toBe(0);
    expect(nextDiffPosition(-1, hunks.length, -1)).toBe(2);
    expect(nextDiffPosition(0, hunks.length, 1)).toBe(1);
    expect(nextDiffPosition(2, hunks.length, 1)).toBe(0);
    expect(nextDiffPosition(0, hunks.length, -1)).toBe(2);
    expect(nextDiffPosition(0, 0, 1)).toBe(-1);
    expect(nextDiffPosition(2, 1, 1)).toBe(0);
  });
  it("tracks base and head independently after additions and removals", () => {
    const rows = diffRows("@@ -8,3 +8,3 @@\n same\n-old\n+new\n last");
    expect(rows.slice(1)).toEqual([
      { content: " same", kind: "context", before: 8, after: 8 },
      { content: "-old", kind: "remove", before: 9 },
      { content: "+new", kind: "add", after: 9 },
      { content: " last", kind: "context", before: 10, after: 10 },
    ]);
  });
  it("resets numbers between hunks, including omitted counts", () => {
    const rows = diffRows(
      "@@ -1 +1 @@\n-one\n+two\n@@ -20,2 +30,3 @@\n line\n+extra",
    );
    expect(rows[4]).toMatchObject({ before: 20, after: 30 });
    expect(rows[5]).toMatchObject({ after: 31, kind: "add" });
  });
  it("handles new files, CRLF, and no-newline markers without advancing numbers", () => {
    const rows = diffRows(
      "@@ -0,0 +1,2 @@\r\n+first\r\n\\ No newline at end of file\r\n+second\r\n",
    );
    expect(rows[1].after).toBe(1);
    expect(rows[2].after).toBeUndefined();
    expect(rows[3].after).toBe(2);
    expect(rows[4].after).toBeUndefined();
  });
  it("does not assign source numbers to patch metadata or fabricate missing hunks", () => {
    const rows = diffRows("--- a/file.ts\n+++ b/file.ts\n+no hunk available");
    expect(
      rows.every((row) => row.before === undefined && row.after === undefined),
    ).toBe(true);
  });
});
