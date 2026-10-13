import type { AnalysisReport, Evidence, LineRef } from "@/lib/types";
import type { ReviewState } from "./review";

const decisionLabels = {
  OPEN: "Open",
  NEEDS_FIX: "Needs fix",
  REVIEWED: "Reviewed",
  DISMISSED: "Dismissed",
} as const;

function singleLine(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// PR descriptions, model output and reviewer notes are all untrusted content.
// Flattening lines also prevents injected headings, lists and block quotes.
function text(value: string): string {
  return singleLine(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}[\]()#+\-.!|~]/g, "\\$&");
}

function code(value: string): string {
  // Preserve spaces in filenames; CommonMark only strips a surrounding pair.
  const content =
    value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ") || "(empty)";
  const longest = Math.max(
    0,
    ...Array.from(content.matchAll(/`+/g), (match) => match[0].length),
  );
  const delimiter = "`".repeat(longest + 1);
  const padding =
    content.startsWith("`") ||
    content.endsWith("`") ||
    (content.startsWith(" ") && content.endsWith(" ") && content.trim())
      ? " "
      : "";
  return `${delimiter}${padding}${content}${padding}${delimiter}`;
}

function pullRequestReference(raw: string): string {
  try {
    const url = new URL(raw);
    if (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      /^\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*\/?$/.test(url.pathname)
    ) {
      return `[Open pull request](${url.href})`;
    }
  } catch {
    // Keep invalid URLs as inert text rather than emitting an unsafe link.
  }
  return `Pull request URL: ${code(raw)}`;
}

function fileReference(reference: LineRef): string {
  const line = reference.startLine
    ? `:${reference.startLine}${reference.endLine && reference.endLine !== reference.startLine ? `-${reference.endLine}` : ""}`
    : "";
  const side =
    reference.side === "LEFT"
      ? " (base revision)"
      : reference.side === "RIGHT"
        ? " (head revision)"
        : "";
  return `${code(`${reference.path}${line}`)}${side}`;
}

function evidenceLine(evidence: Evidence): string {
  return `- ${text(evidence.type)}: ${code(evidence.status)} / ${code(evidence.provenance)} — ${text(evidence.description)}`;
}

/** A portable review draft; this never changes evidence or posts to GitHub. */
export function reviewMarkdown(
  report: AnalysisReport,
  review: ReviewState,
): string {
  if (review.reportId !== report.id || review.headSha !== report.pr.headSha) {
    throw new Error(
      "Review decisions do not belong to this report and head revision.",
    );
  }

  const decisions = report.findings.map((finding) => {
    const saved = Object.hasOwn(review.findings, finding.id)
      ? review.findings[finding.id]
      : undefined;
    return {
      finding,
      status: saved?.status ?? "OPEN",
      note: saved?.note ?? "",
    };
  });
  const counts = { OPEN: 0, NEEDS_FIX: 0, REVIEWED: 0, DISMISSED: 0 };
  for (const decision of decisions) counts[decision.status] += 1;

  const lines = [
    "# AI Change Verifier review",
    "",
    report.mode === "DEMO"
      ? "> **DEMO — synthetic PR; execution evidence applies only to the bundled fixture, not a real repository.**"
      : "> **LIVE analysis — distinguish static inspection from executed evidence below.**",
    "",
    `**${text(report.pr.title)}**`,
    "",
    `${pullRequestReference(report.pr.url)} · Repository: ${code(`${report.pr.owner}/${report.pr.repo}`)} · PR #${report.pr.number}`,
    "",
    `Head revision: ${code(report.pr.headSha)}`,
    `Base revision: ${code(report.pr.baseSha)}`,
    `Report: ${code(report.id)} · Created: ${text(report.createdAt)} · Provider: ${text(report.provider)}`,
    "",
    text(report.summary),
    "",
    "## Reviewer decisions",
    "",
    `Open: ${counts.OPEN} · Needs fix: ${counts.NEEDS_FIX} · Reviewed: ${counts.REVIEWED} · Dismissed: ${counts.DISMISSED}`,
    "",
    "Reviewer decisions are annotations only. Reviewed or Dismissed does not verify a fix, change the evidence, or approve a merge.",
    `Review revision: ${review.revision}${review.updatedAt ? ` · Last saved: ${text(review.updatedAt)}` : " · No saved decisions"}`,
    "",
    "## Findings",
    "",
  ];

  if (!decisions.length) {
    lines.push(
      "No findings were produced. This does not establish that the change is risk-free.",
      "",
    );
  }
  for (const [index, { finding, status, note }] of decisions.entries()) {
    lines.push(
      `### ${index + 1}. ${text(finding.title)}`,
      "",
      `Severity: ${code(finding.severity)} · Category: ${text(finding.category)} · Risk score: ${finding.riskScore}/100`,
      `Evidence conclusion: ${code(finding.status)} · Reviewer decision: **${decisionLabels[status]}**`,
      "",
      text(finding.description),
      "",
      `Behavioral change: ${text(finding.behavioralChange)}`,
      "",
      `Potential impact: ${text(finding.potentialImpact)}`,
      "",
      `Recommendation: ${text(finding.recommendation)}`,
      "",
      `Affected files: ${finding.affectedFiles.length ? finding.affectedFiles.map(fileReference).join(", ") : "No file references supplied."}`,
      "",
      `Reviewer note: ${note ? text(note) : "None."}`,
      "",
      "Evidence:",
      "",
      ...(finding.evidence.length
        ? finding.evidence.map(evidenceLine)
        : ["- No evidence recorded; the finding remains unverified."]),
      "",
    );
  }

  lines.push(
    "## Verification checks",
    "",
    "PASS and FAIL describe the recorded check only. NOT_RUN is unexecuted. STATIC is inspection; EXECUTED is repository execution; DEMO_FIXTURE applies only to the bundled fixture.",
    "",
    ...(report.checks.length
      ? report.checks.map(evidenceLine)
      : ["- No verification checks were recorded."]),
    "",
    "## Coverage and limitations",
    "",
    report.reviewSurface.partial
      ? `Priority review surface: at least ${report.reviewSurface.priorityLines} lines out of ${report.reviewSurface.totalLines} changed lines. Diff coverage is partial; the priority count is a lower bound.`
      : `Priority review surface: ${report.reviewSurface.priorityLines} lines out of ${report.reviewSurface.totalLines} changed lines.`,
    "",
    "Priority lines guide review; they do not establish test coverage or safety of other changed lines.",
    "",
    ...Array.from(new Set([...report.pr.warnings, ...report.warnings])).map(
      (warning) => `- ${text(warning)}`,
    ),
    "",
    "Generated test source and raw execution logs are omitted. Review the saved report for full details. This draft was not posted to GitHub.",
    "",
  );
  return lines.join("\n");
}
