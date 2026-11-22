import { z } from "zod";
import { parseGitHubInput } from "@/lib/github/input";
import { analysisReportSchema } from "@/lib/reports/schema";
import { STAGES } from "@/lib/types";
import type { RunRecord } from "./run-schema";

const { owner, repo, number, title } = analysisReportSchema.shape.pr.shape;
const prMetadata = z.object({ owner, repo, number, title });
const settings = z.object({ demo: z.boolean() });

function requestedPr(run: RunRecord) {
  try {
    return parseGitHubInput(run.input.input, run.input.prNumber);
  } catch {
    return null;
  }
}

// Raw failure messages can contain upstream bodies, paths, or credentials.
// Expose known lifecycle diagnostics and summarize other failures by status.
function errorSummary(run: RunRecord, stale: boolean) {
  if (stale) return "The run stopped before completion.";
  if (!run.error) return "";
  if (run.status === "PAUSED") return "Analysis paused.";
  const known = [
    "This attempt reached its time limit.",
    "Repository or pull request not found.",
    "GitHub API rate limit reached.",
    "GitHub rejected the configured token.",
    "GitHub refused access to this repository.",
    "The PR changed during retrieval.",
  ].find((message) => run.error.startsWith(message));
  if (known) return known;
  return "Analysis was interrupted before completion.";
}

export function summarizeRun(run: RunRecord, active: boolean) {
  if (run.status === "COMPLETE") return null;
  const saved = run.checkpoint.values;
  const demo = settings.safeParse(saved.settings).data?.demo ?? run.input.demo;
  const pr = prMetadata.safeParse(saved.pullRequest).data;
  const ref =
    pr ??
    (demo
      ? { owner: "acme", repo: "platform", number: 127 }
      : requestedPr(run));
  const stale = run.status === "RUNNING" && !active;
  return {
    runId: run.id,
    repository: ref ? `${ref.owner}/${ref.repo}` : null,
    prNumber: ref?.number ?? null,
    title:
      pr?.title
        .replace(/[\p{Cc}\p{Cf}\s]+/gu, " ")
        .trim()
        .slice(0, 200) || null,
    mode: demo === undefined ? "UNKNOWN" : demo ? "DEMO" : "LIVE",
    status: stale ? ("INTERRUPTED" as const) : run.status,
    stage: (run.events.at(-1)?.stage ?? -1) + 1,
    totalStages: STAGES.length,
    startedAt: run.createdAt,
    updatedAt: run.updatedAt,
    error: errorSummary(run, stale),
  };
}
export type UnfinishedRun = NonNullable<ReturnType<typeof summarizeRun>>;
export type UnfinishedRuns = { runs: UnfinishedRun[]; unreadable: string[] };
