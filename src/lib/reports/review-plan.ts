import type { AnalysisReport } from "@/lib/types";
import type { ReviewState } from "./review";
import { reportEvidence, verificationGaps } from "./verification-gaps";
import {
  revisionChanges,
  revisionCheckExpired,
  revisionMatchesReport,
  type RevisionCheck,
} from "./freshness";
import { reanalysisHref } from "./history";
import { evidenceTarget, type EvidenceTarget } from "./evidence-targets";
import {
  markdownCode as code,
  markdownText as text,
  reviewMarkdown,
} from "./markdown";

export type ReviewAction = {
  id: string;
  kind: "REVISION" | "FINDING" | "EVIDENCE" | "SCOPE" | "DECISIONS";
  title: string;
  detail: string;
  href: string;
  priority: number;
  findingId?: string;
  fileIndex?: number;
  targets?: EvidenceTarget[];
};

/** A deterministic to-do list, never a merge/safety verdict. Only saved decisions count. */
export function buildReviewPlan(
  report: AnalysisReport,
  review: ReviewState | null,
  revision: RevisionCheck | null,
  now = Date.now(),
) {
  if (
    review &&
    (review.reportId !== report.id || review.headSha !== report.pr.headSha)
  )
    throw new Error("Review decisions do not match this report revision.");
  if (revision && !revisionMatchesReport(revision, report))
    throw new Error("The revision check does not match this report.");
  const actions: ReviewAction[] = [];
  const add = (action: ReviewAction) => actions.push(action);
  const changes = revision ? revisionChanges(revision) : null;
  if (report.mode === "LIVE") {
    if (changes?.base || changes?.head)
      add({
        id: "revision-moved",
        kind: "REVISION",
        priority: 0,
        title: "Analyze the latest PR revision",
        detail: `${changes.head && changes.base ? "Base and head commits have" : changes.head ? "The head commit has" : "The base commit has"} changed. Existing evidence and decisions refer to the recorded commits.`,
        href: reanalysisHref(report),
      });
    else if (!revision || revisionCheckExpired(revision, now))
      add({
        id: "revision-check",
        kind: "REVISION",
        priority: 0,
        title: "Check the current GitHub revision",
        detail: revision
          ? "The last revision check is over five minutes old."
          : "A saved report does not establish whether the PR has changed since analysis.",
        href: "#revision-status",
      });
  }
  if (!review)
    add({
      id: "decisions-unavailable",
      kind: "DECISIONS",
      priority: 1,
      title: "Load saved review decisions",
      detail:
        "Decision progress is unknown until saved notes and statuses are available.",
      href: "#human-review",
    });
  let open = 0,
    needsFix = 0,
    reviewed = 0;
  for (const finding of report.findings) {
    if (!review) continue;
    const saved =
      review && Object.hasOwn(review.findings, finding.id)
        ? review.findings[finding.id]
        : undefined;
    const status = saved?.status ?? "OPEN";
    if (status === "OPEN") open++;
    else if (status === "NEEDS_FIX") needsFix++;
    else reviewed++;
    if (status === "REVIEWED" || status === "DISMISSED") continue;
    add({
      id: `finding-${finding.id}`,
      kind: "FINDING",
      priority:
        status === "NEEDS_FIX"
          ? 1
          : finding.severity === "HIGH"
            ? 2
            : finding.severity === "MEDIUM"
              ? 3
              : 4,
      title: finding.title,
      detail: `${status === "NEEDS_FIX" ? "Saved decision: needs fix." : "Awaiting a saved review decision."} ${finding.severity.toLowerCase()} priority · ${finding.generatedTest ? "A targeted test proposal is available." : "Inspect the evidence and record your next step."}`,
      href: `#${finding.id}`,
      findingId: finding.id,
    });
  }
  const evidence = reportEvidence(report);
  const failures = evidence.filter(
    (item) => item.status === "FAIL" && item.provenance !== "STATIC",
  );
  const warnings = evidence.filter(
    (item) => item.status === "WARNING" && item.provenance !== "STATIC",
  );
  const failureTargets = failures.map((item) => evidenceTarget(report, item));
  const warningTargets = warnings.map((item) => evidenceTarget(report, item));
  if (failures.length)
    add({
      id: "execution-failures",
      kind: "EVIDENCE",
      priority: 1,
      title: `Inspect ${failures.length} failed ${report.mode === "DEMO" ? "fixture " : ""}check${failures.length === 1 ? "" : "s"}`,
      detail:
        "A review decision does not resolve failing execution. Inspect assertion/setup validity and reproduce before proposing a repair.",
      href: failureTargets[0].href,
      findingId: failureTargets[0].findingId,
      targets: failureTargets,
    });
  if (warnings.length)
    add({
      id: "execution-warnings",
      kind: "EVIDENCE",
      priority: 2,
      title: `Resolve ${warnings.length} inconclusive execution result${warnings.length === 1 ? "" : "s"}`,
      detail:
        "Recorded execution needs further investigation; warnings are not passes.",
      href: warningTargets[0].href,
      findingId: warningTargets[0].findingId,
      targets: warningTargets,
    });
  const required = ["Build", "TypeScript", "Existing tests"];
  const missingChecks = required.filter(
    (type) =>
      !report.checks.some(
        (check) =>
          check.type === type &&
          report.mode === "LIVE" &&
          check.provenance === "EXECUTED" &&
          check.status !== "NOT_RUN",
      ),
  );
  if (missingChecks.length)
    add({
      id: "missing-checks",
      kind: "EVIDENCE",
      priority: 3,
      title: "Obtain missing repository checks",
      detail: `${missingChecks.join(", ")} ${missingChecks.length === 1 ? "has" : "have"} no recorded repository execution. ${report.mode === "DEMO" ? "Fixture checks do not execute a GitHub repository." : "Configure an execution provider and analyze again, or verify these checks separately."}`,
      href: "#verification",
    });
  const gaps = verificationGaps(report);
  for (const row of gaps.rows.filter(
    (file) => file.risk.level === "HIGH" && !file.hasExecuted,
  ))
    add({
      id: `file-${row.index}`,
      kind: "EVIDENCE",
      priority: 3,
      title: `Investigate ${row.path}`,
      detail:
        "High-risk file without linked repository execution. A file link is not behavioral or line coverage.",
      href: `#changed-file-${row.index}`,
      fileIndex: row.index,
    });
  const incomplete =
    report.reviewSurface.partial ||
    report.pr.files.length < report.pr.changedFiles ||
    gaps.rows.some((row) => !row.patchAvailable || row.partialPatch);
  if (incomplete)
    add({
      id: "partial-scope",
      kind: "SCOPE",
      priority: 4,
      title: "Inspect missing diff context",
      detail: `${report.pr.files.length} of ${report.pr.changedFiles} declared files are listed; one or more patches or revision excerpts are incomplete. Omitted code remains outside this report.`,
      href: "#evidence-gaps",
    });
  if (report.warnings.length || report.pr.warnings.length)
    add({
      id: "limitations",
      kind: "SCOPE",
      priority: 4,
      title: "Read analysis limitations",
      detail:
        "Provider, retrieval, or execution limitations may affect interpretation of the recorded findings.",
      href: "#report-limitations",
    });
  actions.sort((a, b) => a.priority - b.priority);
  return {
    actions,
    counts: {
      open,
      needsFix,
      reviewed,
      failures: failures.length,
      highRiskGaps: gaps.highRiskGaps,
    },
    missingChecks,
    incomplete,
    decisionsLoaded: !!review,
  };
}

export function reviewPlanMarkdown(
  report: AnalysisReport,
  review: ReviewState,
  revision: RevisionCheck | null,
  now = Date.now(),
) {
  const plan = buildReviewPlan(report, review, revision, now);
  return [
    "# Review action plan",
    "",
    `Prepared: ${text(new Date(now).toISOString())}`,
    `Report: ${code(report.id)} · ${code(`${report.pr.owner}/${report.pr.repo}`)} · PR #${report.pr.number}`,
    `Recorded base: ${code(report.pr.baseSha)}`,
    `Recorded head: ${code(report.pr.headSha)}`,
    "",
    "> This is a handoff brief, not merge approval or proof of safety. Only saved decisions are included. Reproduction/repair artifacts are separate from this original report.",
    ...(report.mode === "DEMO"
      ? [
          "> DEMO: synthetic PR and fixture-only execution; no GitHub repository was verified.",
        ]
      : []),
    "",
    "## Revision snapshot",
    "",
    ...(revision
      ? [
          `Checked: ${text(revision.checkedAt)} · ${revision.state}${revision.draft ? " · draft" : ""}${revisionCheckExpired(revision, now) ? " · check expired" : ""}`,
          `Current base: ${code(revision.currentBase)}`,
          `Current head: ${code(revision.currentHead)}`,
          `Commits: ${revisionChanges(revision).base || revisionChanges(revision).head ? "changed since analysis" : "matched at time checked"}. This is an as-of snapshot, not continuous monitoring.`,
        ]
      : [
          report.mode === "DEMO"
            ? "Synthetic scope; GitHub freshness is unavailable."
            : "GitHub revision has not been checked in this session.",
        ]),
    "",
    "## Next actions",
    "",
    ...(plan.actions.length
      ? plan.actions.flatMap((action) => [
          `- [ ] **${text(action.title)}** — ${text(action.detail)}`,
          ...(action.targets ?? []).map(
            (target) => `  - ${text(target.title)}`,
          ),
        ])
      : [
          "No outstanding actions identified by these rules. Human judgment and external repository checks remain necessary.",
        ]),
    "",
    "---",
    "",
    reviewMarkdown(report, review),
  ].join("\n");
}
