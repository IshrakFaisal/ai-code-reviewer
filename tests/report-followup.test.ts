import { describe, expect, it } from "vitest";
import {
  sampleHypotheses,
  samplePullRequest,
} from "@/lib/demo/sample-analysis";
import { compareReports, earlierReports } from "@/lib/reports/comparison";
import {
  filterReports,
  reanalysisHref,
  summarizeReport,
} from "@/lib/reports/history";
import type { AnalysisReport } from "@/lib/types";

function fixture(): AnalysisReport {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-10-15T01:00:00.000Z",
    mode: "LIVE",
    provider: "Deterministic analysis",
    pr: samplePullRequest(),
    summary: "Review token reuse.",
    findings: [
      {
        ...structuredClone(sampleHypotheses[0]),
        id: "run-local-1",
        severity: "HIGH",
        riskScore: 80,
        status: "INCONCLUSIVE",
        evidence: [
          {
            id: "old-evidence",
            type: "Generated test",
            status: "FAIL",
            provenance: "EXECUTED",
            description: "Requires assessment.",
            output: "old output",
            durationMs: 100,
          },
        ],
      },
    ],
    checks: [
      {
        id: "build",
        type: "Build",
        status: "PASS",
        provenance: "EXECUTED",
        description: "Build exited successfully.",
      },
    ],
    behaviors: [],
    events: [],
    warnings: [],
    riskMap: [
      {
        category: "AUTHENTICATION",
        level: "HIGH",
        score: 80,
        fileCount: 2,
        connected: [],
      },
    ],
    reviewSurface: { priorityLines: 16, totalLines: 1437, partial: false },
  };
}
function runs() {
  const before = fixture(),
    after = structuredClone(before);
  after.id = "22222222-2222-4222-8222-222222222222";
  after.createdAt = "2026-10-16T01:00:00.000Z";
  after.pr.headSha = "c".repeat(40);
  after.findings[0].id = "run-local-99";
  return { before, after };
}

describe("saved analysis comparison", () => {
  it("offers only earlier runs of the same repository, PR and mode", () => {
    const { before, after } = runs();
    const variants = [
      { ...before, id: "other-mode", mode: "DEMO" as const },
      { ...before, id: "other-repo", pr: { ...before.pr, repo: "different" } },
      {
        ...before,
        id: "other-owner",
        pr: { ...before.pr, owner: "different" },
      },
      { ...before, id: "other-pr", pr: { ...before.pr, number: 128 } },
      { ...before, id: "future", createdAt: "2026-10-17T00:00:00.000Z" },
      { ...before, id: "same-time", createdAt: after.createdAt },
      { ...before, id: "bad-time", createdAt: "invalid" },
      after,
    ];
    before.pr.owner = before.pr.owner.toUpperCase();
    expect(earlierReports(after, [...variants, before])).toEqual([before]);
    for (const variant of variants)
      expect(() => compareReports(variant, after)).toThrow("earlier report");
  });
  it("defaults to the most recent earlier run without mutating history order", () => {
    const { before, after } = runs();
    const older = {
      ...before,
      id: "older",
      createdAt: "2026-10-14T00:00:00.000Z",
    };
    const reports = [older, before];
    expect(earlierReports(after, reports)).toEqual([before, older]);
    expect(reports).toEqual([older, before]);
  });
  it("matches line shifts, reordered paths, title spacing/case and regenerated IDs", () => {
    const { before, after } = runs();
    after.findings[0].title = "  PASSWORD   reset token reuse  ";
    after.findings[0].affectedFiles.reverse().forEach((file) => {
      file.startLine = 500;
      file.endLine = 510;
    });
    after.findings[0].evidence[0] = {
      ...after.findings[0].evidence[0],
      id: "new-evidence",
      output: "different output",
      durationMs: 900,
    };
    const result = compareReports(before, after);
    expect(result.counts).toEqual({ new: 0, repeated: 1, notObserved: 0 });
    expect(result.findings[0].changes).toEqual([]);
  });
  it("keeps reworded, recategorized, moved, differently cased paths and opposite diff sides separate", () => {
    for (const mutate of [
      (report: AnalysisReport) => {
        report.findings[0].title = "Different risk";
      },
      (report: AnalysisReport) => {
        report.findings[0].category = "SECURITY";
      },
      (report: AnalysisReport) => {
        report.findings[0].affectedFiles[0].path = "src/auth/new.ts";
      },
      (report: AnalysisReport) => {
        report.findings[0].affectedFiles[0].path = "SRC/auth/reset.ts";
      },
      (report: AnalysisReport) => {
        report.findings[0].affectedFiles[0].side = "LEFT";
      },
    ]) {
      const { before, after } = runs();
      mutate(after);
      expect(compareReports(before, after).counts).toEqual({
        new: 1,
        repeated: 0,
        notObserved: 1,
      });
    }
  });
  it("does not pair ambiguous duplicates or findings without file grounding", () => {
    const { before, after } = runs();
    before.findings.push({
      ...structuredClone(before.findings[0]),
      id: "duplicate",
    });
    const ambiguous = compareReports(before, after);
    expect(ambiguous.counts).toEqual({ new: 1, repeated: 0, notObserved: 2 });
    expect(ambiguous.warnings.join(" ")).toContain("ambiguous");
    before.findings = [before.findings[0]];
    before.findings[0].affectedFiles = [];
    after.findings[0].affectedFiles = [];
    expect(compareReports(before, after).counts).toEqual({
      new: 1,
      repeated: 0,
      notObserved: 1,
    });
  });
  it("records priority, evidence conclusion, provenance and generated-test changes without upgrading evidence", () => {
    const { before, after } = runs();
    after.findings[0].severity = "MEDIUM";
    after.findings[0].riskScore = 40;
    after.findings[0].status = "UNVERIFIED_RISK";
    after.findings[0].evidence[0].provenance = "STATIC";
    after.findings[0].generatedTest = {
      filename: "token.test.ts",
      code: "expect(token).toBeNull()",
      strategy: "Inspect reuse",
      framework: "vitest",
    };
    const finding = compareReports(before, after).findings[0];
    expect(finding.changes).toEqual([
      "Review priority changed",
      "Evidence conclusion changed",
      "Evidence results or provenance changed",
      "Generated test changed",
    ]);
    expect(finding.after?.status).toBe("UNVERIFIED_RISK");
    after.findings = [];
    const missing = compareReports(before, after);
    expect(missing.findings[0].kind).toBe("NOT_OBSERVED");
    expect(missing.warnings.join(" ")).toContain("not proof of a fix");
  });
  it("flags repeated-head runs, changed base/provider and partial coverage", () => {
    const { before, after } = runs();
    after.pr.headSha = before.pr.headSha;
    after.pr.baseSha = "d".repeat(40);
    after.provider = "Different model";
    after.reviewSurface.partial = true;
    const warnings = compareReports(before, after).warnings.join(" ");
    expect(warnings).toContain("same head commit");
    expect(warnings).toContain("base commit changed");
    expect(warnings).toContain("provider differs");
    expect(warnings).toContain("lower bounds");
  });
  it("shows added, removed, changed and unexecuted checks with their provenance", () => {
    const { before, after } = runs();
    before.checks.push({ ...before.checks[0], id: "old", type: "Old check" });
    after.checks[0].status = "NOT_RUN";
    after.checks[0].provenance = "STATIC";
    after.checks.push({ ...after.checks[0], id: "new", type: "New check" });
    const checks = compareReports(before, after).checks;
    expect(checks).toHaveLength(3);
    expect(checks.every((check) => check.changed)).toBe(true);
    expect(checks[0].before?.status).toBe("PASS");
    expect(checks[0].after?.status).toBe("NOT_RUN");
    expect(checks[1].before).toBeUndefined();
    expect(checks[2].after).toBeUndefined();
  });
  it("does not pair ambiguous checks or checks that moved to different files", () => {
    const { before, after } = runs();
    before.checks.push({ ...before.checks[0], id: "duplicate" });
    expect(
      compareReports(before, after).checks.filter(
        (check) => check.before && check.after,
      ),
    ).toHaveLength(0);
    before.checks = [before.checks[0]];
    after.checks[0].filePaths = ["another.ts"];
    expect(compareReports(before, after).checks).toHaveLength(2);
  });
  it("distinguishes multiple assertions on the same files by their descriptions", () => {
    const { before, after } = runs();
    before.checks = ["Valid token", "Token reuse"].map(
      (description, index) => ({
        id: `old-${index}`,
        type: "Generated test",
        description,
        status: "PASS",
        provenance: "DEMO_FIXTURE",
        filePaths: ["src/auth/reset.ts"],
      }),
    );
    after.checks = structuredClone(before.checks).reverse();
    after.checks[0].id = "new-id";
    after.checks[0].status = "FAIL";
    const changes = compareReports(before, after).checks;
    expect(changes).toHaveLength(2);
    expect(changes[0].before?.description).toBe("Token reuse");
    expect(changes[0].after?.status).toBe("FAIL");
    expect(changes[0].changed).toBe(true);
    expect(changes[1].changed).toBe(false);
  });
  it("shows changed, added and removed risk areas without converting priority to safety", () => {
    const { before, after } = runs();
    after.riskMap[0].score = 90;
    before.riskMap.push({
      category: "DATABASE",
      level: "MEDIUM",
      score: 30,
      fileCount: 1,
      connected: [],
    });
    after.riskMap.push({
      category: "API",
      level: "LOW",
      score: 20,
      fileCount: 1,
      connected: [],
    });
    const changes = compareReports(before, after).riskChanges;
    expect(changes).toHaveLength(3);
    expect(
      changes.find((change) => change.before?.category === "DATABASE")?.after,
    ).toBeUndefined();
    expect(
      changes.find((change) => change.after?.category === "API")?.before,
    ).toBeUndefined();
  });
  it("is deterministic and leaves both immutable report snapshots unchanged", () => {
    const { before, after } = runs();
    const original = structuredClone({ before, after });
    expect(compareReports(before, after)).toEqual(
      compareReports(before, after),
    );
    expect({ before, after }).toEqual(original);
    expect(compareReports(before, after).riskChanges).toEqual([]);
  });
});

describe("history and reruns", () => {
  it("sends only report-list metadata to history controls", () => {
    const report = fixture(),
      summary = summarizeReport(report);
    expect(summary.highFindings).toBe(1);
    expect(Object.keys(summary).sort()).toEqual([
      "createdAt",
      "highFindings",
      "id",
      "mode",
      "pr",
    ]);
    expect(Object.keys(summary.pr).sort()).toEqual([
      "headSha",
      "number",
      "owner",
      "repo",
      "title",
    ]);
    expect(JSON.stringify(summary)).not.toContain("old output");
  });
  it("combines case-insensitive search terms, mode and priority without losing original order", () => {
    const report = fixture(),
      live = summarizeReport(report);
    const demo = {
      ...live,
      id: "demo",
      mode: "DEMO" as const,
      highFindings: 0,
    };
    const filters = {
      query: " ACME/platform  #127 PASSWORD ",
      mode: "ALL" as const,
      priority: "ALL" as const,
    };
    expect(filterReports([live, demo], filters)).toEqual([live, demo]);
    expect(
      filterReports([live, demo], {
        ...filters,
        mode: "LIVE",
        priority: "HIGH",
      }),
    ).toEqual([live]);
    expect(
      filterReports([live, demo], {
        ...filters,
        mode: "DEMO",
        priority: "NO_HIGH",
      }),
    ).toEqual([demo]);
    expect(
      filterReports([live, demo], { ...filters, query: "nonexistent" }),
    ).toEqual([]);
    expect(
      filterReports([live, demo], {
        ...filters,
        query: " ",
        mode: "LIVE",
        priority: "NO_HIGH",
      }),
    ).toEqual([]);
  });
  it("searches commit prefixes and non-English titles", () => {
    const report = fixture();
    report.pr.title = "Исправил ошибку 시지얼";
    const summary = summarizeReport(report),
      filters = {
        query: "ИСПРАВИЛ 시지얼",
        mode: "ALL" as const,
        priority: "ALL" as const,
      };
    expect(filterReports([summary], filters)).toEqual([summary]);
    expect(
      filterReports([summary], {
        ...filters,
        query: report.pr.headSha.slice(0, 9),
      }),
    ).toEqual([summary]);
  });
  it("prefills a canonical live PR URL and keeps demo reruns explicitly synthetic", () => {
    const report = fixture();
    report.pr.url = "https://untrusted.example/ignored";
    const href = new URL(reanalysisHref(report), "http://127.0.0.1:3000");
    expect(href.pathname).toBe("/");
    expect(href.hash).toBe("#analyze");
    expect(href.searchParams.get("input")).toBe(
      "https://github.com/acme/platform/pull/127",
    );
    report.mode = "DEMO";
    expect(reanalysisHref(report)).toBe("/analyze?demo=true");
  });
});
