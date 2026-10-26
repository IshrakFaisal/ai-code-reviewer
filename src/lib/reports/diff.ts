export type DiffRow = {
  content: string;
  kind: "add" | "remove" | "context" | "hunk";
  before?: number;
  after?: number;
};

/** Keep both revision line numbers aligned with the original unified patch. */
export function diffRows(patch: string): DiffRow[] {
  let before: number | undefined;
  let after: number | undefined;
  return patch.split(/\r?\n/).map((content) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(content);
    if (hunk) {
      before = Number(hunk[1]);
      after = Number(hunk[2]);
      return { content, kind: "hunk" };
    }
    // File headers and the no-newline marker do not consume source lines.
    if (before === undefined || content.startsWith("\\") || content === "") {
      return { content, kind: "context" };
    }
    if (content.startsWith("+")) {
      return { content, kind: "add", after: after!++ };
    }
    if (content.startsWith("-")) {
      return { content, kind: "remove", before: before++ };
    }
    return { content, kind: "context", before: before++, after: after!++ };
  });
}
