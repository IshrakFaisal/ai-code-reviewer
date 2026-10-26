"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  FlaskConical,
  GitCompareArrows,
  LoaderCircle,
  Square,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { reproductionBundle } from "@/lib/regression/bundle";
import { readJsonLines, responseError, streamError } from "@/lib/streaming";
import {
  regressionMessageSchema,
  matchesRegressionScope,
} from "@/lib/regression/schema";
import { comparisonExplanation } from "@/lib/regression/comparison";
import { AssertionComparison } from "./assertion-comparison";
import type { AnalysisReport, Finding } from "@/lib/types";
import {
  verdictLabels,
  type RegressionResult,
  type RevisionResult,
} from "@/lib/regression/types";

function save(name: string, content: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
function RevisionColumn({
  label,
  result,
}: {
  label: string;
  result?: RevisionResult;
}) {
  return (
    <article className="reproduction-revision">
      <h3>{label}</h3>
      <code className="revision-sha">{result?.revision || "Not run"}</code>
      {result?.runs.length ? (
        <div className="repeat-results">
          {result.runs.map((run, index) => (
            <div key={index}>
              <span>Run {index + 1}</span>
              <strong
                className={
                  run.status === "PASS"
                    ? "green"
                    : run.status === "FAIL"
                      ? "red"
                      : "amber"
                }
              >
                {run.status}
              </strong>
              <small>
                {run.durationMs < 1000
                  ? `${run.durationMs} ms`
                  : `${(run.durationMs / 1000).toFixed(1)} s`}
              </small>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">
          {result ? "No completed assertions recorded" : "Awaiting execution"}
        </p>
      )}
      {result?.error && <p className="reproduction-error">{result.error}</p>}
      {result?.runs.map((run, index) => (
        <details className="reproduction-output" key={index}>
          <summary>Assertions & output · run {index + 1}</summary>
          {run.assertions.map((a) => (
            <p key={a.name}>
              <strong>{a.status}</strong> {a.name}
            </p>
          ))}
          <pre className="code-block">{run.output}</pre>
        </details>
      ))}
      {result?.environmentHash && (
        <details className="reproduction-output">
          <summary>Environment fingerprint</summary>
          <code className="revision-sha">{result.environmentHash}</code>
        </details>
      )}
    </article>
  );
}
export function ReproductionView({
  report,
  finding,
  initial,
  initialNotice,
  supported,
  executionReady,
  aiReady,
}: {
  report: AnalysisReport;
  finding: Finding;
  initial: RegressionResult | null;
  initialNotice?: string;
  supported: boolean;
  executionReady: boolean;
  aiReady: boolean;
}) {
  const [result, setResult] = useState(initial);
  const [busy, setBusy] = useState<"reproduce" | "repair" | null>(null);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState("");
  const [events, setEvents] = useState<{ label: string; at: string }[]>(
    initial?.events || [],
  );
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const demo = report.mode === "DEMO";
  async function execute(action: "reproduce" | "repair") {
    if (active.current) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(310000),
    ]);
    active.current = controller;
    setBusy(action);
    setPhase(
      action === "repair"
        ? "Starting repair investigation…"
        : "Starting base/head comparison…",
    );
    setError("");
    setEvents(action === "repair" ? result?.events || [] : []);
    try {
      const response = await fetch(
        `/api/reports/${report.id}/regressions/${finding.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
          signal,
        },
      );
      if (!response.ok) {
        throw await responseError(response, "Execution could not start.");
      }
      let completed = false;
      for await (const raw of readJsonLines(response, { signal })) {
        const parsed = regressionMessageSchema.safeParse(raw);
        if (!parsed.success)
          throw new Error(
            "The server sent unexpected execution evidence. Reload to check the latest saved result before retrying.",
          );
        const event = parsed.data;
        if (event.type === "progress") {
          setPhase(event.label);
          setEvents((previous) => [
            ...previous,
            { label: event.label, at: event.at },
          ]);
        }
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "complete") {
          if (!matchesRegressionScope(event.result, report, finding))
            throw new Error(
              "The returned evidence belongs to a different finding, test, or revision. Reload this page before retrying.",
            );
          setResult(event.result);
          setEvents(event.result.events);
          completed = true;
          break;
        }
      }
      if (!completed)
        throw new Error(
          "The connection ended before completion could be confirmed. Reload to check the latest saved result before retrying.",
        );
    } catch (cause) {
      setError(
        controller.signal.aborted
          ? "Execution cancelled. Reload to check the latest saved result."
          : streamError(cause, "Execution failed."),
      );
    } finally {
      controller.abort();
      active.current = null;
      setBusy(null);
    }
  }
  const repairReady =
    result?.verdict === "REGRESSION_REPRODUCED" &&
    (demo || aiReady) &&
    executionReady;
  const explanation = result ? comparisonExplanation(result) : null;
  return (
    <div className="page reproduction-page">
      <Link href={`/report/${report.id}#${finding.id}`} className="text-link">
        <ArrowLeft size={14} />
        Back to finding
      </Link>
      <header className="reproduction-heading">
        <div>
          <div className="page-eyebrow">
            {demo
              ? "Bundled fixture walkthrough"
              : "Behavioral regression investigation"}
          </div>
          <h1>Reproduce. Repair. Recheck.</h1>
          <p>{finding.title}</p>
          <div className="reproduction-scope">
            {report.pr.owner}/{report.pr.repo} · PR #{report.pr.number}
            <span className={demo ? "mode-badge" : "live-badge"}>
              {demo ? "DEMO FIXTURE" : "LIVE REPOSITORY"}
            </span>
          </div>
        </div>
        <GitCompareArrows size={29} strokeWidth={1.4} />
      </header>
      <div className="reproduction-explainer">
        <strong>
          {demo
            ? "Real assertion execution against synthetic fixture variants"
            : "The same test, at two exact commits"}
        </strong>
        <p>
          {demo
            ? "Explore a curated base → failing head → repaired fixture. This walkthrough uses trusted Node assertions and a bundled repair; it does not verify GitHub code or call a model."
            : "Run the generated Vitest test twice in each isolated checkout. Matching assertions and environment fingerprints are required. A reproducible pass at base and assertion failure at head supports a regression finding, subject to test validity review."}
        </p>
      </div>
      {initialNotice && !result && (
        <div className="saved-evidence-notice" role="status">
          {initialNotice}
        </div>
      )}
      {result && (
        <p className="reproduction-saved-state" role="status">
          {busy
            ? "Showing the previous saved result while a new investigation runs."
            : "Saved evidence"}{" "}
          ·{" "}
          {new Date(result.createdAt)
            .toISOString()
            .replace("T", " ")
            .slice(0, 19)}{" "}
          UTC
        </p>
      )}
      <section className="reproduction-actions" aria-label="Execution controls">
        <div>
          <h2>1. Reproduce the change</h2>
          <p>
            {demo
              ? "No credentials or sandbox service required."
              : "Requires Vitest 3.2+ or 4 and an enabled, allowlisted Docker or Nebius sandbox. Remote execution may be billable."}
          </p>
          {!supported && (
            <p className="amber">
              This finding has no supported test for this workflow.
            </p>
          )}
          {!executionReady && (
            <p className="amber">
              Configure repository execution in{" "}
              <Link href="/settings">Settings & integrations</Link> before
              running.
            </p>
          )}
        </div>
        <Button
          onClick={() => execute("reproduce")}
          disabled={!!busy || !supported || !executionReady}
        >
          {busy === "reproduce" ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <FlaskConical size={15} />
          )}{" "}
          {result ? "Run comparison again" : "Run base/head comparison"}
        </Button>
      </section>
      {error && (
        <div role="alert" className="reproduction-error">
          {error}
        </div>
      )}
      {busy && (
        <div role="status" className="reproduction-running">
          <LoaderCircle size={16} className="spin" />
          <span>{phase}</span>
          <Button variant="outline" onClick={() => active.current?.abort()}>
            <Square size={12} />
            Cancel
          </Button>
        </div>
      )}
      <section
        className="reproduction-results"
        aria-labelledby="comparison-heading"
      >
        <div className="section-heading">
          <div>
            <h2 id="comparison-heading">Execution comparison</h2>
            <p>
              {result
                ? verdictLabels[result.verdict]
                : "Results will appear after execution."}
            </p>
          </div>
          {result && (
            <span
              className={
                result.verdict === "REGRESSION_REPRODUCED"
                  ? "risk-badge high"
                  : "configuration-badge"
              }
            >
              {result.verdict === "REGRESSION_REPRODUCED"
                ? "Assertion difference reproduced"
                : "Recorded evidence"}
            </span>
          )}
        </div>
        {explanation && (
          <div className="comparison-explanation">
            <p>
              <strong>{explanation.reason}</strong>
            </p>
            <p>{explanation.next}</p>
          </div>
        )}
        <div className="reproduction-grid">
          <RevisionColumn
            label={demo ? "Original fixture" : "Base commit"}
            result={result?.base}
          />
          <RevisionColumn
            label={demo ? "Changed fixture" : "PR head commit"}
            result={result?.head}
          />
          {result?.repair && (
            <RevisionColumn
              label={demo ? "Repaired fixture" : "Head + proposed repair"}
              result={result.repair.result}
            />
          )}
        </div>
        {result && <AssertionComparison result={result} />}
      </section>
      <section className="reproduction-actions" aria-label="Repair controls">
        <div>
          <h2>2. Propose a repair and recheck</h2>
          <p>
            {demo
              ? "Apply the curated repair to the bundled fixture and execute the same assertion twice."
              : "Ask the configured Nebius model for one bounded source repair, then rerun the unchanged test and repository checks. Inference and remote execution may be billable. Nothing is committed or posted to GitHub."}
          </p>
          {!demo && !aiReady && (
            <p className="amber">
              Configure Nebius inference in{" "}
              <Link href="/settings">Settings & integrations</Link> to request a
              repair.
            </p>
          )}
          {!repairReady &&
            (!result || result.verdict !== "REGRESSION_REPRODUCED") && (
              <p className="repair-requirement">
                First reproduce a stable base-pass/head-fail result to enable a
                repair investigation.
              </p>
            )}
        </div>
        <Button
          variant="outline"
          onClick={() => execute("repair")}
          disabled={!!busy || !repairReady}
        >
          {busy === "repair" ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Wrench size={15} />
          )}{" "}
          {demo ? "Run fixture repair" : "Propose repair & recheck"}
        </Button>
      </section>
      {result?.repair && (
        <section className="settings-section">
          <div className="section-heading">
            <div>
              <h2>Repair outcome</h2>
              <p>
                {result.repair.status === "VALIDATED_FOR_TEST"
                  ? demo
                    ? "The curated fixture repair passed the same assertion twice. No repository checks were run."
                    : "Passed the recorded test and required checks within this scope. Review before applying."
                  : result.repair.status === "CHECKS_FAILED"
                    ? "One or more checks failed. The proposal is not validated."
                    : "The repair could not be validated conclusively."}
              </p>
            </div>
          </div>
          <p className="muted">{result.repair.provider}</p>
          {result.repair.error && (
            <p className="reproduction-error">{result.repair.error}</p>
          )}
          {result.repair.proposal && (
            <>
              <p>{result.repair.proposal.explanation}</p>
              {result.repair.proposal.files.map((file) => (
                <details className="reproduction-output" key={file.path}>
                  <summary>{file.path} · review proposed source</summary>
                  <h3>Original</h3>
                  <pre className="code-block">{file.before}</pre>
                  <h3>Proposed</h3>
                  <pre className="code-block">{file.after}</pre>
                </details>
              ))}
            </>
          )}
          {result.repair.result?.checks.length ? (
            <table className="reproduction-checks">
              <thead>
                <tr>
                  <th>Repository check</th>
                  <th>Outcome</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {result.repair.result.checks.map((check) => (
                  <tr key={check.name}>
                    <td>{check.name}</td>
                    <td>{check.status}</td>
                    <td>
                      <details>
                        <summary>View output</summary>
                        <pre className="code-block">{check.output}</pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            demo && (
              <p className="muted">
                The fixture has no application build, typecheck, or repository
                test suite. Its passing assertion is fixture evidence only.
              </p>
            )
          )}
        </section>
      )}
      {result && (
        <section className="settings-section">
          <div className="section-heading">
            <div>
              <h2>Reproduce independently</h2>
              <p>
                Export the unchanged test, exact scope, environment
                fingerprints, logs, and any proposed source changes.
              </p>
            </div>
          </div>
          <div className="reproduction-downloads">
            <Button
              variant="outline"
              onClick={() =>
                save(
                  `regression-${report.pr.number}-${finding.id}.json`,
                  JSON.stringify(
                    reproductionBundle(result, report.pr),
                    null,
                    2,
                  ),
                  "application/json",
                )
              }
            >
              <Download size={14} />
              Evidence bundle (JSON)
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                save(
                  "REPRODUCE.md",
                  reproductionBundle(result, report.pr).files["README.md"],
                )
              }
            >
              <Download size={14} />
              Reproduction instructions
            </Button>
            <Button
              variant="outline"
              onClick={() => save(result.test.filename, result.test.code)}
            >
              <Download size={14} />
              Unchanged test
            </Button>
            {result.repair?.proposal && (
              <Button
                variant="outline"
                onClick={async () => {
                  const { repairDiff } = await import("@/lib/regression/patch");
                  save(
                    "proposed-repair.diff",
                    repairDiff(result.repair!.proposal!),
                  );
                }}
              >
                <Download size={14} />
                Proposed patch
              </Button>
            )}
          </div>
          <details className="reproduction-output">
            <summary>Test source & SHA-256</summary>
            <code className="revision-sha">{result.test.sha256}</code>
            <pre className="code-block">{result.test.code}</pre>
          </details>
          <ul className="reproduction-limits">
            {result.limitations.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </section>
      )}
      {!!events.length && (
        <section className="settings-section">
          <div className="section-heading">
            <h2>Investigation activity</h2>
          </div>
          <ol className="reproduction-events">
            {events.map((event, index) => (
              <li key={`${index}-${event.at}`}>
                <time dateTime={event.at}>
                  {new Date(event.at).toISOString().slice(11, 19)} UTC
                </time>
                <span>{event.label}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
      <Link href="/how-it-works#execution" className="text-link">
        Understand execution and evidence limits
        <ArrowRight size={14} />
      </Link>
    </div>
  );
}
