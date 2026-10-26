import { describe, expect, it } from "vitest";
import { diffRows } from "@/lib/reports/diff";

describe("workbench unified diff", () => {
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
