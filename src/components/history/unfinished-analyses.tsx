"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { requestRun } from "@/lib/agent/run-client";
import type { UnfinishedRun, UnfinishedRuns } from "@/lib/agent/run-summary";

type Action = "resume" | "discard";

export function UnfinishedRunRow({
  run,
  busy,
  onAction,
}: {
  run: UnfinishedRun;
  busy: boolean;
  onAction: (work: () => Promise<void>, action: Action, runId: string) => void;
}) {
  const id = run.runId;
  const running = run.status === "RUNNING";
  function resume() {
    onAction(
      async () => {
        await requestRun(`/api/analyze/${id}`, id, { method: "POST" });
      },
      "resume",
      id,
    );
  }
  function discard() {
    if (
      !window.confirm(
        `Discard the saved checkpoint for ${run.repository ?? "this analysis"}? This run cannot be resumed afterward.`,
      )
    )
      return;
    onAction(
      async () => {
        const response = await fetch(`/api/runs/${id}/discard`, {
          method: "POST",
        });
        if (!response.ok)
          throw new Error(
            response.status === 409
              ? "The analysis is running. Pause it before discarding."
              : "The checkpoint could not be discarded.",
          );
      },
      "discard",
      id,
    );
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b py-3">
      <div className="min-w-0">
        <strong>
          {run.repository ?? "Repository pending"}
          {run.prNumber !== null && ` #${run.prNumber}`}
        </strong>
        <p className="break-words">
          {run.title ?? "Pull request title pending"}
        </p>
        <span className="mini-badge">{run.status}</span>{" "}
        <span className="small-note">
          Stage {run.stage} of {run.totalStages} · Updated{" "}
          <time dateTime={run.updatedAt}>
            {new Date(run.updatedAt)
              .toISOString()
              .replace("T", " ")
              .slice(0, 19)}{" "}
            UTC
          </time>
        </span>
        {run.error && <p className="small-note">{run.error}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="small" variant="outline">
          <Link href={`/analyze?run=${id}`}>Open</Link>
        </Button>
        {!running && (
          <Button size="small" disabled={busy} onClick={resume}>
            Resume
          </Button>
        )}
        <Button
          size="small"
          variant="ghost"
          disabled={running || busy}
          onClick={discard}
        >
          Discard
        </Button>
      </div>
    </li>
  );
}

export function UnfinishedAnalyses({ initial }: { initial: UnfinishedRuns }) {
  const router = useRouter();
  const [listing, setListing] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [pollError, setPollError] = useState(false);
  useEffect(() => {
    if (busy || !listing.runs.some((run) => run.status === "RUNNING")) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch("/api/runs", {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
        });
        if (!response.ok) throw new Error();
        const next: UnfinishedRuns = await response.json();
        if (controller.signal.aborted) return;
        setListing(next);
        setPollError(false);
        // A finished run can now appear in the server-rendered report history.
        if (
          listing.runs.some(
            (old) => !next.runs.some((run) => run.runId === old.runId),
          )
        )
          router.refresh();
      } catch {
        if (!controller.signal.aborted) {
          setPollError(true);
          timer = setTimeout(poll, 3000);
        }
      }
    }
    timer = setTimeout(poll, 3000);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [listing, busy, router]);
  async function act(work: () => Promise<void>, action: Action, id: string) {
    setBusy(true);
    setActionError("");
    try {
      await work();
      if (action === "resume") router.push(`/analyze?run=${id}`);
      else {
        setListing((old) => ({
          ...old,
          runs: old.runs.filter((run) => run.runId !== id),
        }));
        router.refresh();
      }
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Could not update the run.",
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  if (!listing.runs.length && !listing.unreadable.length) return null;
  return (
    <section className="panel p-4 mb-4" aria-labelledby="unfinished-heading">
      <h2 id="unfinished-heading">Unfinished analyses</h2>
      {listing.unreadable.length > 0 && (
        <p role="status">Unreadable checkpoints: {listing.unreadable.length}</p>
      )}
      {pollError && (
        <p role="status">Run status could not be refreshed. Retrying…</p>
      )}
      {actionError && <p role="alert">{actionError}</p>}
      <ul>
        {listing.runs.map((run) => (
          <UnfinishedRunRow
            key={run.runId}
            run={run}
            busy={busy}
            onAction={act}
          />
        ))}
      </ul>
    </section>
  );
}
