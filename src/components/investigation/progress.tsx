"use client";
import { useEffect, useState } from "react";
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
import { readJsonLines, responseError, streamError } from "@/lib/streaming";
import { analysisMessageSchema } from "@/lib/agent/messages";
export function Progress({
  input,
  prNumber,
  demo,
  configuredDemo,
}: {
  input: string;
  prNumber?: number;
  demo: boolean;
  configuredDemo: boolean;
}) {
  const router = useRouter();
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(310000),
    ]);
    async function run() {
      try {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input, prNumber, demo }),
          signal,
        });
        if (!response.ok) {
          throw await responseError(response, "Analysis could not start.");
        }
        let complete = false;
        for await (const raw of readJsonLines(response, { signal })) {
          const parsed = analysisMessageSchema.safeParse(raw);
          if (!parsed.success)
            throw new Error(
              "The server sent an unexpected analysis update. Please retry.",
            );
          const message = parsed.data;
          if (message.type === "progress")
            setEvents((old) => [...old, message.event]);
          if (message.type === "error") throw new Error(message.error);
          if (message.type === "complete") {
            complete = true;
            router.replace(`/report/${message.id}`);
            break;
          }
        }
        if (!complete)
          throw new Error(
            "The connection ended before the report was saved. Please retry.",
          );
      } catch (e) {
        if (!controller.signal.aborted)
          setError(streamError(e, "Analysis failed."));
      } finally {
        controller.abort();
      }
    }
    void run();
    return () => controller.abort();
  }, [input, prNumber, demo, attempt, router]);
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
            : `${input}${prNumber ? ` #${prNumber}` : ""}`}
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
                  setEvents([]);
                  setError("");
                  setAttempt((a) => a + 1);
                }}
              >
                Retry analysis
              </Button>
              <Button asChild size="small" variant="outline">
                <Link href="/analyze?demo=true">Run demo instead</Link>
              </Button>
            </div>
          </div>
        </div>
      )}
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
              ? "Investigation stopped. Your next action is shown above."
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
