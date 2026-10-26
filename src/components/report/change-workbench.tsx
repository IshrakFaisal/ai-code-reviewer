"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  FileCode2,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { AnalysisReport } from "@/lib/types";
import { diffRows } from "@/lib/reports/diff";
import { cn } from "@/lib/utils";

export function ChangeWorkbench({
  report,
  onOpenFinding,
}: {
  report: AnalysisReport;
  onOpenFinding: () => void;
}) {
  const files = useMemo(
    () => [...report.pr.files].sort((a, b) => b.risk.score - a.risk.score),
    [report.pr.files],
  );
  const [path, setPath] = useState(files[0]?.path ?? "");
  const [query, setQuery] = useState("");
  const [findingId, setFindingId] = useState("");
  const [view, setView] = useState<"diff" | "test">("diff");
  const file = files.find((item) => item.path === path);
  const related = report.findings
    .filter((item) => item.affectedFiles.some((ref) => ref.path === path))
    .sort((a, b) => b.riskScore - a.riskScore);
  const finding = related.find((item) => item.id === findingId) ?? related[0];
  const shown = files.filter((item) =>
    item.path.toLowerCase().includes(query.toLowerCase()),
  );
  const rows = useMemo(() => diffRows(file?.patch ?? ""), [file?.patch]);
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
          <div
            className="workbench-file-list"
            role="group"
            aria-label="Workbench changed files"
          >
            {shown.map((item) => (
              <button
                key={item.path}
                type="button"
                aria-pressed={path === item.path}
                className={cn(
                  "workbench-file",
                  path === item.path && "selected",
                )}
                onClick={() => {
                  setPath(item.path);
                  setFindingId("");
                  setView("diff");
                }}
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
                  ? "No matching files. Try another name."
                  : "No changed files were retrieved."}
              </p>
            )}
          </div>
          <div className="workbench-explorer-note">
            Ordered by risk score. Select a file to inspect its evidence.
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
                {rows.slice(0, 500).map((row, index) => (
                  <div
                    key={index}
                    className={cn(
                      "workbench-diff-row",
                      `workbench-diff-${row.kind}`,
                    )}
                  >
                    <span aria-hidden="true">{row.before ?? ""}</span>
                    <span aria-hidden="true">{row.after ?? ""}</span>
                    <code>{row.content || " "}</code>
                  </div>
                ))}
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
            <a href="#files">
              {rows.length > 500
                ? "Preview limited to 500 lines · All retrieved changes"
                : "All retrieved changes"}
              <ArrowDown size={12} />
            </a>
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
              <a
                className="text-link"
                href={`#${finding.id}`}
                onClick={onOpenFinding}
              >
                Full finding &amp; review <ArrowDown size={13} />
              </a>
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
              <a className="text-link" href="#evidence-gaps">
                Inspect evidence gaps <ArrowDown size={13} />
              </a>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
