"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Circle,
  LoaderCircle,
  Terminal,
} from "lucide-react";
import { STAGES, type AgentEvent } from "@/lib/types";
import { completedStageCount } from "@/lib/agent/progress";
import { Button } from "@/components/ui/button";
import { streamError } from "@/lib/streaming";
import { requestRun, waitForRun } from "@/lib/agent/run-client";
import { runIdSchema, type RunSnapshot } from "@/lib/agent/run-schema";
export function Progress({
  input,
  prNumber,
  demo,
  configuredDemo,
  initialRunId,
}: {
  input: string;
  prNumber?: number;
  demo: boolean;
  configuredDemo: boolean;
  initialRunId?: string;
}) {
  const router = useRouter();
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const runId = useRef(initialRunId);
  const resume = useRef(false);
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [pausing, setPausing] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    async function run() {
      try {
        const reconnect = !!runId.current;
        const id = runId.current ?? crypto.randomUUID();
        if (!runIdSchema.safeParse(id).success)
          throw new Error("Invalid saved run address. Start a new analysis.");
        runId.current = id;
        const url = new URL(window.location.href);
        url.searchParams.set("run", id);
        window.history.replaceState(null, "", url);
        const shouldResume = resume.current;
        resume.current = false;
        const start = () =>
          requestRun("/api/analyze", id, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ input, prNumber, demo, runId: id }),
            signal,
          });
        let state: RunSnapshot;
        if (shouldResume)
          state = await requestRun(`/api/analyze/${id}`, id, {
            method: "POST",
            signal,
          });
        else if (reconnect) {
          try {
            state = await requestRun(`/api/analyze/${id}`, id, { signal });
          } catch (failure) {
            if (
              (failure as { status?: number }).status !== 404 ||
              (!url.searchParams.has("input") && !url.searchParams.has("demo"))
            )
              throw failure;
            state = await start();
          }
        } else state = await start();
        while (!signal.aborted) {
          setSnapshot(state);
          setEvents(state.events);
          if (state.status === "COMPLETE") {
            router.replace(`/report/${state.reportId}`);
            return;
          }
          if (state.status !== "RUNNING") {
            setPausing(false);
            setError(state.error);
            return;
          }
          await waitForRun(signal);
          state = await requestRun(`/api/analyze/${id}`, id, { signal });
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(streamError(e, "Analysis failed."));
      }
    }
    void run();
    return () => controller.abort();
  }, [input, prNumber, demo, attempt, router]);
  async function pause() {
    if (!runId.current) return;
    setPausing(true);
    try {
      await requestRun(`/api/analyze/${runId.current}`, runId.current, {
        method: "DELETE",
      });
    } catch (failure) {
      setPausing(false);
      setError(
        streamError(
          failure,
          "Pause could not be confirmed. Reconnect to check this run.",
        ),
      );
    }
  }
  const completed = completedStageCount(events);
  return (
    <div className="page progress-page">
      <Link href="/" className="text-link">
        <ArrowLeft size={15} />
        Back to workspace
      </Link>
      <div className="progress-title">
        <div className="overline">
          {demo || configuredDemo
            ? "DEMO INVESTIGATION"
            : "AUTONOMOUS INVESTIGATION"}
        </div>
        <h1>{error ? "Investigation interrupted" : "Analyzing the change"}</h1>
        <p>
          {demo || configuredDemo
            ? "acme/platform #127 · Add password reset functionality"
            : `${snapshot?.input.input ?? input}${(snapshot?.input.prNumber ?? prNumber) ? ` #${snapshot?.input.prNumber ?? prNumber}` : ""}`}
        </p>
      </div>
      {error && (
        <div className="error-panel" role="alert">
          <AlertCircle size={21} />
          <div>
            <strong>{error}</strong>
            <div className="error-actions">
              <Button
                size="small"
                onClick={() => {
                  resume.current =
                    snapshot?.status === "PAUSED" ||
                    snapshot?.status === "INTERRUPTED";
                  setError("");
                  setAttempt((a) => a + 1);
                }}
              >
                {snapshot?.status === "PAUSED" ||
                snapshot?.status === "INTERRUPTED"
                  ? "Resume analysis"
                  : "Reconnect to run"}
              </Button>
              <Button
                size="small"
                variant="outline"
                onClick={() => {
                  runId.current = undefined;
                  resume.current = false;
                  setSnapshot(null);
                  setEvents([]);
                  setError("");
                  setPausing(false);
                  setAttempt((value) => value + 1);
                }}
              >
                Start new analysis
              </Button>
              <Button asChild size="small" variant="outline">
                <Link href="/analyze?demo=true">Run demo instead</Link>
              </Button>
            </div>
          </div>
        </div>
      )}
      {!error && snapshot?.status === "RUNNING" && (
        <Button
          variant="outline"
          size="small"
          onClick={pause}
          disabled={pausing}
        >
          {pausing ? "Pausing…" : "Pause analysis"}
        </Button>
      )}
      <p className="progress-footnote">
        Progress is saved on this server. Refresh or return to this run’s
        address to reconnect. Resuming an interrupted verification recreates its
        sandbox at the recorded commit.
      </p>
      <div className="progress-card">
        <div className="progress-card-head">
          <span>
            {error
              ? "Action needed"
              : completed === STAGES.length
                ? "Finalizing report"
                : "Investigation in progress"}
          </span>
          <span className="mono">
            {Math.round((completed / STAGES.length) * 100)}%
          </span>
        </div>
        <div
          className="progress-track"
          role="progressbar"
          aria-label="Analysis progress"
          aria-valuenow={completed}
          aria-valuemin={0}
          aria-valuemax={STAGES.length}
        >
          <i style={{ width: `${(completed / STAGES.length) * 100}%` }} />
        </div>
        <ol className="stage-list">
          {STAGES.map((label, i) => (
            <li
              key={label}
              className={
                i < completed
                  ? "done"
                  : i === completed
                    ? error
                      ? "interrupted"
                      : "current"
                    : "pending"
              }
              aria-current={i === completed ? "step" : undefined}
            >
              {i < completed ? (
                <Check size={17} />
              ) : i === completed && !error ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <Circle size={14} />
              )}
              <span>{label}</span>
              {i < completed && <small>COMPLETE</small>}
            </li>
          ))}
        </ol>
        <div className="live-action" aria-live="polite">
          <Terminal size={16} />
          <span>
            {error
              ? "Saved progress is kept. Reconnect or resume using the controls above."
              : events.at(-1)?.detail || "Preparing the investigation…"}
          </span>
        </div>
      </div>
      <details className="logs-disclosure">
        <summary>
          View investigation log <span>{events.length} events</span>
        </summary>
        <div className="terminal-output">
          {events.map((e, i) => (
            <p key={i}>
              <span>{new Date(e.at).toISOString().slice(11, 19)} UTC</span>{" "}
              {e.phase && `[${e.phase}] `}
              {e.detail}
            </p>
          ))}
        </div>
      </details>
      <p className="progress-footnote">
        {demo || configuredDemo
          ? "Synthetic PR · Real execution against a bundled fixture · No external APIs"
          : "Bounded investigations · No repository code executed without an enabled provider"}
      </p>
    </div>
  );
}
