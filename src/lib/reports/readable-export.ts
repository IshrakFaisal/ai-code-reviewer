import type { AnalysisReport, Evidence } from "@/lib/types";
import { markdownText } from "./markdown";
import { reportEvidence, verificationGaps } from "./verification-gaps";

export type ExportSection = { title: string; paragraphs: string[] };

function evidenceScope(item: Evidence) {
  if (item.status === "NOT_RUN") return "Not executed";
  return item.provenance === "STATIC"
    ? "Static inspection"
    : item.provenance === "DEMO_FIXTURE"
      ? "Demo fixture"
      : "Repository execution";
}

/** One content model for the readable formats; never interpret report text as markup. */
export function readableReport(report: AnalysisReport) {
  const evidence = reportEvidence(report);
  const executed = evidence.filter(
    (e) => e.provenance !== "STATIC" && e.status !== "NOT_RUN",
  );
  const gaps = verificationGaps(report);
  const sections: ExportSection[] = [
    {
      title: "Summary",
      paragraphs: [
        report.summary,
        `${report.findings.length} findings | ${report.pr.files.length} of ${report.pr.changedFiles} changed files analyzed`,
        `${executed.length} ${report.mode === "DEMO" ? "fixture" : "execution"} checks recorded: ${executed.filter((e) => e.status === "PASS").length} passed, ${executed.filter((e) => e.status === "FAIL").length} failed, ${executed.filter((e) => e.status === "WARNING").length} warnings.`,
        `${gaps.highRiskGaps} high-risk files without linked repository execution. Passing checks support only their recorded assertions; this report is not a merge approval.`,
      ],
    },
  ];
  if (!report.findings.length)
    sections.push({
      title: "Findings",
      paragraphs: [
        "No findings were recorded. This does not establish that the change is risk-free.",
      ],
    });
  const statusLabels = {
    VERIFIED_ISSUE: "Verified issue in demo fixture",
    VERIFIED_FOR_TEST: "Verified for this test",
    UNVERIFIED_RISK: "Unverified risk",
    INCONCLUSIVE: "Inconclusive",
  };
  for (const [index, finding] of [...report.findings]
    .sort((a, b) => b.riskScore - a.riskScore)
    .entries()) {
    sections.push({
      title: `Finding ${index + 1}: ${finding.title}`,
      paragraphs: [
        `${finding.severity} risk | Score ${finding.riskScore}/100 | ${statusLabels[finding.status]}`,
        finding.description,
        `Behavioral change: ${finding.behavioralChange}`,
        `Potential impact: ${finding.potentialImpact}`,
        `Recommended action: ${finding.recommendation}`,
        `Affected files: ${finding.affectedFiles.map((file) => `${file.path}${file.startLine ? `:${file.startLine}${file.endLine && file.endLine !== file.startLine ? `-${file.endLine}` : ""}` : ""}${file.side === "LEFT" ? " (base)" : file.side === "RIGHT" ? " (head)" : ""}`).join(", ") || "None recorded."}`,
        finding.evidence.length
          ? `Evidence: ${finding.evidence.map((item) => `${item.type}: ${item.status.replaceAll("_", " ")} (${evidenceScope(item)})`).join("; ")}.`
          : "No verification evidence was recorded for this finding.",
      ],
    });
  }
  sections.push({
    title: "Verification results",
    paragraphs: [
      "Static inspection, repository execution, and demo fixture evidence are distinct. NOT RUN means the check was not executed.",
      ...evidence.map(
        (item) =>
          `${item.type} - ${item.status.replaceAll("_", " ")} | ${evidenceScope(item)}\n${item.description}`,
      ),
      ...(!evidence.length ? ["No verification checks were recorded."] : []),
    ],
  });
  sections.push({
    title: "Next steps",
    paragraphs: [
      ...(report.mode === "LIVE"
        ? [
            "Check whether the PR's base or head commit has changed since this analysis; rerun if it has.",
          ]
        : []),
      ...[...new Set(report.findings.map((finding) => finding.recommendation))],
      ...(gaps.highRiskGaps
        ? [
            `Inspect the ${gaps.highRiskGaps} high-risk files without linked execution and add targeted verification.`,
          ]
        : []),
      "Review the evidence and record your decision in the app. Reviewer decisions do not change test results.",
    ],
  });
  sections.push({
    title: "Scope and limitations",
    paragraphs: [
      `${report.reviewSurface.priorityLines} priority lines out of ${report.reviewSurface.totalLines} changed lines. ${report.reviewSurface.partial ? "Diff coverage is partial; this priority count is a lower bound." : "Priority lines guide review, not test coverage."}`,
      ...new Set([...report.pr.warnings, ...report.warnings]),
      "This export summarizes the original analysis. Raw diffs, generated test source, and execution logs are available in the app or JSON export. Saved reviewer notes and later reproduction/repair results have separate exports.",
    ],
  });
  return {
    title: report.pr.title,
    subtitle: `${report.pr.owner}/${report.pr.repo} - PR #${report.pr.number}`,
    notice:
      report.mode === "DEMO"
        ? "DEMO: Synthetic pull request. Executed evidence applies only to the bundled fixture, not a real repository."
        : "LIVE ANALYSIS: Evidence applies to the recorded commits only.",
    metadata: [
      `Analyzed: ${report.createdAt}`,
      `Report: ${report.id}`,
      `Provider: ${report.provider}`,
      `Base: ${report.pr.baseSha}`,
      `Head: ${report.pr.headSha}`,
    ],
    sections,
  };
}

export function analysisMarkdown(report: AnalysisReport) {
  const document = readableReport(report);
  return [
    "# AI Change Verifier report",
    "",
    `## ${markdownText(document.title)}`,
    "",
    markdownText(document.subtitle),
    "",
    `> ${markdownText(document.notice)}`,
    "",
    ...document.metadata.map(markdownText),
    "",
    ...document.sections.flatMap((section) => [
      `## ${markdownText(section.title)}`,
      "",
      ...section.paragraphs.flatMap((paragraph) => [
        markdownText(paragraph),
        "",
      ]),
    ]),
  ].join("\n");
}

export function reportExportFilename(
  report: AnalysisReport,
  extension: "pdf" | "json" | "md",
) {
  return `change-verifier-pr-${report.pr.number}.${extension}`;
}
