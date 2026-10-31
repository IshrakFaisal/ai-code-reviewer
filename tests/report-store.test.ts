import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  open,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { reportStore, MAX_REPORT_BYTES } from "@/lib/reports/store";
import { validateReport } from "@/lib/reports/schema";
import {
  samplePullRequest,
  sampleHypotheses,
} from "@/lib/demo/sample-analysis";
import type { AnalysisReport } from "@/lib/types";

function fixture(): AnalysisReport {
  return {
    id: randomUUID(),
    createdAt: "2026-10-29T00:00:00.000Z",
    mode: "LIVE",
    provider: "Deterministic analysis",
    pr: samplePullRequest(),
    summary: "Review token handling.",
    findings: [
      {
        ...structuredClone(sampleHypotheses[0]),
        id: "finding-1",
        severity: "HIGH",
        riskScore: 80,
        status: "UNVERIFIED_RISK",
        evidence: [],
      },
    ],
    checks: [
      {
        id: "build",
        type: "Build",
        status: "NOT_RUN",
        provenance: "EXECUTED",
        description: "Execution unavailable.",
      },
    ],
    behaviors: [],
    events: [],
    warnings: [],
    riskMap: [],
    reviewSurface: { priorityLines: 0, totalLines: 1437, partial: true },
  };
}

describe("analysis report validation", () => {
  it("reads legacy and versioned reports without changing their evidence", () => {
    const report = fixture();
    expect(validateReport(report)).toEqual(report);
    expect(validateReport({ ...report, schemaVersion: 1 }, report.id)).toEqual(
      report,
    );
    expect(validateReport({ ...report, schemaVersion: 2 })).toBeNull();
    expect(validateReport(report, randomUUID())).toBeNull();
  });

  it.each([
    [
      "timestamp",
      (r: AnalysisReport) => {
        r.createdAt = "2026-02-30T00:00:00Z";
      },
    ],
    [
      "nested PR",
      (r: AnalysisReport) => {
        Reflect.deleteProperty(r.pr, "files");
      },
    ],
    [
      "category",
      (r: AnalysisReport) => {
        Reflect.set(r.pr.files[0], "categories", ["INVENTED"]);
      },
    ],
    [
      "finding status",
      (r: AnalysisReport) => {
        Reflect.set(r.findings[0], "status", "SAFE");
      },
    ],
    [
      "evidence provenance",
      (r: AnalysisReport) => {
        Reflect.deleteProperty(r.checks[0], "provenance");
      },
    ],
    [
      "diff line",
      (r: AnalysisReport) => {
        r.pr.files[0].lines[0].line = -1;
      },
    ],
    [
      "risk",
      (r: AnalysisReport) => {
        r.pr.files[0].risk.score = Infinity;
      },
    ],
    [
      "counts",
      (r: AnalysisReport) => {
        r.pr.additions = 0.5;
      },
    ],
    [
      "duplicate finding IDs",
      (r: AnalysisReport) => {
        r.findings.push(structuredClone(r.findings[0]));
      },
    ],
    [
      "duplicate file paths",
      (r: AnalysisReport) => {
        r.pr.files.push(structuredClone(r.pr.files[0]));
      },
    ],
    [
      "reversed line range",
      (r: AnalysisReport) => {
        r.findings[0].affectedFiles[0] = {
          path: r.pr.files[0].path,
          startLine: 10,
          endLine: 1,
        };
      },
    ],
    [
      "unsafe PR URL",
      (r: AnalysisReport) => {
        r.pr.url = "javascript:alert(1)";
      },
    ],
    [
      "wrong PR URL",
      (r: AnalysisReport) => {
        r.pr.url = "https://github.com/other/repo/pull/123";
      },
    ],
    [
      "revision",
      (r: AnalysisReport) => {
        r.pr.headSha = "main";
      },
    ],
    [
      "review totals",
      (r: AnalysisReport) => {
        r.reviewSurface.priorityLines = 10000;
      },
    ],
    [
      "oversized output",
      (r: AnalysisReport) => {
        r.checks[0].output = "x".repeat(256001);
      },
    ],
  ])("rejects malformed %s", (_label, mutate) => {
    const report = fixture();
    mutate(report);
    expect(validateReport(report)).toBeNull();
  });

  it("accepts partial/no patch context, empty findings and fractional configured risk weights", () => {
    const report = fixture();
    report.findings = [];
    report.pr.files[0].patch = undefined;
    report.pr.files[0].lines = [];
    report.pr.files[0].risk.score = 25.5;
    report.checks[0].output = "x".repeat(256000);
    report.checks[0].description = "Environment references ".repeat(1500);
    expect(validateReport(report)).toEqual(report);
    report.pr.files = [];
    expect(validateReport(report)).toEqual(report);
  });
});

describe("saved report isolation", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "verifier-report-store-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const filename = (directory: string, id: string) =>
    path.join(directory, `${id}.json`);

  it("keeps healthy history visible beside malformed JSON, invalid shapes and mismatched identities", async () => {
    const report = fixture(),
      badJson = randomUUID(),
      badShape = randomUUID(),
      wrongId = randomUUID();
    await writeFile(filename(directory, report.id), JSON.stringify(report));
    await writeFile(filename(directory, badJson), "{");
    await writeFile(
      filename(directory, badShape),
      JSON.stringify({ id: badShape }),
    );
    await writeFile(filename(directory, wrongId), JSON.stringify(report));
    const store = reportStore(directory);
    const result = await store.list();
    expect(result.reports).toEqual([report]);
    expect(result.issues.map((issue) => issue.id).sort()).toEqual(
      [badJson, badShape, wrongId].sort(),
    );
    expect(result.issues.every((issue) => issue.reason === "INVALID")).toBe(
      true,
    );
    expect(result.unavailable).toBe(false);
    expect(await store.get(badShape)).toBeNull();
    expect(await readFile(filename(directory, badJson), "utf8")).toBe("{");
  });

  it("rejects oversized files before reading and keeps unreadable entries separate", async () => {
    const large = randomUUID(),
      unreadable = randomUUID();
    const handle = await open(filename(directory, large), "w");
    try {
      await handle.truncate(MAX_REPORT_BYTES + 1);
    } finally {
      await handle.close();
    }
    await mkdir(filename(directory, unreadable));
    const result = await reportStore(directory).list();
    expect(result.issues).toEqual(
      expect.arrayContaining([
        { id: large, reason: "TOO_LARGE" },
        { id: unreadable, reason: "UNREADABLE" },
      ]),
    );
    expect(result.reports).toEqual([]);
  });

  it("distinguishes an absent store from an inaccessible store and ignores non-report files", async () => {
    expect(await reportStore(path.join(directory, "missing")).list()).toEqual({
      reports: [],
      issues: [],
      unavailable: false,
    });
    const notDirectory = path.join(directory, "file");
    await writeFile(notDirectory, "content");
    expect((await reportStore(notDirectory).list()).unavailable).toBe(true);
    await writeFile(path.join(directory, `${randomUUID()}.json.tmp`), "{");
    await writeFile(path.join(directory, "unrelated.json"), "{");
    const store = reportStore(directory);
    expect(await store.list()).toEqual({
      reports: [],
      issues: [],
      unavailable: false,
    });
    expect(await store.load("../file")).toEqual({ report: null });
    expect(await store.load(randomUUID())).toEqual({ report: null });
  });

  it("writes versioned reports and preserves an existing valid report when a save fails validation", async () => {
    const store = reportStore(directory),
      report = fixture();
    await store.save(report);
    const saved = await readFile(filename(directory, report.id), "utf8");
    expect(JSON.parse(saved).schemaVersion).toBe(1);
    expect(await store.get(report.id)).toEqual(report);
    report.createdAt = "bad date";
    await expect(store.save(report)).rejects.toThrow("failed validation");
    expect(await readFile(filename(directory, report.id), "utf8")).toBe(saved);
    expect(
      (await readdir(directory)).filter((file) => file.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("sorts by actual timestamp with deterministic ties", async () => {
    const first = fixture(),
      second = fixture();
    first.createdAt = "2026-10-29T01:00:00+06:00";
    second.createdAt = "2026-10-28T20:00:00Z";
    for (const report of [first, second])
      await writeFile(filename(directory, report.id), JSON.stringify(report));
    expect(
      (await reportStore(directory).list()).reports.map((r) => r.id),
    ).toEqual([second.id, first.id]);
  });

  it("retains the newest 100 valid reports even with malformed records present", async () => {
    const report = fixture(),
      bad = randomUUID();
    const old = Array.from({ length: 101 }, (_, index) => ({
      ...report,
      id: randomUUID(),
      createdAt: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
    }));
    await Promise.all(
      old.map((entry) =>
        writeFile(filename(directory, entry.id), JSON.stringify(entry)),
      ),
    );
    await writeFile(filename(directory, bad), "{}");
    const store = reportStore(directory);
    await store.save(report);
    const result = await store.list();
    expect(result.reports).toHaveLength(100);
    expect(result.reports[0].id).toBe(report.id);
    expect(await store.get(old[0].id)).toBeNull();
    expect(await store.get(old[1].id)).toBeNull();
    expect(result.issues).toEqual([{ id: bad, reason: "INVALID" }]);
    expect(await readFile(filename(directory, bad), "utf8")).toBe("{}");
  });
});
