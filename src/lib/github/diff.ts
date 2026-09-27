import type { DiffLine } from "@/lib/types";
export function parseDiff(patch = ""): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0,
    newLine = 0,
    inHunk = false;
  for (const raw of patch.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || raw.startsWith("\\")) continue;
    if (raw.startsWith("+"))
      lines.push({
        line: newLine++,
        side: "RIGHT",
        content: raw.slice(1),
        kind: "add",
      });
    else if (raw.startsWith("-"))
      lines.push({
        line: oldLine++,
        side: "LEFT",
        content: raw.slice(1),
        kind: "remove",
      });
    else if (raw.startsWith(" ")) {
      oldLine++;
      newLine++;
    }
  }
  return lines;
}
