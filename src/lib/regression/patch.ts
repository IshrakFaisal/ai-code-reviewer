import type { RepairProposal } from "./types";
/** Full-file hunks avoid silently omitting changed lines. Never applies a patch. */
export function repairDiff(proposal: RepairProposal) {
  return proposal.files
    .map((file) => {
      const lines = (s: string) =>
        s.endsWith("\n") ? s.slice(0, -1).split("\n") : s.split("\n");
      const before = lines(file.before),
        after = lines(file.after);
      const chunk = (source: string, rows: string[], prefix: string) =>
        rows.map((row) => prefix + row).join("\n") +
        (source.endsWith("\n") ? "\n" : "\n\\ No newline at end of file\n");
      return `diff --git a/${file.path} b/${file.path}\n--- a/${file.path}\n+++ b/${file.path}\n@@ -1,${before.length} +1,${after.length} @@\n${chunk(file.before, before, "-")}${chunk(file.after, after, "+")}`;
    })
    .join("");
}
