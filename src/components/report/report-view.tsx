"use client";
import { useState } from "react";
import Link from "next/link";
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
  Download,
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
function EvidenceRow({ evidence }: { evidence: Evidence }) {
  return (
    <div className="evidence-row">
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
}: {
  finding: Finding;
  report: AnalysisReport;
  index: number;
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
              <EvidenceRow key={`${e.id}-${i}`} evidence={e} />
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
              <pre className="code-block">
                <code>{f.generatedTest.code}</code>
              </pre>
            </div>
          </details>
        )}
        <div className="recommendation">
          <Target size={17} />
          <div>
            <strong>Human review recommended</strong>
            <p>{f.recommendation}</p>
          </div>
        </div>
      </div>
    </article>
  );
}
export function ReportView({ report }: { report: AnalysisReport }) {
  const [filter, setFilter] = useState("ALL");
  const { pr, findings, checks } = report;
  const high = pr.files.filter((f) => f.risk.level === "HIGH").length,
    medium = pr.files.filter((f) => f.risk.level === "MEDIUM").length,
    low = pr.files.filter((f) => f.risk.level === "LOW").length;
  const visible = findings.filter(
    (f) => filter === "ALL" || f.severity === filter,
  );
  const generated = checks.filter((c) => c.type === "Generated test").length
    ? checks.filter((c) => c.type === "Generated test")
    : findings.flatMap((f) =>
        f.evidence.filter((e) => e.type === "Generated test"),
      );
  const areas = report.riskMap
    .filter(
      (r) =>
        !["UNKNOWN", "TESTS", "ENVIRONMENT", "CONFIGURATION"].includes(
          r.category,
        ),
    )
    .slice(0, 5);
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `change-verifier-pr-${pr.number}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
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
          <Button variant="outline" size="small" onClick={download}>
            <Download size={14} />
            Export JSON
          </Button>
        </div>
      </div>
      <div className="report-title">
        <div className="overline">
          <GitPullRequest size={15} />
          AI CHANGE VERIFICATION<span>PR #{pr.number}</span>
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
      <nav className="report-nav" aria-label="Report sections">
        <a href="#summary">Overview</a>
        <a href="#findings">
          Findings <span>{findings.length}</span>
        </a>
        <a href="#verification">Verification</a>
        <a href="#files">Changed files</a>
        <a href="#agent-log">Agent log</a>
      </nav>
      <section id="summary">
        <div className="section-heading compact">
          <h2>Review summary</h2>
          <span className="subtle">
            Where your attention makes a difference
          </span>
        </div>
        <div className="summary-grid">
          <div className="summary-card summary-high">
            <span className="summary-icon">
              <Target size={19} />
            </span>
            <strong>{high.toString().padStart(2, "0")}</strong>
            <div>
              <h3>Require human attention</h3>
              <p>Files with high risk signals</p>
            </div>
          </div>
          <div className="summary-card summary-medium">
            <span className="summary-icon">
              <AlertCircle size={19} />
            </span>
            <strong>{medium.toString().padStart(2, "0")}</strong>
            <div>
              <h3>Worth reviewing</h3>
              <p>Files with moderate risk signals</p>
            </div>
          </div>
          <div className="summary-card summary-low">
            <span className="summary-icon">
              <Check size={19} />
            </span>
            <strong>{low.toString().padStart(2, "0")}</strong>
            <div>
              <h3>Lower priority</h3>
              <p>Based on current verification</p>
            </div>
          </div>
        </div>
      </section>
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
                  style={{ width: `${Math.max(5, Math.min(r.score, 100))}%` }}
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
              Category-based relationships, not verified runtime dependencies.
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
            <span> / {report.reviewSurface.totalLines.toLocaleString()}</span>
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
      <section id="findings">
        <div className="section-heading">
          <div>
            <h2>
              Investigation findings{" "}
              <span className="count-badge">{findings.length}</span>
            </h2>
            <p>Hypotheses investigated, with evidence you can inspect.</p>
          </div>
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
        {visible.length ? (
          visible.map((f, i) => (
            <FindingCard key={f.id} finding={f} report={report} index={i} />
          ))
        ) : (
          <div className="panel empty-state">
            <ShieldCheck size={26} />
            <h3>No findings in this category</h3>
            <p>
              This does not establish that the changes are safe. Check coverage
              and verification limits.
            </p>
          </div>
        )}
      </section>
      <section id="verification">
        <div className="section-heading">
          <div>
            <h2>Verification results</h2>
            <p>Executed checks and static inspection are shown separately.</p>
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
          {checks
            .filter((e) => e.type !== "Generated test")
            .map((e) => (
              <div className="check-card" key={e.id}>
                <div>
                  <StatusIcon status={e.status} />
                  <h3>{e.type}</h3>
                  <span className={cn("check-status", e.status.toLowerCase())}>
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
      </section>
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
              Prioritized by explainable risk signals. Expand a file to inspect
              its diff.
            </p>
          </div>
          <span className="subtle">{pr.files.length} files analyzed</span>
        </div>
        <div className="file-list">
          {[...pr.files]
            .sort((a, b) => b.risk.score - a.risk.score)
            .map((f) => (
              <details key={f.path} className="file-item">
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
      <section className="panel lower-priority">
        <ShieldCheck size={22} />
        <div>
          <h3>
            {low} lower-priority {low === 1 ? "change" : "changes"}
          </h3>
          <p>
            These files have fewer deterministic risk signals. They have not
            been declared safe, and unexecuted checks leave gaps in
            verification.
          </p>
        </div>
        <a href="#files" className="text-link">
          Inspect files
          <ArrowUpRight size={14} />
        </a>
      </section>
      <section id="agent-log">
        <div className="section-heading">
          <div>
            <h2>Agent investigation log</h2>
            <p>
              Concise actions and observations from the bounded investigation.
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
      {!!report.warnings.length && (
        <section className="coverage-panel">
          <div>
            <Info size={18} />
            <h3>Coverage & limitations</h3>
          </div>
          <ul>
            {report.warnings.map((w, i) => (
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
