import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { githubClient } from "@/lib/github/client";
import { parseGitHubInput } from "@/lib/github/input";
import { validateReport } from "@/lib/reports/schema";
import { buildPrComment, reportPriorityScore } from "@/lib/reports/pr-comment";
import { riskLevel } from "@/lib/risk/engine";
import { review } from "./review-cli";
import { canonicalUrl, EvalError, parseUrls, sample } from "./eval-sample";
import {
  csv,
  labelColumns,
  prColumns,
  scoreFile,
  summarySchema,
  type Summary,
} from "./eval-score";

function options(args: string[]) {
  const { values: v } = parseArgs({
    args,
    options: {
      urls: { type: "string" },
      "sample-merged": { type: "string" },
      "sample-reverted": { type: "string" },
      run: { type: "boolean" },
      "dry-run": { type: "boolean" },
      "allow-execution": { type: "boolean" },
      limit: { type: "string" },
      scan: { type: "string" },
      "min-lines": { type: "string" },
      "max-lines": { type: "string" },
      "max-files": { type: "string" },
      "delay-ms": { type: "string" },
    },
  });
  if (
    [v.urls, v["sample-merged"], v["sample-reverted"]].filter(Boolean)
      .length !== 1
  )
    throw new EvalError("Select one URL file or one sampling mode.");
  function integer(
    raw: string | undefined,
    fallback: number,
    min: number,
    max: number,
  ) {
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < min || n > max)
      throw new EvalError(`Expected an integer between ${min} and ${max}.`);
    return n;
  }
  const minLines = integer(v["min-lines"], 10, 0, Number.MAX_SAFE_INTEGER);
  const maxLines = integer(v["max-lines"], 400, 0, Number.MAX_SAFE_INTEGER);
  if (maxLines < minLines)
    throw new EvalError("max-lines must be at least min-lines.");
  return {
    urls: v.urls,
    repository: v["sample-merged"] ?? v["sample-reverted"],
    reverted: !!v["sample-reverted"],
    analyze: !!(v.urls || v.run) && !v["dry-run"],
    dry: !!v["dry-run"],
    allowExecution: !!v["allow-execution"],
    delayMs: integer(v["delay-ms"], 2000, 0, 2147483647),
    limit: integer(v.limit, 10, 1, 25),
    minLines,
    maxLines,
    maxFiles: integer(v["max-files"], 30, 1, Number.MAX_SAFE_INTEGER),
    scan: integer(v.scan, 60, 1, 1000),
  };
}
function guard(acknowledged: boolean) {
  if (process.env.DEMO_MODE !== "false")
    throw new EvalError(
      "Set DEMO_MODE=false before sampling or reviewing public PRs.",
    );
  const enabled =
    (process.env.SANDBOX_PROVIDER &&
      process.env.SANDBOX_PROVIDER !== "disabled") ||
    [
      "ENABLE_LOCAL_SANDBOX",
      "ENABLE_NEBIUS_SANDBOX",
      "ENABLE_PRODUCTION_SANDBOX",
    ].some((k) => process.env[k] === "true") ||
    ["LOCAL_SANDBOX_REPOSITORIES", "NEBIUS_SANDBOX_REPOSITORIES"].some((k) =>
      process.env[k]?.trim(),
    );
  if (enabled && !acknowledged)
    throw new EvalError(
      "Execution settings detected. Clear them or acknowledge them with --allow-execution.",
    );
}
function assertPublic(text: string) {
  for (const [name, value] of Object.entries(process.env)) {
    if (
      value &&
      /(?:TOKEN|PASSWORD|API_KEY|SECRET)$/i.test(name) &&
      (text.includes(value) ||
        text.includes(JSON.stringify(value).slice(1, -1)))
    )
      throw new EvalError(
        "Evaluation output contains a configured credential.",
      );
  }
}
function sheetText(value: string) {
  // Quoting alone does not prevent a spreadsheet from evaluating imported PR text.
  return /^[\s]*[=+@-]|^[\t\r]/.test(value) ? "'" + value : value;
}
function findingsForSheet(
  report: NonNullable<ReturnType<typeof validateReport>>,
  comment: string,
  url: string,
) {
  const rows = [
    ...comment.matchAll(/^\d+\. \*\*(LOW|MEDIUM|HIGH) · ([^*]+)\*\*:/gm),
  ];
  const ordered = [...report.findings].sort(
    (a, b) => b.riskScore - a.riskScore,
  );
  return rows.map((match, i) => {
    const f = ordered[i],
      ref = f.affectedFiles[0];
    const location = ref
      ? ref.path + (ref.startLine ? ":" + ref.startLine : "")
      : "";
    return [
      url,
      match[2],
      match[1],
      sheetText(f.title),
      sheetText(location),
      "",
      "",
      "",
    ];
  });
}

export async function evaluate(
  args: string[],
  signal: AbortSignal,
  {
    github = githubClient(),
    runReview = review,
    root = "eval-output",
    log = (s: string) => {
      process.stdout.write(s + "\n");
    },
  } = {},
) {
  const o = options(args);
  guard(o.allowExecution);
  const model = (process.env.NEBIUS_MODEL || "")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .trim();
  const ai = !!(process.env.NEBIUS_API_KEY && model);
  const configuration = `AI ${ai ? "on" : "off"} · model ${model || "(unset)"} · GITHUB_TOKEN ${process.env.GITHUB_TOKEN ? "set" : "unset (unauthenticated limits are low)"}`;
  assertPublic(configuration);
  log(configuration);
  const selected = o.urls
    ? parseUrls(await readFile(o.urls, "utf8")).slice(0, o.limit)
    : await sample(github, o.repository!, o.reverted, o, signal);
  for (const c of selected) {
    assertPublic(c.url);
    assertPublic(c.revertedBy);
  }
  const dir = path.join(root, new Date().toISOString().replaceAll(":", "-"));
  await mkdir(root, { recursive: true });
  await mkdir(dir);
  async function save(name: string, text: string) {
    assertPublic(text);
    await writeFile(path.join(dir, name), text, "utf8");
  }
  await save(
    "urls.txt",
    selected
      .map(
        (c) => c.url + (c.revertedBy ? " # reverted by " + c.revertedBy : ""),
      )
      .join("\n") + "\n",
  );
  log(dir);
  if (!o.analyze) {
    for (const c of selected) {
      signal.throwIfAborted();
      if (c.files === null && o.dry) {
        const { owner, repo, number } = parseGitHubInput(c.url);
        const { data } = await github.rest.pulls.get({
          owner,
          repo,
          pull_number: number,
          request: { signal },
        });
        if (data.base.repo.private !== false)
          throw new EvalError("Evaluation requires a public repository.");
        c.files = data.changed_files;
        c.lines = data.additions + data.deletions;
      }
      log(`${c.url}  ${c.files} files  ${c.lines} lines`);
    }
    return 0;
  }

  const summary: Summary = {
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    ai,
    model,
    selected: selected.length,
    attempts: [],
  };
  const labels = [labelColumns],
    prs = [prColumns];
  const index = [
    "# PR evaluation",
    "",
    "| PR | Files | Lines | Priority (score) | Duration (ms) | Exit | Findings shown | Comment |",
    "|---|---:|---:|---|---:|---:|---|---|",
  ];
  async function checkpoint() {
    await save(
      "summary.json",
      JSON.stringify(summarySchema.parse(summary), null, 2) + "\n",
    );
    await save("index.md", index.join("\n") + "\n");
    await save("labels.csv", csv(labels));
    await save("prs.csv", csv(prs));
  }
  await checkpoint();
  let failures = 0;
  for (const [i, c] of selected.entries()) {
    if (signal.aborted) return 130;
    if (i && o.delayMs) await delay(o.delayMs, undefined, { signal });
    const start = performance.now();
    let raw = "",
      exit: number = 2;
    // Even an acknowledged ambient allowlist must not execute reviewed code.
    const provider = process.env.SANDBOX_PROVIDER;
    process.env.SANDBOX_PROVIDER = "disabled";
    try {
      exit = await runReview([c.url, "--format", "json", "--quiet"], signal, {
        stdout: (s) => {
          raw += s;
          return true;
        },
        stderr: () => true,
      });
    } catch {
      exit = signal.aborted ? 130 : 2;
    } finally {
      if (provider === undefined) delete process.env.SANDBOX_PROVIDER;
      else process.env.SANDBOX_PROVIDER = provider;
    }
    const durationMs = Math.round(performance.now() - start);
    let priority = "—",
      link = "—",
      rows: string[][] = [];
    if (exit === 0 || exit === 3) {
      try {
        assertPublic(raw);
        const report = validateReport(JSON.parse(raw));
        if (
          !report ||
          report.mode !== "LIVE" ||
          canonicalUrl(report.pr.url) !== c.url
        )
          throw new Error();
        const comment = buildPrComment(report, null);
        rows = findingsForSheet(report, comment, c.url);
        const score = reportPriorityScore(report);
        priority = `${riskLevel(score)} (${score})`;
        c.files = report.pr.changedFiles;
        c.lines = report.pr.additions + report.pr.deletions;
        const { owner, repo, number } = parseGitHubInput(c.url);
        const file = `${String(i + 1).padStart(2, "0")}-${owner}-${repo}-pr${number}.md`;
        await save(file, comment + "\n");
        link = `[Comment](${file})`;
      } catch (error) {
        if (error instanceof EvalError) throw error;
        if ((error as NodeJS.ErrnoException).code) throw error;
        exit = 2;
        rows = [];
      }
    }
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row[1], (counts.get(row[1]) ?? 0) + 1);
    const breakdown =
      [...counts].map(([k, v]) => k + ": " + v).join(", ") ||
      (exit === 0 || exit === 3 ? "0" : "—");
    index.push(
      `| [${c.url.split("/").slice(3, 5).join("/")}#${c.url.split("/").at(-1)}](${c.url}) | ${c.files ?? "—"} | ${c.lines ?? "—"} | ${priority} | ${durationMs} | ${exit} | ${breakdown} | ${link} |`,
    );
    labels.push(...rows);
    prs.push([c.url, c.revertedBy, "", "", ""]);
    summary.attempts.push({
      url: c.url,
      durationMs,
      exitCode: exit,
      findings: rows.length,
    });
    await checkpoint();
    if (exit === 130 || signal.aborted) return 130;
    failures = exit === 0 || exit === 3 ? 0 : failures + 1;
    if (failures === 3) {
      log("Stopped after three consecutive review failures.");
      return 2;
    }
  }
  return summary.attempts.some((a) => a.exitCode !== 0 && a.exitCode !== 3)
    ? 2
    : 0;
}

export async function evalMain(
  args: string[],
  signal: AbortSignal,
  scoring: boolean,
) {
  try {
    if (!scoring) return await evaluate(args, signal);
    if (args.length !== 1) throw new EvalError("Pass the path to labels.csv.");
    process.stdout.write(await scoreFile(args[0]));
    return 0;
  } catch (error) {
    if (signal.aborted) return 130;
    process.stderr.write(
      (error instanceof EvalError
        ? error.message
        : "Evaluation failed. Check arguments, input files and GitHub access.") +
        "\n",
    );
    return 1;
  }
}
