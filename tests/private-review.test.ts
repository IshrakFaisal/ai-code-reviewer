import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/analyze/route";
import { analysisRuns, AnalysisRuns } from "@/lib/agent/runs";
import { analysisRunStore } from "@/lib/agent/run-store";
import { reportStore } from "@/lib/reports/store";
import * as sandboxFactory from "@/lib/sandbox/factory";
import { repairAndRecheck, reproduce } from "@/lib/regression/workflow";
import type { RegressionResult } from "@/lib/regression/types";
import { review } from "../scripts/review-cli";
import { runAction } from "../scripts/pr-action";
import type { Octokit } from "@octokit/rest";

const github = vi.hoisted(() => ({
  repos: { get: vi.fn() },
  pulls: { get: vi.fn(), listFiles: vi.fn() },
}));
vi.mock("@/lib/github/client", async (original) => ({
  ...(await original<typeof import("@/lib/github/client")>()),
  githubClient: () => github,
}));
const after = vi.hoisted(() => vi.fn<(work: () => Promise<void>) => void>());
vi.mock("next/server", () => ({ after }));

const model = "nvidia/example";
const sentinel = "PRIVATE_DIFF_FIXTURE_7D71";
const token = "private-review-fixture-github-token";
const key = "private-review-fixture-provider-key";
const gap =
  "AI analysis skipped: private repository without --allow-private-ai";
const denied = "This MVP analyzes public repositories only.";
const url = "https://github.com/team/example/pull/5";
const pull = {
  number: 5,
  title: "Change a default",
  body: "Update the setting.",
  html_url: url,
  user: { login: "reviewer" },
  base: { ref: "main", sha: "a".repeat(40) },
  head: { ref: "topic", sha: "b".repeat(40) },
  additions: 2,
  deletions: 0,
  changed_files: 2,
};
const signal = new AbortController().signal;
const provider = vi.fn<typeof fetch>(async (endpoint, init) => {
  if (String(endpoint).endsWith("/models"))
    return Response.json({ object: "list", data: [{ id: model }] });
  const task = JSON.parse(JSON.parse(String(init?.body)).messages[1].content)
    .task as string;
  const response = task.startsWith("Summarize")
    ? { intent: "Update a setting." }
    : task.startsWith("Refine")
      ? { files: [] }
      : task.startsWith("Identify")
        ? { changes: [] }
        : { hypotheses: [] };
  return Response.json({
    choices: [{ message: { content: JSON.stringify(response) } }],
  });
});

let directory: string;
let store: ReturnType<typeof analysisRunStore>;
let reports: ReturnType<typeof reportStore>;
let runs: AnalysisRuns;
beforeEach(async () => {
  vi.clearAllMocks();
  directory = await mkdtemp(path.join(tmpdir(), "private-review-"));
  store = analysisRunStore(path.join(directory, "runs"));
  reports = reportStore(path.join(directory, "reports"));
  runs = new AnalysisRuns(store, undefined, reports.save);
  for (const [name, value] of Object.entries({
    DEMO_MODE: "false",
    SANDBOX_PROVIDER: "disabled",
    GITHUB_TOKEN: token,
    NEBIUS_API_KEY: key,
    NEBIUS_MODEL: model,
    NEBIUS_BASE_URL: "https://inference.invalid/v1",
    APP_ORIGIN: "",
    APP_AUTH_USERNAME: "",
    APP_AUTH_PASSWORD: "",
  }))
    vi.stubEnv(name, value);
  vi.stubGlobal("fetch", provider);
  github.repos.get.mockResolvedValue({
    data: { full_name: "team/example", private: true },
  });
  github.pulls.get.mockResolvedValue({ data: pull });
  github.pulls.listFiles.mockResolvedValue({
    data: [
      {
        filename: "src/auth/session.ts",
        status: "modified",
        additions: 2,
        deletions: 0,
        patch: "@@ -0,0 +1,2 @@\n+// " + sentinel,
      },
    ],
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

async function cli(...flags: string[]) {
  let stdout = "",
    stderr = "";
  const code = await review([url, "--quiet", ...flags], signal, {
    runs,
    read: reports.get,
    stdout: (s) => {
      stdout += s;
      return true;
    },
    stderr: (s) => {
      stderr += s;
      return true;
    },
  });
  expect(stderr.includes(sentinel)).toBe(false);
  for (const value of [token, key])
    expect((stdout + stderr).includes(value)).toBe(false);
  const id = /^Run ([a-f0-9-]+)/m.exec(stderr)?.[1];
  return {
    code,
    stdout,
    stderr,
    id,
    report: id ? await reports.get(id) : null,
  };
}

it("keeps configured inference enabled on a public PR without flags", async () => {
  github.repos.get.mockResolvedValue({
    data: { private: false, full_name: "team/example" },
  });
  const r = await cli();
  expect(r.code).toBe(0);
  expect(r.report?.repository?.visibility).toBe("public");
  expect(r.stdout).toContain("Live AI");
  expect(provider).toHaveBeenCalled();
});
it.each([[], ["--allow-private-ai"]])(
  "denies a private PR before reading its diff without retrieval consent (%#)",
  async (...flags) => {
    const r = await cli(...flags);
    expect(r.code).toBe(2);
    expect((await runs.get(r.id!)).error).toBe(denied);
    expect(github.pulls.get).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  },
);
it("requires a token before starting an opted-in investigation", async () => {
  vi.stubEnv("GITHUB_TOKEN", " ");
  const r = await cli("--allow-private");
  expect(r).toMatchObject({
    code: 1,
    stderr: "GITHUB_TOKEN is required with --allow-private.\n",
    stdout: "",
  });
  expect(github.repos.get).not.toHaveBeenCalled();
});
it("runs static private review with a token, including when inference is unconfigured", async () => {
  vi.stubEnv("NEBIUS_API_KEY", "");
  const r = await cli("--allow-private");
  expect(r.code).toBe(0);
  expect(r.report).toMatchObject({
    repository: { visibility: "private" },
    provider: "Deterministic analysis",
  });
  expect(r.report?.pr.files[0].patch?.includes(sentinel)).toBe(true);
  expect(provider).not.toHaveBeenCalled();
});
it("makes zero inference requests and preserves the exact consent gap even on a partial diff", async () => {
  const r = await cli("--allow-private");
  expect(r.code).toBe(0);
  expect(provider).not.toHaveBeenCalled();
  expect(r.report?.reviewSurface.partial).toBe(true);
  expect(r.stderr.split("\n")).toContain(gap);
  expect(
    r.stdout.split("**Evidence gaps**\n")[1].split("\n\n")[0].split("\n"),
  ).toContain("- " + gap);
  expect(r.stdout).toContain("Live heuristics");
});
it("sends the private patch to the mocked inference transport only with both permissions", async () => {
  const r = await cli("--allow-private", "--allow-private-ai");
  expect(r.code).toBe(0);
  expect(
    provider.mock.calls.some(([, init]) =>
      String(init?.body).includes(sentinel),
    ),
  ).toBe(true);
  expect(r.stdout).toContain("Live AI");
  expect(r.stdout + r.stderr).not.toContain(gap);
});
it("keeps private review static when a matching sandbox allowlist is inherited", async () => {
  vi.stubEnv("SANDBOX_PROVIDER", "docker");
  vi.stubEnv("LOCAL_SANDBOX_REPOSITORIES", "team/example");
  vi.stubEnv("ENABLE_LOCAL_SANDBOX", "true");
  const sandbox = vi
    .spyOn(sandboxFactory, "createSandboxProvider")
    .mockImplementation(() => {
      throw new Error("Unexpected sandbox request.");
    });
  const r = await cli("--allow-private");
  expect(r.code).toBe(0);
  expect(provider).not.toHaveBeenCalled();
  expect(sandbox).not.toHaveBeenCalled();
  expect(r.stdout).toContain("Execution: Not run");
});
it("refuses to publish a private head's changes in a public base repository", async () => {
  github.repos.get.mockResolvedValue({ data: { private: false } });
  github.pulls.get.mockResolvedValue({
    data: { ...pull, head: { ...pull.head, repo: { private: true } } },
  });
  const r = await cli("--allow-private", "--allow-private-ai");
  expect(r.code).toBe(2);
  expect(github.pulls.listFiles).not.toHaveBeenCalled();
  expect(provider).not.toHaveBeenCalled();
});
it("fails closed on unrecognized repository visibility", async () => {
  github.repos.get.mockResolvedValue({ data: { visibility: "internal" } });
  const r = await cli("--allow-private", "--allow-private-ai");
  expect(r.code).toBe(2);
  expect(github.pulls.get).not.toHaveBeenCalled();
  expect(provider).not.toHaveBeenCalled();
});
it("keeps raw GitHub errors out of private CLI diagnostics and saved errors", async () => {
  github.pulls.listFiles.mockRejectedValueOnce(new Error(sentinel + token));
  const r = await cli("--allow-private");
  expect(r.code).toBe(2);
  const { error } = await runs.get(r.id!);
  expect(error.includes(sentinel) || error.includes(token)).toBe(false);
});
it("POST /api/analyze cannot opt in via the request body", async () => {
  vi.spyOn(analysisRuns, "start").mockImplementation(runs.start.bind(runs));
  const response = await POST(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      body: JSON.stringify({
        input: url,
        allowPrivate: true,
        allowPrivateAI: true,
      }),
    }),
  );
  expect(response.status).toBe(202);
  const { id } = await response.json();
  await after.mock.calls[0][0]();
  expect(await runs.get(id)).toMatchObject({
    status: "INTERRUPTED",
    error: denied,
  });
  expect(github.pulls.listFiles).not.toHaveBeenCalled();
  expect(provider).not.toHaveBeenCalled();
});
it("resuming a private checkpoint cannot reuse earlier inference consent", async () => {
  const r = await cli("--allow-private", "--allow-private-ai");
  const record = (await store.get(r.id!))!;
  await store.save({ ...record, status: "PAUSED", reportId: undefined });
  provider.mockClear();
  const resumed = await runs.resume(record.id);
  await resumed.done;
  expect((await runs.get(record.id)).error).toBe(denied);
  expect(provider).not.toHaveBeenCalled();
});
it("rechecks a formerly public checkpoint before sending it to the inference provider", async () => {
  github.repos.get.mockResolvedValue({
    data: { full_name: "team/example", private: false },
  });
  const r = await cli();
  const record = (await store.get(r.id!))!;
  await store.save({ ...record, status: "PAUSED", reportId: undefined });
  github.repos.get.mockResolvedValue({
    data: { full_name: "team/example", private: true },
  });
  provider.mockClear();
  await (
    await runs.resume(record.id)
  ).done;
  expect((await runs.get(record.id)).error).toBe(denied);
  expect(provider).not.toHaveBeenCalled();
});
it("blocks web reproduction and repair of a private CLI report before sandbox creation", async () => {
  const { report } = await cli("--allow-private");
  const sandbox = vi.fn();
  await expect(
    reproduce(report!, report!.findings[0], undefined, undefined, { sandbox }),
  ).rejects.toThrow("public repository");
  await expect(
    repairAndRecheck(
      report!,
      report!.findings[0],
      {} as RegressionResult,
      undefined,
      undefined,
      { sandbox },
    ),
  ).rejects.toThrow("public repository");
  expect(sandbox).not.toHaveBeenCalled();
});
it("loads an existing stored report that predates visibility metadata", async () => {
  const { report } = await cli("--allow-private");
  const { repository, ...legacy } = report!;
  expect(repository).toBeDefined();
  await writeFile(
    path.join(directory, "reports", legacy.id + ".json"),
    JSON.stringify(legacy),
  );
  expect(await reports.get(legacy.id)).toEqual(legacy);
});
it("publishes the static-only gap in the Action summary and sticky comment without leaking source or credentials to logs", async () => {
  const event = path.join(directory, "event.json"),
    summary = path.join(directory, "summary.md");
  const repo = { full_name: "team/example" };
  await writeFile(
    event,
    JSON.stringify({
      number: 5,
      pull_request: { base: { repo }, head: { repo } },
    }),
  );
  const post = vi.fn();
  const githubComments = {
    rest: { issues: { createComment: post } },
    paginate: { iterator: () => [] },
  } as unknown as Octokit;
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const code = await runAction(
    {
      DEMO_MODE: "false",
      REVIEW_ALLOW_PRIVATE: "true",
      GITHUB_TOKEN: token,
      GITHUB_EVENT_PATH: event,
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_REPOSITORY: repo.full_name,
      GITHUB_SERVER_URL: "https://github.com",
    },
    signal,
    (args, signal, io) =>
      review(args, signal, { ...io, runs, read: reports.get }),
    () => githubComments,
  );
  expect(code).toBe(0);
  expect(provider).not.toHaveBeenCalled();
  const markdown = await readFile(summary, "utf8");
  expect(markdown).toContain("- " + gap);
  const body = post.mock.calls[0][0].body;
  expect(body).toContain("- " + gap);
  const logs = [...stderr.mock.calls, ...stdout.mock.calls]
    .map(([text]) => String(text))
    .join("");
  expect(logs).toBe(gap + "\n");
  for (const value of [token, key, sentinel])
    expect((logs + markdown + body).includes(value)).toBe(false);
});
