import type { AnalysisReport } from "@/lib/types";
import type { ReviewState } from "./review";
import {
  markdownText as text,
  markdownCode as code,
  markdownFileReference as fileReference,
  markdownEvidenceLine as evidenceLine,
  markdownPullRequestReference as pullRequestReference,
} from "./markdown";

function reportFinding(report: AnalysisReport, findingId: string) {
  const finding = report.findings.find(
    (candidate) => candidate.id === findingId,
  );
  if (!finding) throw new Error("This finding does not belong to the report.");
  return finding;
}

export function findingHandoff(
  report: AnalysisReport,
  findingId: string,
  review: ReviewState,
) {
  if (review.reportId !== report.id || review.headSha !== report.pr.headSha)
    throw new Error(
      "Review decisions do not belong to this report and head revision.",
    );
  const finding = reportFinding(report, findingId);
  const decision = Object.hasOwn(review.findings, findingId)
    ? review.findings[findingId]
    : undefined;
  const labels = {
    OPEN: "Needs review",
    NEEDS_FIX: "Needs fix",
    REVIEWED: "Reviewed",
    DISMISSED: "Dismissed",
  };
  return [
    `# Finding handoff: ${text(finding.title)}`,
    "",
    report.mode === "DEMO"
      ? "> **DEMO — synthetic PR. Fixture results do not verify a GitHub repository.**"
      : "> **LIVE analysis — this is a review draft, not an automatic defect confirmation.**",
    "",
    `${pullRequestReference(report.pr.url)} · ${code(`${report.pr.owner}/${report.pr.repo}`)} · PR #${report.pr.number}`,
    "",
    `Head revision: ${code(report.pr.headSha)}`,
    `Base revision: ${code(report.pr.baseSha)}`,
    `Report: ${code(report.id)} · Finding: ${code(finding.id)} · Created: ${text(report.createdAt)}`,
    "",
    `Review priority: ${code(finding.severity)} · Score: ${finding.riskScore}/100 · Category: ${text(finding.category)}`,
    `Evidence conclusion: ${code(finding.status)} · Saved decision: **${labels[decision?.status ?? "OPEN"]}**`,
    "",
    "## Observation",
    "",
    text(finding.description),
    "",
    `Behavioral change: ${text(finding.behavioralChange)}`,
    "",
    `Potential impact: ${text(finding.potentialImpact)}`,
    "",
    "## Affected code",
    "",
    ...(finding.affectedFiles.length
      ? finding.affectedFiles.map(
          (reference) => `- ${fileReference(reference)}`,
        )
      : ["No affected file references were recorded."]),
    "",
    "## Recorded evidence",
    "",
    ...(finding.evidence.length
      ? finding.evidence.map(evidenceLine)
      : ["No evidence recorded; this finding remains unverified."]),
    "",
    "PASS and FAIL apply only to the recorded check. STATIC is inspection; EXECUTED is repository execution; DEMO_FIXTURE is fixture-only; NOT_RUN is unexecuted.",
    "",
    "## Recommended follow-up",
    "",
    text(finding.recommendation),
    "",
    ...(finding.generatedTest
      ? [
          `Proposed test: ${code(finding.generatedTest.filename)} · Framework: ${code(finding.generatedTest.framework)}`,
          text(finding.generatedTest.strategy),
          "",
          "- [ ] Inspect the proposed test, imports, fixtures, and assertions before running it.",
        ]
      : [
          "No test proposal was recorded. Add a targeted check for the behavior under review.",
        ]),
    "- [ ] Inspect the affected code and validate the hypothesis.",
    "- [ ] Run relevant checks against the pinned revision and inspect the results.",
    "- [ ] Record a human review outcome and any remaining limitations.",
    "",
    "## Reviewer note",
    "",
    decision?.note ? text(decision.note) : "No saved note.",
    "",
    "Reviewer decisions do not change evidence, verify a fix, or approve a merge.",
    "",
    "## Scope and limitations",
    "",
    ...(report.reviewSurface.partial
      ? ["- Diff coverage is partial; omitted context may affect this finding."]
      : []),
    ...[...new Set([...report.pr.warnings, ...report.warnings])].map(
      (warning) => `- ${text(warning)}`,
    ),
    "",
    "Generated source and raw logs are omitted. This draft was not posted to GitHub. Review it before sharing.",
    "",
  ].join("\n");
}

/** Keep download names bounded, remove paths, and allow only test-source extensions. */
export function proposedTestDownload(
  report: AnalysisReport,
  findingId: string,
) {
  const finding = reportFinding(report, findingId);
  if (!finding.generatedTest?.code.trim()) return null;
  const basename = finding.generatedTest.filename.split(/[\\/]/).at(-1) ?? "";
  const safe = basename.replace(/[^A-Za-z0-9_.-]/g, "_").slice(-100);
  const filename = /^[A-Za-z0-9_.-]+\.test\.(?:ts|js|mts|mjs|cts|cjs)$/.test(
    safe,
  )
    ? safe
    : "proposal.test.ts";
  return {
    filename: `change-verifier-pr-${report.pr.number}-${filename}`,
    code: finding.generatedTest.code,
  };
}
