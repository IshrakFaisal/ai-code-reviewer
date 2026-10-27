import type { AnalysisReport, Evidence, RiskLevel } from "@/lib/types";

export type FileEvidenceState =
  | "EXECUTION_FAILED"
  | "EXECUTION_WARNING"
  | "EXECUTION_LINKED"
  | "FIXTURE_ONLY"
  | "STATIC_ONLY"
  | "NOT_RUN"
  | "NO_EVIDENCE";
export const fileEvidenceLabels: Record<FileEvidenceState, string> = {
  EXECUTION_FAILED: "Linked execution failed",
  EXECUTION_WARNING: "Linked execution needs review",
  EXECUTION_LINKED: "Execution linked",
  FIXTURE_ONLY: "Demo evidence only",
  STATIC_ONLY: "Static inspection only",
  NOT_RUN: "Linked checks not executed",
  NO_EVIDENCE: "No file-linked evidence",
};

export function evidenceIdentity(record: Evidence) {
  return JSON.stringify([
    record.id,
    record.type,
    record.status,
    record.provenance,
    record.description,
    record.output ?? "",
    record.durationMs ?? null,
    [...new Set(record.filePaths ?? [])].sort(),
  ]);
}

export function reportEvidence(report: AnalysisReport) {
  const seen = new Set<string>();
  return [
    ...report.checks,
    ...report.findings.flatMap((finding) => finding.evidence),
  ].filter((record) => {
    const identity = evidenceIdentity(record);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

/** A path association is not proof of test coverage or code execution. */
export function verificationGaps(report: AnalysisReport) {
  const evidence = reportEvidence(report);
  const rows = report.pr.files
    .map((file, index) => {
      const linked = evidence.filter((record) =>
        record.filePaths?.includes(file.path),
      );
      const executed = linked.filter(
        (record) =>
          report.mode === "LIVE" &&
          record.provenance === "EXECUTED" &&
          record.status !== "NOT_RUN",
      );
      const fixture = linked.some(
        (record) =>
          record.status !== "NOT_RUN" &&
          (record.provenance === "DEMO_FIXTURE" ||
            (report.mode === "DEMO" && record.provenance === "EXECUTED")),
      );
      const state: FileEvidenceState = executed.some(
        (record) => record.status === "FAIL",
      )
        ? "EXECUTION_FAILED"
        : executed.some((record) => record.status === "WARNING")
          ? "EXECUTION_WARNING"
          : executed.length
            ? "EXECUTION_LINKED"
            : fixture
              ? "FIXTURE_ONLY"
              : linked.some(
                    (record) =>
                      record.provenance === "STATIC" &&
                      record.status !== "NOT_RUN",
                  )
                ? "STATIC_ONLY"
                : linked.some((record) => record.status === "NOT_RUN")
                  ? "NOT_RUN"
                  : "NO_EVIDENCE";
      return {
        path: file.path,
        index,
        risk: file.risk,
        hasExecuted: executed.length > 0,
        state,
        patchAvailable: !!file.patch,
        partialPatch: file.lines.length < file.additions + file.deletions,
        findings: report.findings
          .filter((finding) =>
            finding.affectedFiles.some(
              (reference) => reference.path === file.path,
            ),
          )
          .map(({ id, title }) => ({ id, title })),
        evidence: linked.map(
          ({ id, type, status, provenance, description }) => ({
            id,
            type,
            status,
            provenance,
            description,
          }),
        ),
      };
    })
    .sort(
      (a, b) => b.risk.score - a.risk.score || a.path.localeCompare(b.path),
    );
  const paths = new Set(report.pr.files.map((file) => file.path));
  return {
    rows,
    highRiskGaps: rows.filter(
      (row) => row.risk.level === "HIGH" && !row.hasExecuted,
    ).length,
    executionLinked: rows.filter((row) => row.hasExecuted).length,
    missingPatches: rows.filter((row) => !row.patchAvailable).length,
    unscoped: evidence.filter((record) => !record.filePaths?.length),
    outsideChangedFiles: evidence.filter(
      (record) =>
        record.filePaths?.length &&
        !record.filePaths.some((path) => paths.has(path)),
    ),
  };
}

export type EvidenceFile = ReturnType<typeof verificationGaps>["rows"][number];
export type GapFilters = {
  query: string;
  risk: RiskLevel | "ALL";
  scope: "ALL" | "GAPS" | "EXECUTED" | "FAILED" | "STATIC" | "FIXTURE" | "NONE";
};

export function filterEvidenceFiles(rows: EvidenceFile[], filters: GapFilters) {
  const terms = filters.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (filters.risk !== "ALL" && row.risk.level !== filters.risk) return false;
    if (filters.scope === "GAPS" && row.hasExecuted) return false;
    if (filters.scope === "EXECUTED" && !row.hasExecuted) return false;
    if (filters.scope === "FAILED" && row.state !== "EXECUTION_FAILED")
      return false;
    if (filters.scope === "STATIC" && row.state !== "STATIC_ONLY") return false;
    if (filters.scope === "FIXTURE" && row.state !== "FIXTURE_ONLY")
      return false;
    if (filters.scope === "NONE" && row.state !== "NO_EVIDENCE") return false;
    return terms.every((term) => row.path.toLowerCase().includes(term));
  });
}
