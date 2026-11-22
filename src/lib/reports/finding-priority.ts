import type { Finding } from "@/lib/types";

export function compareFindingPriority(a: Finding, b: Finding) {
  if (a.severity === b.severity) {
    const missing =
      Number(a.anchor?.status === "unanchored") -
      Number(b.anchor?.status === "unanchored");
    if (missing) return missing;
  }
  return b.riskScore - a.riskScore;
}
