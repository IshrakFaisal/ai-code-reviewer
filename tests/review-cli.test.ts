import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { review } from "../scripts/review-cli";
import { AnalysisRuns } from "@/lib/agent/runs";
import { analysisRunStore } from "@/lib/agent/run-store";
import { reportStore } from "@/lib/reports/store";
import { validateReport } from "@/lib/reports/schema";

const exec = promisify(execFile);
let directory: string;
let runs: AnalysisRuns;
let reports: ReturnType<typeof reportStore>;
const token = "cli-test-github-token",
  key = "cli-test-inference-key";
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "change-verifier-cli-"));
  reports = reportStore(path.join(directory, ".data", "reports"));
  runs = new AnalysisRuns(
    analysisRunStore(path.join(directory, ".data", "runs")),
    undefined,
    reports.save,
  );
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function call(
  args: string[],
  interruptOnStart = false,
  timeoutMs = 280000,
) {
  vi.stubEnv("DEMO_MODE", "true");
  vi.stubEnv("GITHUB_TOKEN", token);
  vi.stubEnv("NEBIUS_API_KEY", key);
  let stdout = "",
    stderr = "";
  const interrupt = new AbortController();
  const code = await review(args, interrupt.signal, {
    runs,
    read: reports.get,
    timeoutMs,
    stdout: (s) => {
      stdout += s;
      return true;
    },
    stderr: (s) => {
      stderr += s;
      if (interruptOnStart && s.startsWith("Run ")) interrupt.abort();
      return true;
    },
  });
  for (const secret of [key, token])
    expect(stdout + stderr).not.toContain(secret);
  return { code, stdout, stderr, id: /^Run ([a-f0-9-]+)/m.exec(stderr)?.[1] };
}
it.each([
  ["invalid"],
  ["https://example.com/team/repo/pull/1"],
  ["https://github.com/team/repo/pull/1"],
  [],
  ["--demo", "--format", "xml"],
  ["--demo", "--fail-on", "critical"],
  ["--demo", "--out"],
  [token],
])("rejects invalid input with a single diagnostic (%#)", async (...args) => {
  const result = await call(args);
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr.trim().split("\n")).toHaveLength(1);
});
it("pauses an interrupted investigation on disk before returning 130", async () => {
  const result = await call(["--demo"], true);
  expect(result.code).toBe(130);
  expect((await runs.get(result.id!)).status).toBe("PAUSED");
});
it("pauses a timed out investigation and returns 2", async () => {
  const result = await call(["--demo"], false, 100);
  expect(result.code).toBe(2);
  expect((await runs.get(result.id!)).status).toBe("PAUSED");
});
it("writes BOM-free UTF-8 before returning a high-priority exit", async () => {
  const filename = path.join(directory, "review.md");
  const result = await call([
    "--demo",
    "--out",
    filename,
    "--quiet",
    "--fail-on",
    "high",
  ]);
  expect(result.code).toBe(3);
  expect(result.stdout).toBe("");
  expect(result.stderr.trim()).toBe("Run " + result.id);
  const bytes = await readFile(filename);
  expect(bytes.subarray(0, 3).toString("ascii")).toBe("###");
  expect(bytes.toString("utf8")).toContain("Verifier — PR #127");
}, 20000);
it("launches the CLI headlessly and returns the exact saved report as JSON", async () => {
  const { stdout, stderr } = await exec(
    process.execPath,
    [
      path.resolve("scripts/review.mjs"),
      "--demo",
      "--format",
      "json",
      "--fail-on",
      "none",
    ],
    {
      cwd: directory,
      env: {
        ...process.env,
        DEMO_MODE: "true",
        GITHUB_TOKEN: token,
        NEBIUS_API_KEY: key,
      },
      timeout: 60000,
      windowsHide: true,
    },
  );
  for (const secret of [key, token])
    expect(stdout + stderr).not.toContain(secret);
  const report = JSON.parse(stdout);
  expect(validateReport(report)).toEqual(report);
  expect(report.mode).toBe("DEMO");
  expect(await reports.get(report.id)).toEqual(report);
  expect(stderr).toContain("Run " + report.id);
}, 65000);
