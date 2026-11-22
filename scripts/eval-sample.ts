import { parseGitHubInput } from "@/lib/github/input";
import type { Octokit } from "@octokit/rest";

export type Candidate = {
  url: string;
  revertedBy: string;
  files: number | null;
  lines: number | null;
};
export type Limits = {
  limit: number;
  minLines: number;
  maxLines: number;
  maxFiles: number;
  scan: number;
};
export class EvalError extends Error {}
export function canonicalUrl(value: string) {
  if (
    !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*\/?$/i.test(value)
  )
    throw new EvalError("Expected a public GitHub PR URL.");
  const { owner, repo, number } = parseGitHubInput(value);
  return `https://github.com/${owner.toLowerCase()}/${repo.toLowerCase()}/pull/${number}`;
}

export function parseUrls(text: string): Candidate[] {
  const seen = new Map<string, Candidate>();
  const invalid: number[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [raw, note = ""] = trimmed.split(/\s+#\s*/, 2);
    try {
      const url = canonicalUrl(raw);
      const revertedBy = note.startsWith("reverted by ")
        ? canonicalUrl(note.slice(12))
        : "";
      if (!seen.has(url) || revertedBy)
        seen.set(url, { url, revertedBy, files: null, lines: null });
    } catch {
      invalid.push(index + 1);
    }
  }
  if (invalid.length)
    throw new EvalError(
      "Invalid PR URL on line(s) " + invalid.join(", ") + ".",
    );
  if (!seen.size) throw new EvalError("The URL list is empty.");
  return [...seen.values()];
}

export function revertedOriginal(body: string, repository: string) {
  const match =
    /\bReverts\s+(?:https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/|([\w.-]+\/[\w.-]+)#)([1-9]\d*)\b/i.exec(
      body,
    );
  return match &&
    (match[1] ?? match[2]).toLowerCase() === repository.toLowerCase()
    ? Number(match[3])
    : null;
}
export async function sample(
  github: Octokit,
  repository: string,
  reverted: boolean,
  limits: Limits,
  signal: AbortSignal,
) {
  const { owner, repo } = parseGitHubInput(repository, 1);
  const slug = owner + "/" + repo;
  if (slug !== repository)
    throw new EvalError("Expected owner/repo for sampling.");
  const found: Candidate[] = [];
  const seen = new Set<number>();
  const per_page = Math.min(100, limits.scan);
  let scanned = 0;
  for (let page = 1; scanned < limits.scan; page++) {
    const request = { signal };
    const candidates = reverted
      ? (
          await github.rest.search.issuesAndPullRequests({
            q: `repo:${slug} is:pr is:merged in:title Revert`,
            sort: "updated",
            order: "desc",
            page,
            per_page,
            request,
          })
        ).data.items
      : (
          await github.rest.pulls.list({
            owner,
            repo,
            state: "closed",
            sort: "updated",
            direction: "desc",
            page,
            per_page,
            request,
          })
        ).data;
    for (const item of candidates) {
      if (scanned++ >= limits.scan) break;
      const number = reverted
        ? revertedOriginal(item.body ?? "", slug)
        : item.number;
      if (!number || seen.has(number)) continue;
      if (
        !reverted &&
        (("merged_at" in item && !item.merged_at) || item.user?.type === "Bot")
      )
        continue;
      seen.add(number);
      const { data } = await github.rest.pulls.get({
        owner,
        repo,
        pull_number: number,
        request,
      });
      if (data.base.repo.private !== false)
        throw new EvalError("Evaluation requires a public repository.");
      const lines = data.additions + data.deletions;
      if (
        !data.merged_at ||
        data.user?.type === "Bot" ||
        lines < limits.minLines ||
        lines > limits.maxLines ||
        data.changed_files > limits.maxFiles
      )
        continue;
      found.push({
        url: canonicalUrl(data.html_url),
        files: data.changed_files,
        lines,
        revertedBy: reverted ? canonicalUrl(item.html_url) : "",
      });
      if (found.length === limits.limit) return found;
    }
    if (candidates.length < per_page) break;
  }
  return found;
}
