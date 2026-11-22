import type { ChangedFile, CitedLocation, LineRef } from "@/lib/types";

type AnchorContext = {
  files: readonly Pick<
    ChangedFile,
    "path" | "previousPath" | "patch" | "status"
  >[];
  /** Number of lines actually retrieved at this PR's head, including a partial last line. */
  headLines?: ReadonlyMap<string, number>;
};

export function excerptLineCount(content: string) {
  return (
    (content.match(/\n/g)?.length ?? 0) +
    Number(content.length > 0 && !content.endsWith("\n"))
  );
}

function inHunk(
  patch: string,
  side: LineRef["side"],
  start: number,
  end: number,
) {
  for (const hunk of patch.matchAll(
    /(?:^|\n)@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/g,
  )) {
    const offset = side === "LEFT" ? 1 : 3;
    const first = Number(hunk[offset]);
    const length = Number(hunk[offset + 1] ?? 1);
    if (first > 0 && start >= first && end < first + length) return true;
  }
  return false;
}

/** Check absolute, one-based file coordinates. A hunk offset is never a file line. */
export function anchorReferences(
  items: readonly LineRef[],
  { files, headLines }: AnchorContext,
): CitedLocation[] {
  const changed = new Map(files.map((file) => [file.path, file]));
  const renamed = new Map(
    files
      .filter((file) => file.status === "renamed" && file.previousPath)
      .map((file) => [file.previousPath!, file]),
  );
  return items.map((ref) => {
    let path = ref.path.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
    let side = ref.side ?? "RIGHT";
    // A real directory named a or b takes precedence over a diff prefix.
    if (
      !changed.has(path) &&
      !headLines?.has(path) &&
      !renamed.has(path) &&
      /^[ab]\//.test(path)
    ) {
      side = ref.side ?? (path.startsWith("a/") ? "LEFT" : "RIGHT");
      path = path.slice(2);
    }
    const file = (side === "LEFT" && renamed.get(path)) || changed.get(path);
    const lines = headLines?.get(path);
    if (!file && lines === undefined)
      return {
        path: path || ref.path,
        anchor: {
          status: "unanchored",
          reason:
            "Path absent from the changed files and retrieved context for this revision.",
        },
      };

    const removed = file?.status === "removed" || file?.status === "deleted";
    const basePath = file?.previousPath ?? path;
    const start = ref.startLine;
    const end = ref.endLine ?? start;
    const validRange =
      start !== undefined &&
      end !== undefined &&
      Number.isSafeInteger(start) &&
      Number.isSafeInteger(end) &&
      start > 0 &&
      end >= start;
    if (
      validRange &&
      (side === "LEFT" ? file?.status !== "added" : !removed) &&
      ((side === "RIGHT" && lines !== undefined && end <= lines) ||
        inHunk(file?.patch ?? "", side, start, end))
    ) {
      return {
        path: side === "LEFT" ? basePath : path,
        side,
        startLine: start,
        endLine: end,
        anchor: { status: "verified" },
      };
    }
    const linkSide = removed
      ? "LEFT"
      : !file || file.status === "added"
        ? "RIGHT"
        : side;
    return {
      path: linkSide === "LEFT" ? basePath : path,
      side: linkSide,
      anchor: {
        status: "path-only",
        reason:
          start === undefined
            ? "No starting line cited."
            : "Line range could not be confirmed at the cited revision.",
      },
    };
  });
}

/** Report the least certain citation so a confirmed path cannot hide a missing one. */
export function findingAnchor(locations: CitedLocation[]) {
  return (
    locations.find((ref) => ref.anchor.status === "unanchored") ??
    locations.find((ref) => ref.anchor.status === "path-only") ??
    locations[0]
  )?.anchor;
}
