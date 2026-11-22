import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Octokit } from "@octokit/rest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { evaluate, evalMain } from "../scripts/eval";
import {
  canonicalUrl,
  parseUrls,
  revertedOriginal,
  sample,
} from "../scripts/eval-sample";
import {
  csv,
  labelColumns,
  parseCsv,
  prColumns,
  score,
  scoreFile,
  summarySchema,
} from "../scripts/eval-score";
import {
  samplePullRequest,
  sampleHypotheses,
} from "@/lib/demo/sample-analysis";
import type { review } from "../scripts/review-cli";

const url = (n: number) => "https://github.com/acme/platform/pull/" + n;
const token = "fake-eval-token-for-tests";
const limits = {
  minLines: 10,
  maxLines: 400,
  maxFiles: 30,
  limit: 10,
  scan: 60,
};
const signal = new AbortController().signal;
const summary = summarySchema.parse({
  commit: "a".repeat(40),
  ai: false,
  model: "",
  selected: 0,
  attempts: [],
});
function pull(n: number) {
  return {
    number: n,
    html_url: url(n),
    body: "",
    merged_at: "2026-01-01",
    user: { type: "User" },
    additions: 11,
    deletions: 7,
    changed_files: 3,
    base: { repo: { private: false } },
  };
}
function api(pulls = [pull(1)], reverts: ReturnType<typeof pull>[] = []) {
  const list = vi.fn(async () => ({ data: pulls }));
  const get = vi.fn(async ({ pull_number }: { pull_number: number }) => ({
    data: pulls.find((p) => p.number === pull_number) ?? pull(pull_number),
  }));
  const search = vi.fn(async () => ({ data: { items: reverts } }));
  return {
    get,
    list,
    search,
    github: {
      rest: { pulls: { get, list }, search: { issuesAndPullRequests: search } },
    } as unknown as Octokit,
  };
}
let tmp: string, input: string, root: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "eval-prs-"));
  input = path.join(tmp, "urls.txt");
  root = path.join(tmp, "outputs");
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("GITHUB_TOKEN", token);
  vi.stubEnv("NEBIUS_MODEL", "");
  vi.stubEnv("NEBIUS_API_KEY", "");
  for (const key of [
    "SANDBOX_PROVIDER",
    "ENABLE_LOCAL_SANDBOX",
    "ENABLE_NEBIUS_SANDBOX",
    "ENABLE_PRODUCTION_SANDBOX",
    "LOCAL_SANDBOX_REPOSITORIES",
    "NEBIUS_SANDBOX_REPOSITORIES",
  ])
    vi.stubEnv(key, "");
  await writeFile(input, [1, 2, 3, 4].map(url).join("\n"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(tmp, { recursive: true, force: true });
});
function fixture() {
  const runReview = vi.fn<typeof review>(async (args, _signal, io) => {
    const pr = samplePullRequest();
    pr.url = args[0];
    pr.number = Number(args[0].split("/").at(-1));
    io?.stdout?.(
      JSON.stringify({
        id: "cccccccc-3333-4444-8888-111111111111",
        createdAt: new Date().toISOString(),
        mode: "LIVE",
        provider: "Deterministic analysis",
        pr,
        summary: "fixture",
        findings: sampleHypotheses.map((f, i) => ({
          ...f,
          id: "f" + i,
          riskScore: 55,
          severity: "HIGH",
          status: "UNVERIFIED_RISK",
          evidence: [],
        })),
        behaviors: [],
        events: [],
        checks: [],
        warnings: [],
        riskMap: [],
        reviewSurface: { partial: false, totalLines: 10, priorityLines: 3 },
      }),
    );
    return 0;
  });
  const log = vi.fn();
  return { root, runReview, log, github: api().github };
}
async function runDir() {
  return path.join(root, (await readdir(root))[0]);
}
const args = () => ["--urls", input, "--delay-ms", "0"];
it("drops duplicates, comments and blank lines but retains revert provenance", () => {
  expect(
    parseUrls(
      "# header\n\n" +
        url(1) +
        "/\n" +
        url(1) +
        " # reverted by " +
        url(9) +
        "\n",
    ),
  ).toEqual([{ url: url(1), revertedBy: url(9), lines: null, files: null }]);
});
it("lists all invalid URL line numbers without echoing their contents", () => {
  expect(() => parseUrls(token + "\n" + url(2) + "\nhttp://bad")).toThrow(
    "line(s) 1, 3",
  );
  expect(() =>
    canonicalUrl("https://evil.test/acme/platform/pull/4"),
  ).toThrow();
});
it.each([
  ["Reverts acme/platform#19.", 19],
  ["Reverts " + url(4), 4],
  ["Reverts private/other#5", null],
  ["Just a revert", null],
])("parses revert references (%#)", (body, expected) => {
  expect(revertedOriginal(String(body), "acme/platform")).toBe(expected);
});
it("filters bots, closed unmerged PRs, file/line sizes and limits the scan", async () => {
  const bot = { ...pull(1), user: { type: "Bot" } },
    small = { ...pull(2), additions: 0, deletions: 0 },
    big = { ...pull(3), additions: 500 },
    wide = { ...pull(4), changed_files: 55 };
  const gh = api([
    bot,
    small,
    big,
    wide,
    { ...pull(5), merged_at: "" },
    pull(6),
    pull(7),
  ]);
  expect(
    (
      await sample(
        gh.github,
        "acme/platform",
        false,
        { ...limits, scan: 6 },
        signal,
      )
    ).map((p) => p.url),
  ).toEqual([url(6)]);
  expect(gh.get).toHaveBeenCalledTimes(4);
});
it("samples deduplicated originals with the size of the original", async () => {
  const gh = api(
    [pull(1)],
    [
      { ...pull(8), body: "Reverts " + url(1) },
      { ...pull(9), body: "Reverts acme/platform#1" },
    ],
  );
  expect(
    await sample(gh.github, "acme/platform", true, limits, signal),
  ).toEqual([{ url: url(1), revertedBy: url(8), files: 3, lines: 18 }]);
  expect(gh.search).toHaveBeenCalledWith(
    expect.objectContaining({
      q: "repo:acme/platform is:pr is:merged in:title Revert",
    }),
  );
  expect(gh.get).toHaveBeenCalledTimes(1);
});
it("round trips RFC 4180 cells", () => {
  const rows = [
    ["a", "b", "c"],
    ["x,y", 'a"b', "line1\r\nline2"],
    ["", "", ""],
  ];
  expect(parseCsv(csv(rows))).toEqual(rows);
});
it("scores ten labeled findings with explicit denominators", () => {
  const verdicts = [
    ...Array(5).fill("useful"),
    ...Array(3).fill("false_positive"),
    "unclear",
    "unclear",
  ];
  const labels = csv([
    labelColumns,
    ...verdicts.map((v, i) => [
      url(1),
      i < 5 ? "Heuristic" : "AI inference",
      "HIGH",
      "title",
      "path",
      v,
      i < 2 ? "y" : "n",
      "",
    ]),
  ]);
  const prs = csv([
    prColumns,
    [url(1), url(9), "yes", "low", ""],
    [url(2), "", "yes", "low", ""],
  ]);
  const result = score(labels, prs, summary);
  for (const expected of [
    "Overall precision: 0.625 (5/8, n=8)",
    "Heuristic precision: 1.000",
    "AI inference precision: 0.000",
    "Hallucination rate: 0.200 (2/10",
    "catch rate: 1.000 (1/1",
    "indicative only, n too small for conclusions",
    "Unclear verdicts: 2",
  ])
    expect(result).toContain(expected);
});
it("reports invalid cells in both sheets with row numbers", () => {
  const labels = csv([
    labelColumns,
    [url(1), "Heuristic", "LOW", "T", "", "bad", "bad", ""],
  ]);
  expect(() =>
    score(labels, csv([prColumns, [url(1), "", "maybe", "", ""]]), summary),
  ).toThrow(
    /labels.csv row 2: verdict[\s\S]+prs.csv row 2: caught_known_issue/,
  );
});
it("writes three indexed PR comments, matching labels and valid summary offline", async () => {
  const deps = fixture();
  expect(await evaluate([...args(), "--limit", "3"], signal, deps)).toBe(0);
  const dir = await runDir(),
    files = await readdir(dir);
  expect(files.filter((f) => /^\d\d-.*\.md$/.test(f))).toHaveLength(3);
  const index = await readFile(path.join(dir, "index.md"), "utf8");
  expect(index.match(/^\| \[/gm)).toHaveLength(3);
  expect(index).toContain("Heuristic: 3");
  const file = path.join(dir, "labels.csv");
  expect(parseCsv(await readFile(file, "utf8"))).toHaveLength(10);
  expect(
    summarySchema.parse(
      JSON.parse(await readFile(path.join(dir, "summary.json"), "utf8")),
    ).attempts,
  ).toHaveLength(3);
  expect(await scoreFile(file)).toContain("unlabeled verdicts: 9");
  for (const f of await readdir(dir))
    expect(await readFile(path.join(dir, f), "utf8")).not.toContain(token);
  expect(JSON.stringify(deps.log.mock.calls)).not.toContain(token);
});
it("dry run lists sizes and makes zero review calls", async () => {
  const deps = fixture();
  expect(await evaluate([...args(), "--dry-run"], signal, deps)).toBe(0);
  expect(deps.runReview).not.toHaveBeenCalled();
  expect(deps.log).toHaveBeenCalledWith(
    expect.stringContaining("3 files  18 lines"),
  );
});
it.each([
  ["SANDBOX_PROVIDER", "docker"],
  ["LOCAL_SANDBOX_REPOSITORIES", "acme/app"],
  ["ENABLE_NEBIUS_SANDBOX", "true"],
  ["DEMO_MODE", "true"],
])("refuses unsafe or demo settings: %s", async (k, v) => {
  vi.stubEnv(k, v);
  const deps = fixture();
  await expect(evaluate(args(), signal, deps)).rejects.toThrow();
  expect(deps.runReview).not.toHaveBeenCalled();
});
it("keeps execution disabled even after acknowledging existing settings", async () => {
  vi.stubEnv("SANDBOX_PROVIDER", "docker");
  const deps = fixture();
  deps.runReview.mockImplementation(async () => {
    expect(process.env.SANDBOX_PROVIDER).toBe("disabled");
    return 2;
  });
  expect(
    await evaluate(
      [...args(), "--allow-execution", "--limit", "1"],
      signal,
      deps,
    ),
  ).toBe(2);
  expect(process.env.SANDBOX_PROVIDER).toBe("docker");
});
it("aborts after three consecutive failures", async () => {
  const deps = fixture();
  deps.runReview.mockResolvedValue(2);
  expect(await evaluate(args(), signal, deps)).toBe(2);
  expect(deps.runReview).toHaveBeenCalledTimes(3);
});
it("preserves the completed comment and paused attempt on interrupt", async () => {
  const stop = new AbortController(),
    deps = fixture();
  const original = deps.runReview.getMockImplementation()!;
  deps.runReview
    .mockImplementationOnce(original)
    .mockImplementationOnce(async () => {
      stop.abort();
      return 130;
    });
  expect(await evaluate(args(), stop.signal, deps)).toBe(130);
  const dir = await runDir();
  expect(await readdir(dir)).toContain("01-acme-platform-pr1.md");
  const result = summarySchema.parse(
    JSON.parse(await readFile(path.join(dir, "summary.json"), "utf8")),
  );
  expect(result.attempts.map((a) => a.exitCode)).toEqual([0, 130]);
});
it("rejects limits above 25 and keeps invalid input out of stderr", async () => {
  const deps = fixture();
  await expect(
    evaluate([...args(), "--limit", "26"], signal, deps),
  ).rejects.toThrow();
  await writeFile(input, token);
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  expect(await evalMain(args(), signal, false)).toBe(1);
  expect(JSON.stringify([stderr.mock.calls, stdout.mock.calls])).not.toContain(
    token,
  );
});
