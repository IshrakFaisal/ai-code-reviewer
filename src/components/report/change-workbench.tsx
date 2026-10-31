"use client";
import { ReportTargetLink } from "./report-target-link";

import { useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { DraftProtectedLink as Link } from "@/components/report/draft-navigation";
import {
  ArrowDown,
  ArrowRight,
  FileCode2,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { AnalysisReport } from "@/lib/types";
import {
  diffRows,
  diffPageSize,
  matchingDiffRows,
  nextDiffPosition,
} from "@/lib/reports/diff";
import { cn } from "@/lib/utils";
import {
  filterWorkbenchFiles,
  type WorkbenchScope,
} from "@/lib/reports/workbench";
import type { ReviewState } from "@/lib/reports/review";
import { openReportTarget } from "./open-report-target";

export function ChangeWorkbench({
  report,
  onOpenFinding,
  review,
  reviewError,
}: {
  report: AnalysisReport;
  onOpenFinding: () => void;
  review: ReviewState | null;
  reviewError: string;
}) {
  const files = useMemo(
    () => [...report.pr.files].sort((a, b) => b.risk.score - a.risk.score),
    [report.pr.files],
  );
  const [path, setPath] = useState(files[0]?.path ?? "");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<WorkbenchScope>("ALL");
  const fileButtons = useRef(new Map<string, HTMLButtonElement>());
  const [findingId, setFindingId] = useState("");
  const [view, setView] = useState<"diff" | "test">("diff");
  const [diffQuery, setDiffQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const [activeHunk, setActiveHunk] = useState(-1);
  const [diffPage, setDiffPage] = useState(0);
  const diffElements = useRef(new Map<number, HTMLDivElement>());
  const file = files.find((item) => item.path === path);
  const related = report.findings
    .filter((item) => item.affectedFiles.some((ref) => ref.path === path))
    .sort((a, b) => b.riskScore - a.riskScore);
  const finding = related.find((item) => item.id === findingId) ?? related[0];
  const shown = useMemo(
    () => filterWorkbenchFiles(report, files, query, scope, review),
    [report, files, query, scope, review],
  );
  function selectFile(nextPath: string) {
    setPath(nextPath);
    setFindingId("");
    setView("diff");
    setActiveMatch(0);
    setActiveHunk(-1);
    setDiffPage(0);
    setDiffQuery("");
  }
  const rows = useMemo(() => diffRows(file?.patch ?? ""), [file?.patch]);
  const pageCount = Math.max(1, Math.ceil(rows.length / diffPageSize));
  const pageStart = diffPage * diffPageSize;
  const visibleRows = rows.slice(pageStart, pageStart + diffPageSize);
  const matches = useMemo(
    () => matchingDiffRows(rows, diffQuery),
    [rows, diffQuery],
  );
  const matchSet = useMemo(() => new Set(matches), [matches]);
  const matchIndex = Math.min(activeMatch, Math.max(matches.length - 1, 0));
  const hunks = rows.flatMap((row, index) =>
    row.kind === "hunk" ? [index] : [],
  );
  function revealRow(index: number) {
    flushSync(() => setDiffPage(Math.floor(index / diffPageSize)));
    diffElements.current
      .get(index)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function navigateHunk(offset: number) {
    if (!hunks.length) return;
    const next = nextDiffPosition(activeHunk, hunks.length, offset);
    setActiveHunk(next);
    revealRow(hunks[next]);
  }
  function navigateMatch(offset: number) {
    if (!matches.length) return;
    const next = nextDiffPosition(matchIndex, matches.length, offset);
    setActiveMatch(next);
    revealRow(matches[next]);
  }
  const canReproduce =
    finding?.generatedTest &&
    (report.mode === "LIVE" || finding.id === "finding-1");

  return (
    <section
      id="workbench"
      className="change-workbench"
      aria-labelledby="workbench-heading"
    >
      <div className="workbench-heading">
        <div>
          <FileCode2 size={16} />
          <h2 id="workbench-heading">Change workbench</h2>
        </div>
        <span>Diff, findings &amp; evidence</span>
      </div>
      <div className="workbench-grid">
        <div className="workbench-explorer">
          <div className="workbench-pane-label">
            Changed files <span>{files.length}</span>
          </div>
          <label className="workbench-search">
            <Search size={13} />
            <input
              aria-label="Filter workbench files"
              placeholder="Find a file…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="workbench-scope">
            Review focus
            <select
              aria-label="Workbench review focus"
              value={scope}
              onChange={(event) =>
                setScope(event.target.value as WorkbenchScope)
              }
            >
              <option value="ALL">All changed files</option>
              <option value="HIGH">High risk</option>
              <option value="FINDINGS">With findings</option>
              <option value="GAPS">High-risk execution gaps</option>
              <option value="OPEN" disabled={!review}>
                Needs review · saved
              </option>
              <option value="NEEDS_FIX" disabled={!review}>
                Needs fix · saved
              </option>
            </select>
          </label>
          <div className="workbench-filter-status">
            <span>
              {shown.length} of {files.length} files
            </span>
            {(query || scope !== "ALL") && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setScope("ALL");
                }}
              >
                Reset filters
              </button>
            )}
          </div>
          {file && !shown.some((item) => item.path === path) && (
            <p className="workbench-selection-note">
              Selected file is outside these filters.
            </p>
          )}
          <div
            className="workbench-file-list"
            role="group"
            aria-label="Workbench changed files"
            onKeyDown={(event) => {
              if (
                !(event.target instanceof HTMLButtonElement) ||
                !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) ||
                !shown.length
              )
                return;
              event.preventDefault();
              const selectedPath = event.target.getAttribute("data-path");
              const index = shown.findIndex(
                (item) => item.path === selectedPath,
              );
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? shown.length - 1
                    : Math.max(
                        0,
                        Math.min(
                          shown.length - 1,
                          index + (event.key === "ArrowDown" ? 1 : -1),
                        ),
                      );
              selectFile(shown[next].path);
              fileButtons.current.get(shown[next].path)?.focus();
            }}
          >
            {shown.map((item) => (
              <button
                key={item.path}
                data-path={item.path}
                ref={(element) => {
                  if (element) fileButtons.current.set(item.path, element);
                  else fileButtons.current.delete(item.path);
                }}
                type="button"
                aria-pressed={path === item.path}
                className={cn(
                  "workbench-file",
                  path === item.path && "selected",
                )}
                onClick={() => selectFile(item.path)}
                title={item.path}
              >
                <span
                  className={cn(
                    "workbench-risk-dot",
                    item.risk.level.toLowerCase(),
                  )}
                  aria-label={`${item.risk.level.toLowerCase()} risk`}
                />
                <span>
                  <strong>{item.path.split("/").at(-1)}</strong>
                  <small>
                    {item.path.includes("/")
                      ? item.path.slice(0, item.path.lastIndexOf("/"))
                      : "Repository root"}
                  </small>
                </span>
                <small>+{item.additions}</small>
              </button>
            ))}
            {!shown.length && (
              <p className="workbench-empty">
                {files.length
                  ? "No matching files. Change the review focus or reset filters."
                  : "No changed files were retrieved."}
              </p>
            )}
          </div>
          <div className="workbench-explorer-note">
            Ordered by risk score. Use ↑ / ↓, Home, or End within the file list.
          </div>
        </div>

        <div className="workbench-editor">
          <div className="workbench-editor-heading">
            <code>{file?.path ?? "No file selected"}</code>
            {file && (
              <span>
                <b className="green">+{file.additions}</b>
                <b className="red">−{file.deletions}</b>
              </span>
            )}
          </div>
          <div
            className="workbench-view-controls"
            role="group"
            aria-label="Workbench content"
          >
            <button
              type="button"
              aria-pressed={view === "diff"}
              onClick={() => setView("diff")}
            >
              Unified diff
            </button>
            <button
              type="button"
              aria-pressed={view === "test"}
              disabled={!finding?.generatedTest}
              onClick={() => setView("test")}
            >
              Verification test
            </button>
            <span>
              {report.pr.baseSha.slice(0, 7)} → {report.pr.headSha.slice(0, 7)}
            </span>
          </div>
          {view === "diff" && file?.patch && (
            <div className="workbench-diff-search">
              <label>
                Search this diff
                <input
                  value={diffQuery}
                  onChange={(event) => {
                    setDiffQuery(event.target.value);
                    setActiveMatch(0);
                    const first = matchingDiffRows(rows, event.target.value)[0];
                    if (first !== undefined) revealRow(first);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setDiffQuery("");
                      setActiveMatch(0);
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      navigateMatch(event.shiftKey ? -1 : 1);
                    }
                  }}
                  placeholder="Search retrieved patch…"
                />
              </label>
              <span role="status">
                {diffQuery.trim()
                  ? `${matches.length ? matchIndex + 1 : 0} of ${matches.length} matching lines`
                  : "Search all retrieved lines"}
              </span>
              <button
                type="button"
                disabled={!matches.length}
                onClick={() => navigateMatch(-1)}
                aria-label="Previous diff match"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={!matches.length}
                onClick={() => navigateMatch(1)}
                aria-label="Next diff match"
              >
                Next
              </button>
              <button
                type="button"
                disabled={!hunks.length}
                onClick={() => navigateHunk(-1)}
                aria-label="Previous change hunk"
              >
                Previous change
              </button>
              <button
                type="button"
                disabled={!hunks.length}
                onClick={() => navigateHunk(1)}
                aria-label="Next change hunk"
              >
                Next change
              </button>
              <span role="status">
                {activeHunk < 0
                  ? `${hunks.length} change hunks`
                  : `Change ${activeHunk + 1} of ${hunks.length}`}
              </span>
              {diffQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setDiffQuery("");
                    setActiveMatch(0);
                  }}
                >
                  Clear search
                </button>
              )}
              <div className="workbench-diff-pagination">
                <span role="status">
                  Patch rows {pageStart + 1}–
                  {Math.min(pageStart + diffPageSize, rows.length)} of{" "}
                  {rows.length} · Page {diffPage + 1} of {pageCount}
                </span>
                <button
                  type="button"
                  disabled={diffPage === 0}
                  onClick={() => revealRow(pageStart - diffPageSize)}
                >
                  Previous page
                </button>
                <button
                  type="button"
                  disabled={diffPage + 1 >= pageCount}
                  onClick={() => revealRow(pageStart + diffPageSize)}
                >
                  Next page
                </button>
                <small>
                  Search covers the retrieved patch only. Missing upstream
                  changes cannot be searched.
                </small>
              </div>
            </div>
          )}
          {view === "test" && finding?.generatedTest ? (
            <div className="workbench-test">
              <p>{finding.generatedTest.strategy}</p>
              <code>{finding.generatedTest.filename}</code>
              <pre>
                <code>{finding.generatedTest.code}</code>
              </pre>
              <p>
                Generated test source. Execution status is shown in the evidence
                panel.
              </p>
            </div>
          ) : file?.patch ? (
            <div
              className="workbench-diff"
              role="region"
              aria-label={`Unified diff for ${file.path}`}
              tabIndex={0}
            >
              <div className="workbench-diff-rows">
                {visibleRows.map((row, offset) => {
                  const index = pageStart + offset;
                  return (
                    <div
                      key={index}
                      ref={(element) => {
                        if (element) diffElements.current.set(index, element);
                        else diffElements.current.delete(index);
                      }}
                      className={cn(
                        "workbench-diff-row",
                        `workbench-diff-${row.kind}`,
                        matchSet.has(index) && "workbench-diff-match",
                        activeHunk >= 0 &&
                          hunks[activeHunk] === index &&
                          "workbench-diff-active-match",
                        matches.length > 0 &&
                          matches[matchIndex] === index &&
                          "workbench-diff-active-match",
                      )}
                    >
                      <span aria-hidden="true">{row.before ?? ""}</span>
                      <span aria-hidden="true">{row.after ?? ""}</span>
                      <code>{row.content || " "}</code>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="workbench-empty workbench-no-patch">
              <FileCode2 size={24} />
              <h3>No textual patch available</h3>
              <p>
                {file
                  ? "This file may be binary, too large, or outside the retrieved diff coverage."
                  : "The report does not contain any changed files."}
              </p>
            </div>
          )}
          <div className="workbench-editor-footer">
            <span>
              {file?.status ?? "No file"} ·{" "}
              {file?.patch
                ? file.lines.length < file.additions + file.deletions
                  ? "Partial patch"
                  : "Retrieved patch"
                : "No patch"}
            </span>
            <ReportTargetLink
              href={
                file
                  ? `#changed-file-${report.pr.files.indexOf(file)}`
                  : "#files"
              }
              onClick={() => {
                if (file)
                  openReportTarget(
                    `#changed-file-${report.pr.files.indexOf(file)}`,
                  );
              }}
            >
              All retrieved changes
              <ArrowDown size={12} />
            </ReportTargetLink>
          </div>
        </div>

        <aside
          className="workbench-inspector"
          aria-label="Related finding evidence"
          aria-live="polite"
        >
          <div className="workbench-pane-label">
            <ShieldCheck size={14} /> Evidence{" "}
            <span>
              {related.length} {related.length === 1 ? "finding" : "findings"}
            </span>
          </div>
          {finding ? (
            <div className="workbench-inspector-content">
              {related.length > 1 && (
                <label className="workbench-finding-select">
                  Related finding
                  <select
                    aria-label="Related finding"
                    value={finding.id}
                    onChange={(event) => {
                      setFindingId(event.target.value);
                      setView("diff");
                    }}
                  >
                    {related.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="workbench-finding-meta">
                <span
                  className={cn("risk-badge", finding.severity.toLowerCase())}
                >
                  {finding.severity} RISK
                </span>
                <span>{finding.riskScore} / 100</span>
              </div>
              <h3>{finding.title}</h3>
              <span className="workbench-saved-decision">
                Saved decision:{" "}
                {review
                  ? (
                      {
                        OPEN: "Needs review",
                        NEEDS_FIX: "Needs fix",
                        REVIEWED: "Reviewed",
                        DISMISSED: "Dismissed",
                      } as const
                    )[
                      (Object.hasOwn(review.findings, finding.id)
                        ? review.findings[finding.id]?.status
                        : undefined) ?? "OPEN"
                    ]
                  : reviewError
                    ? "Unavailable · retry in Your review"
                    : "Loading…"}
              </span>
              <p>{finding.behavioralChange}</p>
              <h4>Verification evidence</h4>
              {finding.evidence.length ? (
                [...finding.evidence]
                  .sort(
                    (a, b) =>
                      Number(b.status === "FAIL") - Number(a.status === "FAIL"),
                  )
                  .map((evidence, index) => (
                    <div
                      className="workbench-evidence"
                      key={`${evidence.id}-${index}`}
                    >
                      <div>
                        <span
                          className={cn(
                            "workbench-evidence-status",
                            evidence.status.toLowerCase(),
                          )}
                        >
                          {evidence.status.replaceAll("_", " ")}
                        </span>
                        <small>
                          {evidence.status === "NOT_RUN"
                            ? "Not executed"
                            : evidence.provenance === "DEMO_FIXTURE"
                              ? "Demo fixture"
                              : evidence.provenance === "STATIC"
                                ? "Diff inspection"
                                : "Executed"}
                        </small>
                      </div>
                      <p>{evidence.description}</p>
                      {evidence.output && (
                        <details>
                          <summary>View output</summary>
                          <pre>{evidence.output}</pre>
                        </details>
                      )}
                    </div>
                  ))
              ) : (
                <p>No execution evidence is available for this finding.</p>
              )}
              <ReportTargetLink
                className="text-link"
                href={`#${finding.id}`}
                onClick={() => {
                  onOpenFinding();
                  openReportTarget(`#${finding.id}`);
                }}
              >
                Full finding &amp; review <ArrowDown size={13} />
              </ReportTargetLink>
              {canReproduce && (
                <Link
                  className="button button-primary button-small"
                  href={`/report/${report.id}/reproduce/${finding.id}`}
                  prefetch={false}
                >
                  Reproduce &amp; repair <ArrowRight size={13} />
                </Link>
              )}
              <div className="workbench-provenance">
                {report.mode === "DEMO"
                  ? "Synthetic PR · executed checks use the bundled fixture. This does not verify a GitHub repository."
                  : "Risk hypotheses need review. Only evidence labeled executed comes from a test run."}
              </div>
            </div>
          ) : (
            <div className="workbench-inspector-content">
              <h3>No related findings</h3>
              <p>
                {file?.risk.reasons.join(" · ") ||
                  "No elevated deterministic risk signals were identified for this file."}
              </p>
              <p>
                Absence of findings does not establish safety. Inspect the patch
                and the report’s evidence gaps.
              </p>
              <ReportTargetLink className="text-link" href="#evidence-gaps">
                Inspect evidence gaps <ArrowDown size={13} />
              </ReportTargetLink>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
