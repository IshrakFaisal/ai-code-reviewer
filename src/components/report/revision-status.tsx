"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, GitBranch, LoaderCircle, RefreshCw } from "lucide-react";
import type { AnalysisReport } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  revisionChanges,
  revisionCheckExpired,
  revisionCheckSchema,
  revisionCheckCooldown,
  revisionMatchesReport,
  revisionRetryDelay,
  type RevisionCheck,
} from "@/lib/reports/freshness";
import { reanalysisHref } from "@/lib/reports/history";
import { responseError } from "@/lib/streaming";

export function RevisionStatus({
  report,
  check,
  onChange,
}: {
  report: AnalysisReport;
  check: RevisionCheck | null;
  onChange: (value: RevisionCheck | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now);
  const [retryAt, setRetryAt] = useState(0);
  const expired = !!check && revisionCheckExpired(check, now);
  const retrySeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const controller = useRef<AbortController | null>(null);
  const running = useRef(false);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!check && !retryAt) return;
    const timer = setInterval(
      () => {
        const current = Date.now();
        setNow(current);
        if (retryAt && current >= retryAt) setRetryAt(0);
      },
      retryAt ? 1000 : 15000,
    );
    return () => clearInterval(timer);
  }, [check, retryAt]);

  async function run() {
    if (running.current || Date.now() < retryAt) return;
    running.current = true;
    setBusy(true);
    setError("");
    const started = Date.now();
    setNow(started);
    setRetryAt(started + revisionCheckCooldown);
    onChange(null);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const response = await fetch(
        `/api/reports/${encodeURIComponent(report.id)}/revision`,
        {
          method: "POST",
          cache: "no-store",
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]),
        },
      );
      if (!response.ok) {
        if (response.status === 429 && !abort.signal.aborted) {
          const received = Date.now();
          setNow(received);
          setRetryAt(
            received +
              revisionRetryDelay(response.headers.get("Retry-After"), received),
          );
        }
        throw await responseError(
          response,
          "The GitHub revision could not be checked",
        );
      }
      const result = revisionCheckSchema.parse(await response.json());
      if (!revisionMatchesReport(result, report))
        throw new Error(
          "Revision response does not match this report. Reload before checking again.",
        );
      if (revisionCheckExpired(result))
        throw new Error(
          "The server returned an expired revision snapshot. Check the server clock, then retry.",
        );
      if (!abort.signal.aborted) {
        setNow(Date.now());
        onChange(result);
      }
    } catch (failure) {
      if (!abort.signal.aborted)
        setError(
          failure instanceof Error && failure.name === "TimeoutError"
            ? "The revision check took too long. Check the server connection and retry."
            : failure instanceof Error && failure.name !== "ZodError"
              ? failure.message
              : "The revision response was incomplete. Try again.",
        );
    } finally {
      running.current = false;
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  const changed = check ? revisionChanges(check) : null;
  const moved = !!(changed?.base || changed?.head);
  return (
    <section
      id="revision-status"
      className="revision-status"
      aria-labelledby="revision-status-heading"
    >
      <GitBranch size={19} />
      <div className="revision-status-body">
        <h2 id="revision-status-heading">
          {report.mode === "DEMO"
            ? "Synthetic revision scope"
            : moved
              ? "PR revision has changed"
              : check && !expired
                ? "Recorded commits still match"
                : "Is this report still current?"}
        </h2>
        <p>
          {report.mode === "DEMO"
            ? "Demo commit IDs are illustrative. Revision checks are available on live GitHub reports."
            : moved
              ? `The ${changed?.head && changed.base ? "base and head commits have" : changed?.head ? "head commit has" : "base commit has"} moved since this analysis. Run a new analysis before using this report for the current change.`
              : check && !expired
                ? "GitHub returned the same base and head commits at the time checked. This is a revision check, not a verification or merge verdict."
                : expired
                  ? "The last check is over five minutes old. Check again for a current snapshot."
                  : "Check GitHub for new commits, base changes, and the PR’s open, closed, or merged state."}
        </p>
        {check && (
          <div className="revision-details">
            <span>
              {check.state.toLowerCase()}
              {check.draft ? " · draft" : ""}
            </span>
            <span>Checked {new Date(check.checkedAt).toLocaleString()}</span>
            {moved && (
              <code>
                Base {check.currentBase.slice(0, 7)} · Head{" "}
                {check.currentHead.slice(0, 7)}
              </code>
            )}
          </div>
        )}
        {busy && (
          <p className="subtle" role="status">
            Checking public GitHub metadata…
          </p>
        )}
        {error && (
          <p className="revision-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {report.mode === "LIVE" && (
        <div className="revision-actions">
          <Button
            variant="outline"
            size="small"
            onClick={run}
            disabled={busy || retrySeconds > 0}
          >
            {busy ? (
              <LoaderCircle className="spin" size={13} />
            ) : (
              <RefreshCw size={13} />
            )}
            {busy
              ? "Checking…"
              : retrySeconds > 0
                ? `Check again in ${retrySeconds}s`
                : check || error
                  ? "Check again"
                  : "Check GitHub revision"}
          </Button>
          {moved && (
            <Link className="text-link" href={reanalysisHref(report)}>
              Analyze latest revision <ArrowRight size={13} />
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
