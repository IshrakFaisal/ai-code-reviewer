import type { AnalysisReport, ChangedFile } from "@/lib/types";
import { verificationGaps } from "./verification-gaps";
import type { ReviewState } from "./review";

export type WorkbenchScope =
  "ALL" | "HIGH" | "FINDINGS" | "GAPS" | "OPEN" | "NEEDS_FIX";

export function filterWorkbenchFiles(
  report: AnalysisReport,
  files: ChangedFile[],
  query: string,
  scope: WorkbenchScope,
  review: ReviewState | null = null,
) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const findingPaths = new Set(
    report.findings
      .filter((finding) => {
        if (scope !== "OPEN" && scope !== "NEEDS_FIX") return true;
        if (
          !review ||
          review.reportId !== report.id ||
          review.headSha !== report.pr.headSha
        )
          return false;
        const status = Object.hasOwn(review.findings, finding.id)
          ? review.findings[finding.id].status
          : "OPEN";
        return status === scope;
      })
      .flatMap((finding) => finding.affectedFiles.map((ref) => ref.path)),
  );
  const gapPaths =
    scope === "GAPS"
      ? new Set(
          verificationGaps(report)
            .rows.filter((row) => row.risk.level === "HIGH" && !row.hasExecuted)
            .map((row) => row.path),
        )
      : new Set<string>();
  return files.filter(
    (file) =>
      (scope !== "HIGH" || file.risk.level === "HIGH") &&
      (!["FINDINGS", "OPEN", "NEEDS_FIX"].includes(scope) ||
        findingPaths.has(file.path)) &&
      (scope !== "GAPS" || gapPaths.has(file.path)) &&
      terms.every((term) =>
        `${file.path} ${file.status} ${file.categories.join(" ")}`
          .toLowerCase()
          .includes(term),
      ),
  );
}
