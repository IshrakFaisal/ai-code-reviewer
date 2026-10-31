"use client";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { DraftProtectedLink as Link } from "@/components/report/draft-navigation";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleDot,
  Code2,
  ExternalLink,
  FileCode2,
  FlaskConical,
  GitBranch,
  GitPullRequest,
  Info,
  Minus,
  Network,
  ShieldCheck,
  Target,
  Terminal,
  X,
} from "lucide-react";
import type { AnalysisReport, Evidence, Finding } from "@/lib/types";
import { titleCase, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  FindingReview,
  ReviewOverview,
  reviewLabels,
  useReviewChecklist,
  type ReviewChecklist,
} from "./review-checklist";
import { reviewStatuses, type ReviewStatus } from "@/lib/reports/review";
import { ReportNavigation } from "./report-navigation";
import { reanalysisHref } from "@/lib/reports/history";
import { VerificationGaps } from "./verification-gaps";
import { FindingHandoff } from "./finding-handoff";
import { ChangeWorkbench } from "./change-workbench";
import { RevisionStatus } from "./revision-status";
import { ReviewPlan } from "./review-plan";
import type { RevisionCheck } from "@/lib/reports/freshness";
import { usePathname, useRouter } from "next/navigation";
import {
  reportSectionLocation,
  reportTargetHref,
} from "@/lib/reports/sections";
import { openReportTarget } from "./open-report-target";
import { ReportSummary } from "./report-summary";
import { ReportExports } from "./report-exports";
import {
  evidenceIdentity,
  reportEvidence,
} from "@/lib/reports/verification-gaps";

function StatusIcon({ status }: { status: Evidence["status"] }) {
  return status === "PASS" ? (
    <Check size={16} className="green" />
  ) : status === "FAIL" ? (
    <X size={16} className="red" />
  ) : status === "WARNING" ? (
    <AlertCircle size={16} className="amber" />
  ) : (
    <Minus size={16} className="muted" />
  );
}
const statusLabels: Record<Finding["status"], string> = {
  VERIFIED_ISSUE: "Verified issue · fixture",
  VERIFIED_FOR_TEST: "Verified for this test",
  UNVERIFIED_RISK: "Unverified risk",
  INCONCLUSIVE: "Inconclusive",
};
function EvidenceRow({ evidence, id }: { evidence: Evidence; id: string }) {
  return (
    <div className="evidence-row" id={id}>
      <StatusIcon status={evidence.status} />
      <div>
        <span>{evidence.description}</span>
        <small>
          {evidence.status === "NOT_RUN"
            ? "NOT EXECUTED"
            : evidence.provenance === "STATIC"
              ? "DIFF INSPECTION"
              : evidence.provenance === "DEMO_FIXTURE"
                ? "EXECUTED · DEMO FIXTURE"
                : "EXECUTED"}
          {evidence.durationMs !== undefined && ` · ${evidence.durationMs} ms`}
        </small>
        {evidence.output && (
          <details>
            <summary>View output</summary>
            <pre className="code-block">{evidence.output}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
function FindingCard({
  finding: f,
  report,
  index,
  checklist,
}: {
  finding: Finding;
  report: AnalysisReport;
  index: number;
  checklist: ReviewChecklist;
}) {
  return (
    <article
      className={cn("finding-card", f.severity === "HIGH" && "finding-high")}
      id={f.id}
    >
      <div className="finding-header">
        <div className="finding-index">
          {String(index + 1).padStart(2, "0")}
        </div>
        <div>
          <div className="finding-tags">
            <span className={cn("risk-badge", f.severity.toLowerCase())}>
              {f.severity}
            </span>
            <span
              className={cn(
                "finding-status",
                f.status === "VERIFIED_ISSUE" && "red",
              )}
            >
              {f.status === "VERIFIED_ISSUE" ? (
                <CircleDot size={12} />
              ) : (
                <Info size={12} />
              )}{" "}
              {statusLabels[f.status]}
            </span>
          </div>
          <h3>{f.title}</h3>
        </div>
        <span className="score">
          {f.riskScore}
          <small>RISK SCORE</small>
        </span>
      </div>
      <div className="finding-content">
        <p>{f.description}</p>
        <div className="finding-detail-grid">
          <div>
            <h4>BEHAVIORAL CHANGE</h4>
            <p>{f.behavioralChange}</p>
          </div>
          <div>
            <h4>POTENTIAL IMPACT</h4>
            <p>{f.potentialImpact}</p>
          </div>
        </div>
        <div className="finding-files">
          {f.affectedFiles.map((r) => (
            <span key={r.path}>
              <FileCode2 size={13} />
              {report.mode === "LIVE" ? (
                <a
                  href={`https://github.com/${report.pr.owner}/${report.pr.repo}/blob/${r.side === "LEFT" ? report.pr.baseSha : report.pr.headSha}/${r.path.split("/").map(encodeURIComponent).join("/")}${r.startLine ? `#L${r.startLine}${r.endLine ? `-L${r.endLine}` : ""}` : ""}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {r.path}
                  {r.startLine
                    ? `:${r.startLine}–${r.endLine || r.startLine}`
                    : ""}
                  <ExternalLink size={11} />
                </a>
              ) : (
                <code>
                  {r.path}
                  {r.startLine
                    ? `:${r.startLine}–${r.endLine || r.startLine}`
                    : ""}
                </code>
              )}
            </span>
          ))}
        </div>
        <div className="evidence-section">
          <h4>
            <ShieldCheck size={14} />
            VERIFICATION EVIDENCE
          </h4>
          {f.evidence.length ? (
            f.evidence.map((e, i) => (
              <EvidenceRow
                key={`${e.id}-${i}`}
                evidence={e}
                id={`finding-evidence-${index}-${i}`}
              />
            ))
          ) : (
            <p>No execution evidence available.</p>
          )}
        </div>
        {f.generatedTest && (
          <details className="test-disclosure">
            <summary>
              <Code2 size={15} />
              <span>View generated verification test</span>
              <span className="mini-badge">
                {report.mode === "DEMO"
                  ? "AI-GENERATED TEMPLATE · DEMO"
                  : "AI-GENERATED"}
              </span>
              <ChevronRight size={15} />
            </summary>
            <div>
              <p>{f.generatedTest.strategy}</p>
              {f.generatedTest.context && (
                <div>
                  <p>
                    Generation context at commit{" "}
                    <code>{f.generatedTest.context.headSha.slice(0, 7)}</code>
                  </p>
                  <ul>
                    {f.generatedTest.context.files.map((file) => (
                      <li key={file.path}>
                        <code>{file.path}</code> · {file.role}
                        {file.truncated ? " · truncated excerpt" : ""}
                      </li>
                    ))}
                  </ul>
                  <ul>
                    {f.generatedTest.context.limitations.map((limitation) => (
                      <li key={limitation}>{limitation}</li>
                    ))}
                  </ul>
                </div>
              )}
              <pre className="code-block">
                <code>{f.generatedTest.code}</code>
              </pre>
            </div>
          </details>
        )}
        {f.generatedTest &&
          (report.mode === "LIVE" || f.id === "finding-1") && (
            <div className="finding-reproduce">
              <div>
                <strong>Investigate the behavioral difference</strong>
                <p>
                  {report.mode === "DEMO"
                    ? "Compare the bundled base and head fixtures, then recheck a curated repair."
                    : "Run this test at both commits and investigate a bounded repair."}
                </p>
              </div>
              <Link
                className="text-link"
                href={`/report/${report.id}/reproduce/${f.id}`}
                prefetch={false}
              >
                Reproduce & repair <ArrowRight size={14} />
              </Link>
            </div>
          )}
        <div className="recommendation">
          <Target size={17} />
          <div>
            <strong>Human review recommended</strong>
            <p>{f.recommendation}</p>
          </div>
        </div>
        <FindingReview finding={f} checklist={checklist} />
        <FindingHandoff report={report} finding={f} checklist={checklist} />
      </div>
    </article>
  );
}
export function ReportView({ report }: { report: AnalysisReport }) {
  const pathname = usePathname();
  const router = useRouter();
  const location = reportSectionLocation(pathname);
  const section = location?.section ?? "summary";
  // Also support bookmarks and exported links from the previous single-page report.
  useEffect(() => {
    const reveal = () => {
      if (!window.location.hash) return;
      let target: string;
      try {
        target = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return;
      }
      if (
        !/^(summary|revision-status|workbench|human-review|review-plan|verification|evidence-gaps|report-limitations|files|changes|agent-log|findings)$/.test(
          target,
        ) &&
        !/^(finding-evidence-|report-check-|changed-file-)\d/.test(target) &&
        !report.findings.some((finding) => finding.id === target)
      )
        return;
      const destination = reportTargetHref(report.id, window.location.hash);
      if (destination.split("#")[0] !== pathname) {
        router.replace(destination);
        return;
      }
      openReportTarget(window.location.hash);
      document.getElementById(target)?.scrollIntoView({ block: "start" });
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [pathname, report.id, report.findings, router]);
  const [revision, setRevision] = useState<RevisionCheck | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [decisionFilter, setDecisionFilter] = useState<ReviewStatus | "ALL">(
    "ALL",
  );
  const checklist = useReviewChecklist(report);
  const [filterPath, setFilterPath] = useState(pathname);
  if (filterPath !== pathname) {
    setFilterPath(pathname);
    setFilter("ALL");
    setDecisionFilter("ALL");
  }
  function revealFindings() {
    // Flush before the browser follows an anchor to a currently hidden finding.
    flushSync(() => {
      setFilter("ALL");
      setDecisionFilter("ALL");
    });
  }
  const { pr, findings, checks } = report;
  const high = pr.files.filter((f) => f.risk.level === "HIGH").length,
    medium = pr.files.filter((f) => f.risk.level === "MEDIUM").length;
  const visible = findings.filter(
    (f) =>
      (filter === "ALL" || f.severity === filter) &&
      (decisionFilter === "ALL" ||
        (checklist.review?.findings[f.id]?.status ?? "OPEN") ===
          decisionFilter),
  );
  const allEvidence = reportEvidence(report);
  const generated = allEvidence.filter(
    (item) => item.type === "Generated test",
  );
  // Keep original check indices stable for saved evidence links, then include
  // evidence recorded only on a finding (including older report formats).
  const checkIdentities = new Set(checks.map(evidenceIdentity));
  const verificationChecks = [
    ...checks,
    ...allEvidence.filter(
      (item) => !checkIdentities.has(evidenceIdentity(item)),
    ),
  ];
  const areas = report.riskMap
    .filter(
      (r) =>
        !["UNKNOWN", "TESTS", "ENVIRONMENT", "CONFIGURATION"].includes(
          r.category,
        ),
    )
    .slice(0, 5);
  if (!location) return null;
  return (
    <div className="page report-page">
      <div className="report-topline">
        <Link href="/" className="text-link">
          <ArrowLeft size={14} />
          Workspace
        </Link>
        <div>
          <span
            className={report.mode === "DEMO" ? "mode-badge" : "live-badge"}
          >
            {report.mode === "DEMO" ? "DEMO MODE" : "LIVE REPORT"}
          </span>
          <ReportExports report={report} />
        </div>
      </div>
      <div className="report-title">
        <div className="overline">
          <GitPullRequest size={15} />
          Pull request analysis<span>PR #{pr.number}</span>
        </div>
        <h1>{pr.title}</h1>
        <div className="report-meta">
          <span>
            {pr.owner} / <strong>{pr.repo}</strong>
          </span>
          <span>by {pr.author}</span>
          <span>
            <GitBranch size={13} />
            {pr.head}
            <ArrowRight size={12} />
            {pr.base}
          </span>
          {report.mode === "LIVE" && (
            <a
              className="text-link"
              href={pr.url}
              target="_blank"
              rel="noreferrer"
            >
              View on GitHub
              <ArrowUpRight size={13} />
            </a>
          )}
        </div>
        <div className="report-metrics">
          <span>
            <FileCode2 size={14} />
            <b>{pr.changedFiles}</b> files changed
          </span>
          <span>
            <b>{(pr.additions + pr.deletions).toLocaleString()}</b> lines
            changed <small className="green">+{pr.additions}</small>
            <small className="red">−{pr.deletions}</small>
          </span>
          <span className="mono">{pr.headSha.slice(0, 7)}</span>
          <span
            className={cn(
              "risk-badge",
              high ? "high" : medium ? "medium" : "low",
            )}
          >
            {high ? "HIGH" : medium ? "MEDIUM" : "LOW"} RISK
          </span>
        </div>
      </div>
      {report.mode === "DEMO" && (
        <div className="notice">
          <FlaskConical size={17} />
          <span>
            <strong>Demo workspace.</strong> This PR is synthetic. Test results
            come from real execution of the bundled fixture; they do not verify
            a GitHub repository.
          </span>
        </div>
      )}
      {section === "summary" && (
        <div className="report-followup" aria-label="Follow-up review">
          <div className="followup-actions">
            {report.id !== "demo" && (
              <Button asChild variant="outline" size="small">
                <Link href={`/report/${report.id}/compare`}>Compare runs</Link>
              </Button>
            )}
            <Button asChild variant="outline" size="small">
              <Link href={reanalysisHref(report)}>
                {report.mode === "DEMO" ? "Run demo again" : "Analyze again"}
                <ArrowRight size={14} />
              </Link>
            </Button>
          </div>
        </div>
      )}
      <ReportNavigation
        id={report.id}
        active={section}
        findings={findings.length}
      />
      {section === "summary" && (
        <>
          <ReportSummary report={report} />
          <RevisionStatus
            report={report}
            check={revision}
            onChange={setRevision}
          />
        </>
      )}
      {section === "workbench" && (
        <>
          {" "}
          <ChangeWorkbench
            report={report}
            review={checklist.review}
            reviewError={checklist.error}
            onOpenFinding={revealFindings}
          />
        </>
      )}
      {section === "next-steps" && (
        <>
          {" "}
          <ReviewPlan
            report={report}
            checklist={checklist}
            revision={revision}
            onOpenFinding={revealFindings}
          />
        </>
      )}
      {section === "changes" && (
        <>
          {" "}
          <div className="report-overview-grid">
            <section className="panel risk-map">
              <div className="panel-heading">
                <h2>Risk map</h2>
                <Network size={17} />
              </div>
              <p className="panel-caption">
                Deterministic signals across affected systems
              </p>
              {areas.map((r) => (
                <div className="risk-map-row" key={r.category}>
                  <span>{titleCase(r.category)}</span>
                  <div className="risk-track">
                    <i
                      className={`bar-${r.level === "HIGH" ? "red" : r.level === "MEDIUM" ? "amber" : "green"}`}
                      style={{
                        width: `${Math.max(5, Math.min(r.score, 100))}%`,
                      }}
                    />
                  </div>
                  <span className={cn("risk-badge", r.level.toLowerCase())}>
                    {r.level}
                  </span>
                  <small>
                    {r.fileCount} {r.fileCount === 1 ? "file" : "files"}
                  </small>
                </div>
              ))}
              <details className="blast-details">
                <summary>
                  <Network size={14} />
                  Potentially connected systems
                  <ChevronRight size={14} />
                </summary>
                <div className="blast-root">
                  <GitPullRequest size={15} />
                  Pull request #{pr.number}
                </div>
                <div className="blast-line" />
                <div className="blast-nodes">
                  {areas.slice(0, 3).map((r) => (
                    <div key={r.category}>
                      <span className={cn("risk-badge", r.level.toLowerCase())}>
                        {titleCase(r.category)}
                      </span>
                      <p>
                        {r.connected.map(titleCase).join(" · ") ||
                          "No inferred connections"}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="small-note">
                  Category-based relationships, not verified runtime
                  dependencies.
                </p>
              </details>
            </section>
            <section className="panel review-surface">
              <div className="panel-heading">
                <h2>Priority review surface</h2>
                <Target size={17} />
              </div>
              <div className="surface-number">
                {report.reviewSurface.priorityLines}
                <span>
                  {" "}
                  / {report.reviewSurface.totalLines.toLocaleString()}
                </span>
              </div>
              <p>
                changed lines identified as high-priority
                <br />
                for human inspection
              </p>
              <div className="surface-grid" aria-hidden="true">
                {Array.from({ length: 88 }, (_, i) => (
                  <i
                    key={i}
                    className={
                      i <
                      Math.ceil(
                        (report.reviewSurface.priorityLines /
                          Math.max(1, report.reviewSurface.totalLines)) *
                          88,
                      )
                        ? "priority"
                        : ""
                    }
                  />
                ))}
              </div>
              <div className="surface-legend">
                <span>
                  <i />
                  Priority review
                </span>
                <span>
                  <i />
                  Remaining changes
                </span>
              </div>
              <div className="surface-note">
                <Info size={14} />
                <span>
                  {report.reviewSurface.partial
                    ? "Partial diff coverage. This count is a lower bound, not a safety estimate."
                    : "Lower priority does not mean safe. Review scope reflects currently available evidence."}
                </span>
              </div>
            </section>
          </div>
        </>
      )}
      {section === "review" && (
        <>
          {" "}
          <ReviewOverview
            report={report}
            checklist={checklist}
            onOpenFinding={revealFindings}
          />
        </>
      )}
      {section === "findings" && (
        <>
          {" "}
          <section id="findings">
            <div className="section-heading">
              <div>
                <h2>
                  Investigation findings{" "}
                  <span className="count-badge">{findings.length}</span>
                </h2>
                <p>Hypotheses investigated, with evidence you can inspect.</p>
              </div>
              <div className="finding-filters">
                <label className="review-filter">
                  Review decision
                  <select
                    value={decisionFilter}
                    disabled={!checklist.review}
                    onChange={(event) =>
                      setDecisionFilter(
                        event.target.value as ReviewStatus | "ALL",
                      )
                    }
                  >
                    <option value="ALL">All decisions</option>
                    {reviewStatuses.map((status) => (
                      <option key={status} value={status}>
                        {reviewLabels[status]}
                      </option>
                    ))}
                  </select>
                </label>
                <div
                  className="filter-group"
                  role="group"
                  aria-label="Filter findings"
                >
                  {["ALL", "HIGH", "MEDIUM", "LOW"].map((v) => (
                    <button
                      key={v}
                      className={filter === v ? "selected" : ""}
                      aria-pressed={filter === v}
                      onClick={() => setFilter(v)}
                    >
                      {titleCase(v)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {visible.length ? (
              visible.map((f) => (
                <FindingCard
                  key={f.id}
                  finding={f}
                  report={report}
                  index={findings.indexOf(f)}
                  checklist={checklist}
                />
              ))
            ) : (
              <div className="panel empty-state">
                <ShieldCheck size={26} />
                <h3>No findings match these filters</h3>
                <p>
                  This does not establish that the changes are safe. Check
                  coverage and verification limits.
                </p>
              </div>
            )}
          </section>
        </>
      )}
      {section === "verification" && (
        <>
          {" "}
          <section id="verification">
            <div className="section-heading">
              <div>
                <h2>Verification results</h2>
                <p>
                  Executed checks and static inspection are shown separately.
                </p>
              </div>
              <span className="verification-total">
                <b className="green">
                  {generated.filter((e) => e.status === "PASS").length} passed
                </b>
                <b className="red">
                  {generated.filter((e) => e.status === "FAIL").length} failed
                </b>
                <span>targeted tests</span>
              </span>
            </div>
            <div className="verification-grid">
              {verificationChecks
                .map((e, index) => ({ e, index }))
                .map(({ e, index }) => (
                  <div
                    className="check-card"
                    key={`${e.id}-${index}`}
                    id={`report-check-${index}`}
                  >
                    <div>
                      <StatusIcon status={e.status} />
                      <h3>{e.type}</h3>
                      <span
                        className={cn("check-status", e.status.toLowerCase())}
                      >
                        {e.status === "NOT_RUN"
                          ? "NOT AVAILABLE"
                          : e.status === "PASS"
                            ? "PASSED"
                            : e.status === "FAIL"
                              ? "FAILED"
                              : "REVIEW"}
                      </span>
                    </div>
                    <p>{e.description}</p>
                    <small>
                      {e.provenance === "STATIC"
                        ? "DETERMINISTIC DIFF CHECK"
                        : e.status === "NOT_RUN"
                          ? "CHECK NOT EXECUTED"
                          : e.provenance === "DEMO_FIXTURE"
                            ? "EXECUTED · DEMO FIXTURE"
                            : "COMMAND EXECUTED"}
                    </small>
                    {e.output && (
                      <details>
                        <summary>View output</summary>
                        <pre className="code-block">{e.output}</pre>
                      </details>
                    )}
                  </div>
                ))}
            </div>
            {!verificationChecks.length && (
              <p className="small-note">
                No checks were recorded. Review the evidence gaps before drawing
                conclusions.
              </p>
            )}
          </section>
        </>
      )}
      {section === "gaps" && (
        <>
          {" "}
          <VerificationGaps report={report} onShowFindings={revealFindings} />
        </>
      )}
      {section === "changes" && (
        <>
          {" "}
          <section>
            <div className="section-heading">
              <div>
                <h2>Behavioral changes</h2>
                <p>{report.summary}</p>
              </div>
            </div>
            <div className="behavior-grid">
              {report.behaviors.map((b, i) => (
                <article className="panel behavior-card" key={i}>
                  <span className="mini-badge">
                    {b.source === "AI_INFERENCE"
                      ? "AI INFERENCE"
                      : b.source === "DEMO"
                        ? "DEMO SCENARIO"
                        : "PATH HEURISTIC"}
                  </span>
                  <h3>{b.title}</h3>
                  <p>{b.description}</p>
                  <div>
                    {b.files.map((f) => (
                      <code key={f}>{f}</code>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
          <section id="files">
            <div className="section-heading">
              <div>
                <h2>Files to review</h2>
                <p>
                  Prioritized by explainable risk signals. Expand a file to
                  inspect its diff.
                </p>
              </div>
              <span className="subtle">{pr.files.length} files analyzed</span>
            </div>
            <div className="file-list">
              {[...pr.files]
                .sort((a, b) => b.risk.score - a.risk.score)
                .map((f) => (
                  <details
                    key={f.path}
                    id={`changed-file-${pr.files.indexOf(f)}`}
                    className="file-item"
                  >
                    <summary>
                      <ChevronRight size={15} />
                      <FileCode2 size={16} />
                      <code>{f.path}</code>
                      <span className="file-changes">
                        <b className="green">+{f.additions}</b>
                        <b className="red">−{f.deletions}</b>
                      </span>
                      <span
                        className={cn("risk-badge", f.risk.level.toLowerCase())}
                      >
                        {f.risk.level}
                      </span>
                    </summary>
                    <div className="file-expanded">
                      <p>
                        {f.risk.reasons.join(" · ") ||
                          "No elevated deterministic risk signals. Lower priority based on current analysis."}
                      </p>
                      {f.lines.length < f.additions + f.deletions && (
                        <p className="amber">Patch coverage is incomplete.</p>
                      )}
                      <pre className="code-block diff-block">
                        {f.patch
                          ? f.patch.split("\n").map((line, i) => (
                              <span
                                key={i}
                                className={
                                  line.startsWith("+")
                                    ? "diff-add"
                                    : line.startsWith("-")
                                      ? "diff-remove"
                                      : line.startsWith("@@")
                                        ? "diff-hunk"
                                        : ""
                                }
                              >
                                {line}
                                {"\n"}
                              </span>
                            ))
                          : "No textual patch available."}
                      </pre>
                    </div>
                  </details>
                ))}
            </div>
          </section>
        </>
      )}
      {section === "activity" && (
        <>
          {" "}
          <section id="agent-log">
            <div className="section-heading">
              <div>
                <h2>Agent investigation log</h2>
                <p>
                  Concise actions and observations from the bounded
                  investigation.
                </p>
              </div>
              <span className="mini-badge">{report.provider}</span>
            </div>
            <details className="panel agent-log-panel">
              <summary>
                <Terminal size={16} />
                {report.events.length} investigation events
                <ArrowDown size={15} />
              </summary>
              <ol className="agent-timeline">
                {report.events.map((e, i) => (
                  <li key={i}>
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <div>
                      <h3>
                        {e.label}
                        {e.phase && <small>{e.phase}</small>}
                      </h3>
                      <p>{e.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </details>
          </section>
        </>
      )}
      {section === "gaps" && (
        <section id="report-limitations" className="coverage-panel">
          <div>
            <Info size={18} />
            <h3>Coverage & limitations</h3>
          </div>
          {!report.warnings.length && !pr.warnings.length && (
            <p>No additional limitations recorded.</p>
          )}
          <ul>
            {[...new Set([...report.warnings, ...pr.warnings])].map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>
      )}
      <div className="report-bottom">
        <span>
          <ShieldCheck size={16} />
          Evidence informs the review. You make the decision.
        </span>
        <Button asChild variant="outline">
          <Link href="/">
            Analyze another PR
            <ArrowRight size={15} />
          </Link>
        </Button>
      </div>
    </div>
  );
}
