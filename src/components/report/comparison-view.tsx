import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { AnalysisReport, Finding } from "@/lib/types";
import type { compareReports, FindingChange } from "@/lib/reports/comparison";

export function runDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dhaka",
  }).format(new Date(value));
}

function RunDetails({
  report,
  label,
}: {
  report: AnalysisReport;
  label: string;
}) {
  return (
    <div className="comparison-run">
      <div className="section-heading">
        <h2>{label}</h2>
        <Link className="text-link" href={`/report/${report.id}`}>
          Open report
          <ArrowRight size={13} />
        </Link>
      </div>
      <time dateTime={report.createdAt}>
        {runDate(report.createdAt)} · Asia/Dhaka
      </time>
      <dl>
        <div>
          <dt>Head</dt>
          <dd>
            <code>{report.pr.headSha}</code>
          </dd>
        </div>
        <div>
          <dt>Base</dt>
          <dd>
            <code>{report.pr.baseSha}</code>
          </dd>
        </div>
        <div>
          <dt>Provider</dt>
          <dd>{report.provider}</dd>
        </div>
      </dl>
      <p>
        {report.findings.length} findings · {report.pr.changedFiles} changed
        files
      </p>
      <p>
        {report.reviewSurface.partial ? "At least " : ""}
        {report.reviewSurface.priorityLines.toLocaleString()} priority lines /{" "}
        {report.reviewSurface.totalLines.toLocaleString()} changed lines
        {report.reviewSurface.partial ? " · Partial coverage" : ""}
      </p>
    </div>
  );
}

function FindingSnapshot({
  finding,
  report,
  label,
}: {
  finding?: Finding;
  report: AnalysisReport;
  label: string;
}) {
  return (
    <div className="comparison-snapshot">
      <span>{label}</span>
      {finding ? (
        <>
          <strong>
            {finding.severity} · {finding.riskScore} priority score
          </strong>
          <code>{finding.status}</code>
          <Link
            className="text-link"
            href={`/report/${report.id}#${encodeURIComponent(finding.id)}`}
          >
            Inspect finding
            <ArrowRight size={13} />
          </Link>
        </>
      ) : (
        <p>Not observed in this run</p>
      )}
    </div>
  );
}

const groups: { kind: FindingChange["kind"]; label: string; hint: string }[] = [
  {
    kind: "NEW",
    label: "Newly observed",
    hint: "Findings without an unambiguous match in the earlier run.",
  },
  {
    kind: "REPEATED",
    label: "Observed in both runs",
    hint: "Matched findings, including changes to priority or evidence.",
  },
  {
    kind: "NOT_OBSERVED",
    label: "Not observed in the later run",
    hint: "These still need human assessment; absence does not establish a fix.",
  },
];

export function ComparisonView({
  before,
  after,
  comparison,
}: {
  before: AnalysisReport;
  after: AnalysisReport;
  comparison: ReturnType<typeof compareReports>;
}) {
  return (
    <>
      <div className="comparison-counts" aria-label="Finding comparison counts">
        <div>
          <strong>{comparison.counts.new}</strong>
          <span>Newly observed</span>
        </div>
        <div>
          <strong>{comparison.counts.repeated}</strong>
          <span>In both runs</span>
        </div>
        <div>
          <strong>{comparison.counts.notObserved}</strong>
          <span>Not observed later</span>
        </div>
      </div>
      <div className="comparison-runs">
        <RunDetails report={before} label="Earlier run" />
        <RunDetails report={after} label="Later run" />
      </div>
      <section className="comparison-limits" aria-label="Comparison limits">
        <h2>Read this comparison with context</h2>
        <ul>
          {comparison.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
        {(before.warnings.length > 0 ||
          after.warnings.length > 0 ||
          before.pr.warnings.length > 0 ||
          after.pr.warnings.length > 0) && (
          <details>
            <summary>Warnings recorded by each run</summary>
            {[
              { report: before, label: "Earlier run" },
              { report: after, label: "Later run" },
            ].map(({ report, label }) => (
              <div key={report.id}>
                <h3>{label}</h3>
                <ul>
                  {[
                    ...new Set([...report.warnings, ...report.pr.warnings]),
                  ].map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ))}
          </details>
        )}
      </section>
      <section
        className="comparison-section"
        aria-labelledby="finding-changes-heading"
      >
        <div className="section-heading">
          <h2 id="finding-changes-heading">Finding changes</h2>
          <span className="subtle">Observations across saved analyses</span>
        </div>
        {!comparison.findings.length && (
          <p className="comparison-empty">
            Neither run recorded findings. Review the checks and scope before
            drawing a conclusion.
          </p>
        )}
        {groups.map(({ kind, label, hint }) => {
          const findings = comparison.findings.filter(
            (finding) => finding.kind === kind,
          );
          if (!findings.length) return null;
          return (
            <div className="comparison-group" key={kind}>
              <h3>
                {label} <span>{findings.length}</span>
              </h3>
              <p>{hint}</p>
              {findings.map((change, index) => {
                const finding = change.after ?? change.before!;
                return (
                  <article
                    className="comparison-finding"
                    key={`${finding.id}-${index}`}
                  >
                    <h4>{finding.title}</h4>
                    <p>
                      {finding.category} ·{" "}
                      {[
                        ...new Set(
                          finding.affectedFiles.map((file) => file.path),
                        ),
                      ].join(", ") || "No affected file recorded"}
                    </p>
                    {change.changes.length > 0 && (
                      <ul className="comparison-change-notes">
                        {change.changes.map((text) => (
                          <li key={text}>{text}</li>
                        ))}
                      </ul>
                    )}
                    <div className="comparison-snapshots">
                      <FindingSnapshot
                        finding={change.before}
                        report={before}
                        label="Earlier run"
                      />
                      <FindingSnapshot
                        finding={change.after}
                        report={after}
                        label="Later run"
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          );
        })}
      </section>
      <section
        className="comparison-section"
        aria-labelledby="check-changes-heading"
      >
        <div className="section-heading">
          <h2 id="check-changes-heading">Verification results</h2>
          <span className="subtle">Recorded status and provenance</span>
        </div>
        <p className="comparison-caption">
          Checks are matched by type and file paths; descriptions distinguish
          multiple checks for the same files. Commands and assertions may
          differ, so a status change alone does not establish a regression or
          fix.
        </p>
        {!comparison.checks.length && (
          <p className="comparison-empty">
            Neither run recorded verification checks.
          </p>
        )}
        {comparison.checks.length > 0 && (
          <div
            className="comparison-checks"
            role="table"
            aria-label="Verification comparison"
          >
            <div className="comparison-check-head" role="row">
              <span role="columnheader">Check</span>
              <span role="columnheader">Earlier run</span>
              <span role="columnheader">Later run</span>
            </div>
            {comparison.checks.map((change, index) => (
              <div className="comparison-check" role="row" key={index}>
                <div role="cell">
                  <strong>{(change.after ?? change.before)!.type}</strong>
                  <span>
                    {!change.before
                      ? "No earlier match"
                      : !change.after
                        ? "No later match"
                        : change.changed
                          ? "Result changed"
                          : "Same result"}
                  </span>
                  <p className="comparison-check-description">
                    {(change.after ?? change.before)!.description}
                  </p>
                  <small>
                    {[
                      ...new Set([
                        ...(change.before?.filePaths ?? []),
                        ...(change.after?.filePaths ?? []),
                      ]),
                    ].join(", ")}
                  </small>
                </div>
                {[change.before, change.after].map((check, position) => (
                  <div role="cell" key={position}>
                    <span className="comparison-mobile-label">
                      {position === 0 ? "Earlier run" : "Later run"}
                    </span>
                    {check ? (
                      <>
                        <strong>{check.status}</strong>
                        <code>{check.provenance}</code>
                      </>
                    ) : (
                      <span>No matched check</span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
      <section
        className="comparison-section"
        aria-labelledby="risk-changes-heading"
      >
        <div className="section-heading">
          <h2 id="risk-changes-heading">Risk-map changes</h2>
          <span className="subtle">
            Review priority, not defect probability
          </span>
        </div>
        {comparison.riskChanges.length ? (
          <div className="comparison-risk-list">
            {comparison.riskChanges.map((change) => (
              <div key={(change.after ?? change.before)!.category}>
                <strong>{(change.after ?? change.before)!.category}</strong>
                <span>
                  Earlier:{" "}
                  {change.before
                    ? `${change.before.level} · ${change.before.score} · ${change.before.fileCount} files`
                    : "Not recorded"}
                </span>
                <span>
                  Later:{" "}
                  {change.after
                    ? `${change.after.level} · ${change.after.score} · ${change.after.fileCount} files`
                    : "Not recorded"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="comparison-empty">
            No recorded category score, level, or file-count changes.
          </p>
        )}
      </section>
    </>
  );
}
