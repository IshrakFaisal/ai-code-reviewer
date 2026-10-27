import type { AnalysisReport, Evidence } from "@/lib/types";
import { evidenceIdentity } from "./verification-gaps";

export type EvidenceTarget = {
  title: string;
  href: string;
  findingId?: string;
};

/** Prefer the finding's context; fall back to the original report check. */
export function evidenceTarget(
  report: AnalysisReport,
  evidence: Evidence,
): EvidenceTarget {
  const identity = evidenceIdentity(evidence);
  for (const [findingIndex, finding] of report.findings.entries()) {
    const index = finding.evidence.findIndex(
      (item) => evidenceIdentity(item) === identity,
    );
    if (index !== -1)
      return {
        title: `${evidence.type}: ${evidence.description}`,
        href: `#finding-evidence-${findingIndex}-${index}`,
        findingId: finding.id,
      };
  }
  const index = report.checks.findIndex(
    (item) => evidenceIdentity(item) === identity,
  );
  return {
    title: `${evidence.type}: ${evidence.description}`,
    href: index === -1 ? "#verification" : `#report-check-${index}`,
  };
}
