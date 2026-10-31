"use client";
import { ReportTargetLink } from "./report-target-link";

import { useMemo, useState } from "react";
import { ArrowRight, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AnalysisReport } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  verificationGaps,
  fileEvidenceLabels,
  filterEvidenceFiles,
  type GapFilters,
} from "@/lib/reports/verification-gaps";

const defaults: GapFilters = { query: "", risk: "ALL", scope: "ALL" };
const pageSize = 10;

export function VerificationGaps({
  report,
  onShowFindings,
}: {
  report: AnalysisReport;
  onShowFindings: () => void;
}) {
  const gaps = useMemo(() => verificationGaps(report), [report]);
  const [filters, setFilters] = useState(defaults);
  const [limit, setLimit] = useState(pageSize);
  const matches = filterEvidenceFiles(gaps.rows, filters);
  const filtered =
    filters.query !== "" || filters.risk !== "ALL" || filters.scope !== "ALL";
  function update(changes: Partial<GapFilters>) {
    setFilters((current) => ({ ...current, ...changes }));
    setLimit(pageSize);
  }
  function inspectFile(index: number) {
    const element = document.getElementById(`changed-file-${index}`);
    if (element instanceof HTMLDetailsElement) element.open = true;
  }
  return (
    <section id="evidence-gaps" aria-labelledby="evidence-gaps-heading">
      <div className="section-heading">
        <div>
          <h2 id="evidence-gaps-heading">Verification gaps</h2>
          <p>
            Find changed files that need more evidence, then inspect the exact
            links.
          </p>
        </div>
        <Button
          variant="outline"
          size="small"
          onClick={() => update({ query: "", risk: "HIGH", scope: "GAPS" })}
        >
          Show high-risk gaps
          <ArrowRight size={13} />
        </Button>
      </div>
      <div className="gap-metrics">
        <div>
          <strong>{gaps.highRiskGaps}</strong>
          <span>High-risk execution gaps</span>
        </div>
        <div>
          <strong>{gaps.executionLinked}</strong>
          <span>Files with linked execution</span>
        </div>
        <div>
          <strong>{gaps.missingPatches}</strong>
          <span>Files without a textual diff</span>
        </div>
      </div>
      <p className="gap-scope-note">
        Evidence links are not line or behavioral test coverage. Passing checks
        only support their recorded assertions. Demo fixture results do not
        count as repository execution.
      </p>
      {(report.reviewSurface.partial ||
        report.pr.files.length < report.pr.changedFiles) && (
        <p className="gap-scope-note amber">
          Scope: {report.pr.files.length} of {report.pr.changedFiles} declared
          changed files are listed. Diff coverage is partial; omitted context is
          not represented here.
        </p>
      )}
      <div
        className="history-filters gap-filters"
        role="search"
        aria-label="Filter verification gaps"
      >
        <label className="history-search">
          <span>Search changed files</span>
          <div>
            <Search size={16} />
            <input
              type="search"
              placeholder="File path"
              value={filters.query}
              maxLength={500}
              onChange={(event) => update({ query: event.target.value })}
            />
          </div>
        </label>
        <label>
          <span>File risk</span>
          <select
            value={filters.risk}
            onChange={(event) =>
              update({ risk: event.target.value as GapFilters["risk"] })
            }
          >
            <option value="ALL">All risks</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </label>
        <label>
          <span>Evidence scope</span>
          <select
            value={filters.scope}
            onChange={(event) =>
              update({ scope: event.target.value as GapFilters["scope"] })
            }
          >
            <option value="ALL">All evidence states</option>
            <option value="GAPS">No linked repository execution</option>
            <option value="EXECUTED">Repository execution linked</option>
            <option value="FAILED">Linked execution failed</option>
            <option value="STATIC">Static inspection only</option>
            <option value="FIXTURE">Demo evidence only</option>
            <option value="NONE">No file-linked evidence</option>
          </select>
        </label>
      </div>
      <div className="list-toolbar">
        <span role="status">
          Showing {Math.min(limit, matches.length)} of {matches.length} matching
          files · {gaps.rows.length} analyzed
        </span>
        {filtered && (
          <Button size="small" variant="ghost" onClick={() => update(defaults)}>
            Clear file filters
          </Button>
        )}
      </div>
      <div className="gap-file-list">
        {matches.slice(0, limit).map((row) => (
          <details
            className="gap-file"
            key={row.path}
            data-file-path={row.path}
          >
            <summary>
              <ChevronRight size={15} />
              <span className="gap-path">
                <code>{row.path}</code>
                <small>
                  {row.findings.length}{" "}
                  {row.findings.length === 1 ? "finding" : "findings"} ·{" "}
                  {row.evidence.length} evidence links
                </small>
              </span>
              <span className={cn("risk-badge", row.risk.level.toLowerCase())}>
                {row.risk.level}
              </span>
              <span
                className={cn(
                  "gap-state",
                  row.state === "EXECUTION_FAILED" && "red",
                  row.state === "EXECUTION_WARNING" && "amber",
                )}
              >
                {fileEvidenceLabels[row.state]}
              </span>
            </summary>
            <div className="gap-file-body">
              <div className="gap-file-actions">
                <ReportTargetLink
                  href={`#changed-file-${row.index}`}
                  className="text-link"
                  onClick={() => inspectFile(row.index)}
                >
                  Inspect file diff
                  <ArrowRight size={13} />
                </ReportTargetLink>
                <span>
                  {!row.patchAvailable
                    ? "No textual diff recorded"
                    : row.partialPatch
                      ? "Partial diff excerpt"
                      : "Supplied diff available"}
                </span>
              </div>
              <p>
                {row.risk.reasons.join(" · ") ||
                  "No elevated deterministic risk signal recorded."}
              </p>
              {row.evidence.length ? (
                <ul className="gap-evidence">
                  {row.evidence.map((record, index) => (
                    <li key={`${record.id}-${index}`}>
                      <strong>{record.type}</strong>
                      <span>
                        {record.status} · {record.provenance}
                      </span>
                      <p>{record.description}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="gap-no-evidence">
                  No check explicitly links this path. Findings and
                  repository-wide results alone do not establish file-level
                  verification.
                </p>
              )}
              {row.findings.length > 0 && (
                <div className="gap-finding-links">
                  <span>Related findings</span>
                  <ul>
                    {row.findings.map((finding) => (
                      <li key={finding.id}>{finding.title}</li>
                    ))}
                  </ul>
                  <ReportTargetLink
                    href="#findings"
                    className="text-link"
                    onClick={onShowFindings}
                  >
                    Review related findings
                    <ArrowRight size={13} />
                  </ReportTargetLink>
                </div>
              )}
            </div>
          </details>
        ))}
      </div>
      {!matches.length && (
        <div className="panel empty-state">
          <Search size={24} />
          <h3>No files match these filters</h3>
          <p>
            This does not establish that the PR is safe. Broaden the filters to
            inspect the available evidence.
          </p>
          <Button
            variant="outline"
            size="small"
            onClick={() => update(defaults)}
          >
            Show all analyzed files
          </Button>
        </div>
      )}
      {matches.length > limit && (
        <Button
          className="gap-show-more"
          variant="outline"
          size="small"
          onClick={() => setLimit((value) => value + pageSize)}
        >
          Show {Math.min(pageSize, matches.length - limit)} more files
        </Button>
      )}
      <p className="gap-scope-note">
        {gaps.unscoped.length} evidence records have no file-path links.{" "}
        <ReportTargetLink className="text-link" href="#verification">
          Inspect verification results
        </ReportTargetLink>
        {gaps.outsideChangedFiles.length > 0 &&
          ` · ${gaps.outsideChangedFiles.length} records reference only paths outside the changed-file list.`}
      </p>
    </section>
  );
}
