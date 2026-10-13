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
  ScanLine,
  Terminal,
} from "lucide-react";
import { STAGES, type AgentEvent } from "@/lib/types";
import { completedStageCount } from "@/lib/agent/progress";
import { Button } from "@/components/ui/button";
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
    async function run() {
      try {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input, prNumber, demo }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Analysis could not start.");
        }
        const reader = response.body?.getReader();
        if (!reader)
          throw new Error("Streaming is unavailable. Please try again.");
        const decoder = new TextDecoder();
        let buffer = "",
          complete = false;
        while (true) {
          const { value, done } = await reader.read();
          buffer += done
            ? decoder.decode()
            : decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line) continue;
            const message = JSON.parse(line);
            if (message.type === "progress")
              setEvents((old) => [...old, message.event]);
            if (message.type === "error") throw new Error(message.error);
            if (message.type === "complete") {
              complete = true;
              router.replace(`/report/${message.id}`);
            }
          }
          if (done) break;
        }
        if (!complete)
          throw new Error(
            "The connection ended before the report was saved. Please retry.",
          );
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Analysis failed.");
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
        <div className="progress-emblem">
          <ScanLine size={32} />
        </div>
        <div className="overline">
          {demo || configuredDemo
            ? "DEMO INVESTIGATION"
            : "AUTONOMOUS INVESTIGATION"}
        </div>
        <h1>
          {error ? "Investigation interrupted" : "Following the evidence."}
        </h1>
        <p>
          {demo || configuredDemo
            ? "acme/platform #127 · Add password reset functionality"
            : `${input}${prNumber ? ` #${prNumber}` : ""}`}
        </p>
      </div>
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
                i < completed ? "done" : i === completed ? "current" : "pending"
              }
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
          <span>{events.at(-1)?.detail || "Preparing the investigation…"}</span>
        </div>
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
      <details className="logs-disclosure">
        <summary>
          View investigation log <span>{events.length} events</span>
        </summary>
        <div className="terminal-output">
          {events.map((e, i) => (
            <p key={i}>
              <span>{new Date(e.at).toLocaleTimeString()}</span>{" "}
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
