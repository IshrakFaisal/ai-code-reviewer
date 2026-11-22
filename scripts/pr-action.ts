import { Console } from "node:console";
import { appendFile, readFile } from "node:fs/promises";
import { Writable } from "node:stream";
import { Octokit } from "@octokit/rest";
import { z } from "zod";
import { parseGitHubInput } from "@/lib/github/input";
import { privateAiSkipped, privateTokenRequired } from "@/lib/github/access";
import { review } from "./review-cli";

const marker = "<!-- ai-change-verifier:sticky -->";
const maxLength = 60000;
const failOnSchema = z.enum(["none", "medium", "high"]);
type ExitPolicy = { failOn: z.infer<typeof failOnSchema>; strict: boolean };

class ActionInputError extends Error {}

function booleanInput(value: string | undefined, name: string) {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new ActionInputError(`${name} must be true or false.`);
}

export function readPolicy(env: Record<string, string | undefined>) {
  const failOn = failOnSchema.parse(env.REVIEW_FAIL_ON ?? "none");
  return {
    failOn,
    strict: booleanInput(env.REVIEW_STRICT, "strict"),
    allowPrivate: booleanInput(env.REVIEW_ALLOW_PRIVATE, "allow-private"),
    allowPrivateAI: booleanInput(
      env.REVIEW_ALLOW_PRIVATE_AI,
      "allow-private-ai",
    ),
  };
}

export function decideExit({
  cliExit,
  strict,
}: ExitPolicy & { cliExit: number }) {
  // The CLI already evaluated failOn against the saved report's priority.
  if (cliExit === 3) return 3;
  return strict ? cliExit : 0;
}

function stickyBody(body: string, marker: string) {
  const prefix = marker + "\n\n";
  const content = body.trim();
  if (prefix.length + content.length <= maxLength) return prefix + content;
  // buildPrComment ends with a separate revision/date footer paragraph.
  const footerStart = content.lastIndexOf("\n<sub>");
  const footer = footerStart < 0 ? "" : content.slice(footerStart);
  const ending = "\n\n…\n" + footer;
  const available = maxLength - prefix.length - ending.length;
  if (available < 0)
    throw new Error("Review footer exceeds the comment limit.");
  return prefix + content.slice(0, available).trimEnd() + ending;
}

export async function upsertStickyComment({
  octokit,
  owner,
  repo,
  issueNumber,
  body,
  marker,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
  marker: string;
}) {
  const issues = octokit.rest.issues;
  const target = { owner, repo, issue_number: issueNumber };
  const text = stickyBody(body, marker);
  try {
    for await (const { data } of octokit.paginate.iterator(
      issues.listComments,
      { ...target, per_page: 100 },
    )) {
      const sticky = data.find(
        (comment) =>
          comment.user?.type === "Bot" &&
          comment.body?.split(/\r?\n/, 1)[0] === marker,
      );
      if (sticky) {
        await issues.updateComment({
          owner,
          repo,
          comment_id: sticky.id,
          body: text,
        });
        return;
      }
    }
    await issues.createComment({ ...target, body: text });
  } catch {
    throw new Error("GitHub could not update the sticky PR comment.");
  }
}

const eventSchema = z.object({
  number: z.number().int().positive(),
  pull_request: z.object({
    head: z.object({ repo: z.object({ full_name: z.string() }).nullable() }),
    base: z.object({ repo: z.object({ full_name: z.string() }) }),
  }),
});

export async function runAction(
  env: Record<string, string | undefined>,
  signal: AbortSignal,
  runReview = review,
  client = (token: string) => new Octokit({ auth: token }),
) {
  const policy = readPolicy(env);
  const summary = env.GITHUB_STEP_SUMMARY;
  if (
    !summary ||
    env.GITHUB_EVENT_NAME !== "pull_request" ||
    !env.GITHUB_EVENT_PATH
  )
    throw new Error("A pull_request job and summary file are required.");
  const event = eventSchema.parse(
    JSON.parse(await readFile(env.GITHUB_EVENT_PATH, "utf8")),
  );
  const repository = env.GITHUB_REPOSITORY;
  if (
    env.GITHUB_SERVER_URL !== "https://github.com" ||
    !repository ||
    event.pull_request.base.repo.full_name.toLowerCase() !==
      repository.toLowerCase()
  )
    throw new Error("Invalid GitHub pull request context.");
  const url = `${env.GITHUB_SERVER_URL}/${repository}/pull/${event.number}`;
  const { owner, repo, number } = parseGitHubInput(url);
  if (policy.allowPrivate && !env.GITHUB_TOKEN?.trim()) {
    process.stderr.write(privateTokenRequired + "\n");
    await appendFile(summary, privateTokenRequired + "\n", "utf8");
    return 1;
  }
  const sameRepo =
    event.pull_request.head.repo?.full_name.toLowerCase() ===
    repository.toLowerCase();
  let comment = "";
  let cliExit = 1;
  // Refuse inherited execution opt-ins. CI reviews only read the PR via GitHub.
  if (
    env.GITHUB_TOKEN &&
    env.DEMO_MODE === "false" &&
    (!env.NEBIUS_API_KEY || env.NEBIUS_MODEL) &&
    env.ENABLE_LOCAL_SANDBOX !== "true" &&
    env.ENABLE_NEBIUS_SANDBOX !== "true"
  ) {
    cliExit = await runReview(
      [
        url,
        "--fail-on",
        policy.failOn,
        "--quiet",
        ...(policy.allowPrivate ? ["--allow-private"] : []),
        ...(policy.allowPrivateAI ? ["--allow-private-ai"] : []),
      ],
      signal,
      {
        stdout: (text) => {
          comment += text;
          return true;
        },
        stderr: (line) =>
          line === privateAiSkipped + "\n" ? process.stderr.write(line) : true,
      },
    );
  }
  if (cliExit === 0 || cliExit === 3) {
    // The browser draft footer describes a manual copy. Keep its revision and
    // date, and use a footer that applies to both a job summary and a posted PR.
    comment = comment
      .trimEnd()
      .replace(/ Nothing here was posted automatically\.<\/sub>$/, "</sub>");
    if (!comment) throw new Error("The review produced an empty comment.");
    await appendFile(summary, comment + "\n", "utf8");
    if (sameRepo)
      await upsertStickyComment({
        octokit: client(env.GITHUB_TOKEN!),
        owner,
        repo,
        issueNumber: number,
        body: comment,
        marker,
      });
  } else {
    await appendFile(
      summary,
      `Review unavailable (CLI exit ${cliExit}).\n`,
      "utf8",
    );
  }
  return decideExit({ ...policy, cliExit });
}

export async function main() {
  // Third-party request diagnostics may contain raw headers or untrusted text.
  globalThis.console = new Console(
    new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    }),
  );
  const stop = new AbortController();
  const interrupt = () => stop.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    return await runAction(process.env, stop.signal);
  } catch (error) {
    process.stderr.write(
      error instanceof ActionInputError
        ? error.message + "\n"
        : "The PR review action could not complete. Check its configuration and GitHub permissions.\n",
    );
    return 1;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}
