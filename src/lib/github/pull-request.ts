import { githubClient, githubError } from "./client";
import { parseDiff } from "./diff";
import { categorize } from "@/lib/analysis/categorizer";
import { assessRisk } from "@/lib/risk/engine";
import { configuredWeights } from "@/lib/risk/signals";
import type { PullRequest } from "@/lib/types";
export async function fetchPullRequest(
  ref: { owner: string; repo: string; number: number },
  progress: (stage: number, detail: string) => Promise<void>,
  signal?: AbortSignal,
): Promise<PullRequest> {
  const github = githubClient();
  const args = { owner: ref.owner, repo: ref.repo, request: { signal } };
  try {
    const { data: repository } = await github.repos.get(args);
    if (repository.private) throw new Error("PRIVATE_REPO");
    await progress(0, `${repository.full_name} · public repository`);
    const { data: pr } = await github.pulls.get({
      ...args,
      pull_number: ref.number,
    });
    await progress(1, `#${pr.number} · ${pr.title}`);
    const warnings: string[] = [];
    const files: PullRequest["files"] = [];
    for (let page = 1; page <= 5; page++) {
      const { data } = await github.pulls.listFiles({
        ...args,
        pull_number: ref.number,
        per_page: 100,
        page,
      });
      for (const f of data) {
        const patch = f.patch?.slice(0, 20000);
        const file = {
          path: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          patch,
          categories: categorize(f.filename),
          lines: parseDiff(patch),
        };
        files.push({
          ...file,
          risk: assessRisk(file, [], configuredWeights()),
        });
      }
      if (data.length < 100) break;
    }
    // Reject a moving PR instead of attaching evidence to mismatched revisions.
    const { data: latest } = await github.pulls.get({
      ...args,
      pull_number: ref.number,
    });
    if (latest.head.sha !== pr.head.sha || latest.base.sha !== pr.base.sha)
      throw new Error("PR_MOVED");
    if (files.length < pr.changed_files)
      warnings.push(
        `Only ${files.length} of ${pr.changed_files} files analyzed (500-file cap).`,
      );
    const incomplete = files.filter(
      (f) => f.lines.length < f.additions + f.deletions,
    ).length;
    if (incomplete)
      warnings.push(
        `${incomplete} files have missing or truncated patches; line coverage is partial.`,
      );
    await progress(
      2,
      `${files.length} files · ${pr.additions + pr.deletions} changed lines`,
    );
    return {
      ...ref,
      title: pr.title,
      description: (pr.body || "").slice(0, 12000),
      url: pr.html_url,
      author: pr.user?.login || "unknown",
      base: pr.base.ref,
      head: pr.head.ref,
      headSha: pr.head.sha,
      baseSha: pr.base.sha,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changed_files,
      files,
      warnings,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "PRIVATE_REPO")
      throw new Error("This MVP analyzes public repositories only.");
    if (error instanceof Error && error.message === "PR_MOVED")
      throw new Error(
        "The PR changed during retrieval. Retry to analyze a consistent revision.",
      );
    throw githubError(error);
  }
}
