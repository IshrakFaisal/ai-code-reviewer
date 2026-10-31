export type DiffRow = {
  content: string;
  kind: "add" | "remove" | "context" | "hunk";
  before?: number;
  after?: number;
};

export const diffPageSize = 500;

/** Literal, case-insensitive search over every retrieved row, including later pages. */
export function matchingDiffRows(rows: DiffRow[], query: string): number[] {
  const term = query.trim().toLowerCase();
  return term
    ? rows.flatMap((row, index) =>
        row.content.toLowerCase().includes(term) ? [index] : [],
      )
    : [];
}

export function nextDiffPosition(
  current: number,
  count: number,
  direction: number,
) {
  if (!count) return -1;
  if (current < 0 || current >= count) return direction > 0 ? 0 : count - 1;
  return (current + direction + count) % count;
}

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
