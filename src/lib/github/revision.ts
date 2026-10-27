import { githubClient, githubError } from "./client";
import { parseGitHubInput } from "./input";
import {
  revisionCheckSchema,
  type RevisionCheck,
} from "@/lib/reports/freshness";
import type { AnalysisReport } from "@/lib/types";
import { z } from "zod";

const upstreamRevision = z.object({
  base: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }),
  head: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }),
  state: z.enum(["open", "closed"]),
  merged: z.boolean(),
  draft: z.boolean().nullish(),
});

export async function checkPullRequestRevision(
  report: AnalysisReport,
  signal?: AbortSignal,
): Promise<RevisionCheck> {
  signal?.throwIfAborted();
  const ref = parseGitHubInput(
    `${report.pr.owner}/${report.pr.repo}`,
    report.pr.number,
  );
  const github = githubClient();
  const args = { owner: ref.owner, repo: ref.repo, request: { signal } };
  try {
    const { data: repository } = await github.repos.get(args);
    signal?.throwIfAborted();
    if (repository.private !== false) throw new Error("PRIVATE_REPO");
    const { data } = await github.pulls.get({
      ...args,
      pull_number: ref.number,
    });
    signal?.throwIfAborted();
    const pr = upstreamRevision.parse(data);
    return revisionCheckSchema.parse({
      reportId: report.id,
      recordedBase: report.pr.baseSha,
      recordedHead: report.pr.headSha,
      currentBase: pr.base.sha,
      currentHead: pr.head.sha,
      checkedAt: new Date().toISOString(),
      state: pr.merged ? "MERGED" : pr.state === "closed" ? "CLOSED" : "OPEN",
      draft: pr.draft ?? false,
    });
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof Error && error.message === "PRIVATE_REPO")
      throw new Error("This workspace checks public repositories only.");
    if (error instanceof Error && error.name === "ZodError")
      throw new Error(
        "GitHub returned incomplete revision data. Try the check again.",
      );
    throw githubError(error);
  }
}
