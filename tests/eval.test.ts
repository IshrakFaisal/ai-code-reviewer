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
  anchorColumns,
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
import type { Finding } from "@/lib/types";
import type { RunRecord } from "@/lib/agent/run-schema";

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
const heuristicFindings: Finding[] = sampleHypotheses.map((f, i) => ({
  ...f,
  id: "f" + i,
  riskScore: 55,
  severity: "HIGH",
  status: "UNVERIFIED_RISK",
  evidence: [],
}));
function fixture(
  findings = heuristicFindings,
  provider = "Deterministic analysis",
  warnings: string[] = [],
) {
  const runReview = vi.fn<typeof review>(async (args, _signal, io) => {
    const pr = samplePullRequest();
    pr.url = args[0];
    pr.number = Number(args[0].split("/").at(-1));
    io?.stdout?.(
      JSON.stringify({
        id: "cccccccc-3333-4444-8888-111111111111",
        createdAt: new Date().toISOString(),
        mode: "LIVE",
        provider,
        pr,
        summary: "fixture",
        findings,
        behaviors: [],
        events: [],
        checks: [],
        warnings,
        riskMap: [],
        reviewSurface: { partial: false, totalLines: 10, priorityLines: 3 },
      }),
    );
    return 0;
  });
  const log = vi.fn();
  const readRun = vi
    .fn<(id: string) => Promise<RunRecord | null>>()
    .mockResolvedValue(null);
  return { root, runReview, readRun, log, github: api().github };
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
      url(1) + "#f" + i,
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
  const anchors = csv([
    anchorColumns,
    ...verdicts.map((_, i) => [
      url(1) + "#f" + i,
      "not-checked",
      i < 5 ? "y" : "n",
      i < 5 ? String(i + 1) : "",
      "",
    ]),
  ]);
  const result = score(labels, prs, summary, anchors);
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
    [url(1) + "#f1", url(1), "Heuristic", "LOW", "T", "", "bad", "bad", ""],
  ]);
  expect(() =>
    score(
      labels,
      csv([prColumns, [url(1), "", "maybe", "", ""]]),
      summary,
      csv([anchorColumns]),
    ),
  ).toThrow(
    /labels.csv row 2: verdict[\s\S]+prs.csv row 2: caught_known_issue/,
  );
});
it("indexes heuristic comments without adding them to the AI labeling sample", async () => {
  const deps = fixture();
  expect(await evaluate([...args(), "--limit", "3"], signal, deps)).toBe(0);
  const dir = await runDir(),
    files = await readdir(dir);
  expect(files.filter((f) => /^\d\d-.*\.md$/.test(f))).toHaveLength(3);
  const index = await readFile(path.join(dir, "index.md"), "utf8");
  expect(index.match(/^\| \[/gm)).toHaveLength(3);
  expect(index).toContain("Heuristic: 3");
  const file = path.join(dir, "labels.csv");
  expect(parseCsv(await readFile(file, "utf8"))).toEqual([labelColumns]);
  expect(
    parseCsv(await readFile(path.join(dir, "anchors.csv"), "utf8")),
  ).toEqual([anchorColumns]);
  expect(
    summarySchema.parse(
      JSON.parse(await readFile(path.join(dir, "summary.json"), "utf8")),
    ).attempts,
  ).toHaveLength(3);
  expect(await scoreFile(file)).toContain("unlabeled verdicts: 0");
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

const statuses = ["verified", "path-only", "unanchored", undefined] as const;
function modelFindings(): Finding[] {
  return Array.from({ length: 24 }, (_, i) => {
    const status = statuses[i % 4];
    return {
      ...heuristicFindings[0],
      title: "Candidate " + (i + 1),
      id: "finding-" + (i + 1),
      riskScore: 100 - i,
      affectedFiles: [{ path: "src/example.ts" }],
      ...(status && {
        anchor: { status, reason: "Machine explanation" },
        locations: [{ path: "candidate.ts", anchor: { status } }],
      }),
    };
  }).reverse();
}
async function modelRun() {
  const deps = fixture(modelFindings(), "Nebius");
  expect(await evaluate([...args(), "--limit", "1"], signal, deps)).toBe(0);
  return runDir();
}
it("writes blind labels in finding-ID order, capped at 20 independently of the guard", async () => {
  const dir = await modelRun();
  const raw = await readFile(path.join(dir, "labels.csv"), "utf8");
  const [header, ...rows] = parseCsv(raw);
  expect(header).toEqual([
    "finding_key",
    "pr_url",
    "evidence_label",
    "severity",
    "title",
    "location",
    "verdict",
    "invented_reference",
    "notes",
  ]);
  expect(rows).toHaveLength(20);
  expect(rows.map((r) => r[0])).toEqual(
    Array.from({ length: 20 }, (_, i) => url(1) + "#finding-" + (i + 1)),
  );
  expect(raw).not.toMatch(
    /unanchored|path-only|verified|not-checked|Machine explanation|shown_in_comment|comment_rank/,
  );
});
it("records every anchor and the actual comment rank even outside the labeling cap", async () => {
  const dir = await modelRun();
  const [header, ...rows] = parseCsv(
    await readFile(path.join(dir, "anchors.csv"), "utf8"),
  );
  expect(header).toEqual(anchorColumns);
  expect(rows).toHaveLength(24);
  expect(rows[2]).toEqual([
    url(1) + "#finding-3",
    "unanchored",
    "n",
    "",
    "Machine explanation",
  ]);
  expect(rows[3]).toEqual([url(1) + "#finding-4", "not-checked", "y", "3", ""]);
  const comment = await readFile(
    path.join(dir, "01-acme-platform-pr1.md"),
    "utf8",
  );
  const numbered = [
    ...comment.matchAll(
      /^(\d+)\. \*\*HIGH · AI inference\*\*: Candidate (\d+) /gm,
    ),
  ].map((m) => [m[1], url(1) + "#finding-" + m[2]]);
  expect(numbered).toHaveLength(5);
  expect(rows.filter((r) => r[2] === "y").map((r) => [r[3], r[0]])).toEqual(
    numbered,
  );
  expect(rows.filter((r) => r[2] === "n").every((r) => r[3] === "")).toBe(true);
});
it("counts full-report statuses and all omissions in both evaluation summaries", async () => {
  const dir = await modelRun();
  const result = summarySchema.parse(
    JSON.parse(await readFile(path.join(dir, "summary.json"), "utf8")),
  );
  expect(result.attempts[0]).toMatchObject({
    findings: 5,
    verified: 6,
    pathOnly: 6,
    unanchored: 6,
    omittedFromComment: 19,
  });
  const index = await readFile(path.join(dir, "index.md"), "utf8");
  expect(index).toContain(
    "| Verified | Path-only | Unanchored | Omitted from comment |",
  );
  expect(index).toContain("| AI inference: 5 | 6 | 6 | 6 | 19 |");
});
it("labels original path and line claims from the matching checkpoint before scoring", async () => {
  const finding = {
    ...heuristicFindings[0],
    id: "finding-1",
    anchor: { status: "path-only" as const },
    affectedFiles: [{ path: "entry.ts" }],
  };
  const deps = fixture([finding], "Nebius");
  deps.readRun.mockImplementation(async (id) => ({
    version: 1,
    id,
    reportId: id,
    input: { input: url(1) },
    status: "COMPLETE",
    attempt: 1,
    createdAt: "2026-11-22T00:00:00Z",
    updatedAt: "2026-11-22T00:00:00Z",
    events: [],
    error: "",
    checkpoint: {
      events: [],
      values: {
        hypotheses: {
          warning: "",
          value: [
            {
              ...finding,
              affectedFiles: [
                {
                  path: "entry.ts",
                  startLine: 945,
                  endLine: 950,
                  side: "LEFT",
                },
                { path: "other.ts", startLine: 12 },
              ],
            },
          ],
        },
      },
    },
  }));
  expect(await evaluate([...args(), "--limit", "1"], signal, deps)).toBe(0);
  const dir = await runDir();
  const rows = parseCsv(await readFile(path.join(dir, "labels.csv"), "utf8"));
  expect(rows[1][5]).toBe("entry.ts:945–950 (base)\nother.ts:12");
  expect(
    await readFile(path.join(dir, "01-acme-platform-pr1.md"), "utf8"),
  ).not.toContain("945");
});
it("excludes deterministic fallback hypotheses when AI supplied only the intent", async () => {
  const deps = fixture(heuristicFindings, "Nebius", [
    "Hypothesis generation unavailable; deterministic review priorities retained.",
  ]);
  expect(await evaluate([...args(), "--limit", "1"], signal, deps)).toBe(0);
  expect(
    parseCsv(await readFile(path.join(await runDir(), "labels.csv"), "utf8")),
  ).toEqual([labelColumns]);
});

function scoringFixture() {
  // status, actual comment rank, human reference label, human usefulness verdict.
  const cases = [
    ["verified", "1", "y", "useful"],
    ["path-only", "2", "y", "useful"],
    ["unanchored", "", "y", "false_positive"],
    ["verified", "3", "n", "false_positive"],
    ["path-only", "4", "n", "unclear"],
    ["unanchored", "", "n", "useful"],
    ["not-checked", "", "y", "false_positive"],
    ["path-only", "", "y", "false_positive"],
    ["verified", "1", "n", "useful"],
    ["path-only", "", "n", "false_positive"],
    ["verified", "", "n", "unclear"],
    ["unanchored", "", "y", "false_positive"],
  ];
  const labels = [labelColumns],
    anchors = [anchorColumns];
  cases.forEach(([status, rank, invented, verdict], i) => {
    const pr = url(i < 6 ? 1 : 2),
      key = pr + "#finding-" + ((i % 6) + 1);
    labels.push([
      key,
      pr,
      "AI inference",
      "HIGH",
      "Same title",
      "src/index.ts",
      verdict,
      invented,
      "",
    ]);
    anchors.splice(1, 0, [key, status, rank ? "y" : "n", rank, ""]);
  });
  return { labels, anchors };
}
it("joins twelve verdicts across two PRs by key and scores the guard with exact denominators", () => {
  const { labels, anchors } = scoringFixture();
  const result = score(csv(labels), csv([prColumns]), summary, csv(anchors));
  for (const line of [
    "Shown-only precision: 0.750 (3/4, n=4)",
    "Guard recall: 0.667 (4/6, n=6)",
    "Guard precision: 0.571 (4/7, n=7)",
    "Blind spots: 1",
    "indicative only, n too small for conclusions",
  ])
    expect(result).toContain(line);
});
it("leaves unknown reference labels out of guard precision, including an empty denominator", () => {
  const { labels, anchors } = scoringFixture();
  for (const row of labels.slice(1)) row[7] = "";
  const result = score(csv(labels), csv([prColumns]), summary, csv(anchors));
  expect(result).toContain("Guard precision: n/a (0/0, n=0)");
  expect(result).toContain("Guard recall: n/a (0/0, n=0)");
});
it.each(["missing anchor", "duplicate anchor", "duplicate label"])(
  "returns exit 1 with CSV row numbers for a %s",
  async (fault) => {
    const { labels, anchors } = scoringFixture();
    let error: string;
    if (fault === "missing anchor") {
      anchors.pop();
      error = "labels.csv row 2: no matching finding_key in anchors.csv";
    } else if (fault === "duplicate anchor") {
      anchors.push(anchors[1]);
      error = "anchors.csv row 14: duplicate finding_key (first at row 2)";
    } else {
      labels.push(labels[1]);
      error = "labels.csv row 14: duplicate finding_key (first at row 2)";
    }
    await Promise.all(
      [
        ["labels.csv", csv(labels)],
        ["anchors.csv", csv(anchors)],
        ["prs.csv", csv([prColumns])],
        ["summary.json", JSON.stringify(summary)],
      ].map(([file, value]) => writeFile(path.join(tmp, file), value)),
    );
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect(await evalMain([path.join(tmp, "labels.csv")], signal, true)).toBe(
      1,
    );
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining(error));
    expect(await readdir(tmp)).not.toContain("scores.md");
  },
);
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
