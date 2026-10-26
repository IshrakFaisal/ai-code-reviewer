import { describe, expect, it } from "vitest";
import {
  sampleHypotheses,
  samplePullRequest,
} from "@/lib/demo/sample-analysis";
import { emptyReviewState } from "@/lib/reports/review";
import { findingHandoff, proposedTestDownload } from "@/lib/reports/handoff";
import {
  verificationGaps,
  filterEvidenceFiles,
  type GapFilters,
} from "@/lib/reports/verification-gaps";
import type { AnalysisReport, Evidence } from "@/lib/types";

function fixture(): AnalysisReport {
  const pr = samplePullRequest();
  pr.files.forEach((file, index) => {
    file.risk = {
      score: index === 0 ? 80 : 0,
      level: index === 0 ? "HIGH" : "LOW",
      reasons: [],
    };
  });
  return {
    id: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-10-19T00:00:00.000Z",
    mode: "LIVE",
    provider: "Deterministic analysis",
    pr,
    summary: "Inspect reset token reuse.",
    findings: [
      {
        ...structuredClone(sampleHypotheses[0]),
        id: "finding-1",
        severity: "HIGH",
        riskScore: 80,
        status: "INCONCLUSIVE",
        evidence: [],
        generatedTest: {
          filename: "token.test.ts",
          framework: "vitest",
          code: "import { expect, it } from 'vitest';\nit('rejects reuse', () => expect(200).toBe(400));\n",
          strategy: "Attempt token reuse.",
        },
      },
    ],
    checks: [],
    behaviors: [],
    events: [],
    warnings: [],
    riskMap: [],
    reviewSurface: { priorityLines: 10, totalLines: 1437, partial: true },
  };
}
function state(report: AnalysisReport) {
  return emptyReviewState({
    id: report.id,
    headSha: report.pr.headSha,
    findingIds: report.findings.map((finding) => finding.id),
  });
}
function evidence(
  report: AnalysisReport,
  changes: Partial<Evidence> = {},
): Evidence {
  return {
    id: "check-1",
    type: "Generated test",
    status: "PASS",
    provenance: "EXECUTED",
    description: "Check token behavior.",
    filePaths: [report.pr.files[0].path],
    ...changes,
  };
}
function firstRow(report: AnalysisReport) {
  return verificationGaps(report).rows.find((row) => row.index === 0)!;
}

describe("file evidence and verification gaps", () => {
  it("does not spread unscoped passes or finding locations across changed files", () => {
    const report = fixture();
    report.checks = [evidence(report, { type: "Build", filePaths: undefined })];
    const gaps = verificationGaps(report);
    expect(gaps.executionLinked).toBe(0);
    expect(gaps.highRiskGaps).toBe(1);
    expect(gaps.unscoped).toHaveLength(1);
    expect(firstRow(report).state).toBe("NO_EVIDENCE");
    expect(firstRow(report).findings[0].id).toBe("finding-1");
  });
  it("counts exact path links and preserves failed or warning execution results", () => {
    const report = fixture();
    report.checks = [evidence(report)];
    expect(firstRow(report).state).toBe("EXECUTION_LINKED");
    expect(verificationGaps(report).highRiskGaps).toBe(0);
    report.checks.push(evidence(report, { id: "warning", status: "WARNING" }));
    expect(firstRow(report).state).toBe("EXECUTION_WARNING");
    report.checks.push(evidence(report, { id: "failed", status: "FAIL" }));
    expect(firstRow(report).state).toBe("EXECUTION_FAILED");
    expect(firstRow(report).hasExecuted).toBe(true);
  });
  it("keeps NOT_RUN and static PASS/FAIL separate from repository execution", () => {
    const report = fixture();
    report.checks = [evidence(report, { status: "NOT_RUN" })];
    expect(firstRow(report).state).toBe("NOT_RUN");
    expect(firstRow(report).hasExecuted).toBe(false);
    report.checks.push(
      evidence(report, { id: "static", provenance: "STATIC", status: "PASS" }),
    );
    expect(firstRow(report).state).toBe("STATIC_ONLY");
    report.checks[1].status = "FAIL";
    expect(firstRow(report).state).toBe("STATIC_ONLY");
    expect(verificationGaps(report).executionLinked).toBe(0);
  });
  it("never treats demo evidence as live repository execution, regardless of the recorded provenance", () => {
    const report = fixture();
    report.mode = "DEMO";
    report.checks = [evidence(report)];
    expect(firstRow(report).state).toBe("FIXTURE_ONLY");
    expect(verificationGaps(report).executionLinked).toBe(0);
    report.mode = "LIVE";
    report.checks[0].provenance = "DEMO_FIXTURE";
    expect(firstRow(report).state).toBe("FIXTURE_ONLY");
    expect(firstRow(report).hasExecuted).toBe(false);
    report.checks[0].status = "NOT_RUN";
    expect(firstRow(report).state).toBe("NOT_RUN");
  });
  it("does not infer case-insensitive, prefix, or outside-file evidence links", () => {
    const report = fixture();
    const path = report.pr.files[0].path;
    report.checks = [
      evidence(report, { filePaths: [path.toUpperCase()] }),
      evidence(report, { id: "prefix", filePaths: [path + ".backup"] }),
    ];
    expect(firstRow(report).state).toBe("NO_EVIDENCE");
    expect(verificationGaps(report).outsideChangedFiles).toHaveLength(2);
  });
  it("deduplicates repeated records across report/finding evidence without collapsing distinct results", () => {
    const report = fixture(),
      record = evidence(report);
    report.checks = [record];
    report.findings[0].evidence = [structuredClone(record)];
    expect(firstRow(report).evidence).toHaveLength(1);
    report.findings[0].evidence.push({ ...record, status: "FAIL" });
    expect(firstRow(report).evidence).toHaveLength(2);
    expect(firstRow(report).state).toBe("EXECUTION_FAILED");
  });
  it("retains patch limitations and original file indexes when ranking by risk", () => {
    const report = fixture();
    report.pr.files[1].risk = {
      score: 90,
      level: "HIGH",
      reasons: ["Higher priority"],
    };
    report.pr.files[1].patch = undefined;
    report.pr.files[1].lines = [];
    const gaps = verificationGaps(report);
    expect(gaps.rows[0].index).toBe(1);
    expect(gaps.rows[0].patchAvailable).toBe(false);
    expect(gaps.rows[0].partialPatch).toBe(true);
    expect(gaps.missingPatches).toBeGreaterThan(0);
  });
  it("filters by combined risk, evidence state, and multi-term path query", () => {
    const report = fixture();
    report.checks = [evidence(report)];
    const rows = verificationGaps(report).rows;
    const filters: GapFilters = {
      query: "SRC reset",
      risk: "HIGH",
      scope: "EXECUTED",
    };
    expect(filterEvidenceFiles(rows, filters).map((row) => row.index)).toEqual([
      0,
    ]);
    expect(filterEvidenceFiles(rows, { ...filters, scope: "GAPS" })).toEqual(
      [],
    );
    report.checks[0].status = "FAIL";
    expect(
      filterEvidenceFiles(verificationGaps(report).rows, {
        ...filters,
        scope: "FAILED",
      }),
    ).toHaveLength(1);
    expect(
      filterEvidenceFiles(rows, {
        query: "nonexistent",
        risk: "ALL",
        scope: "ALL",
      }),
    ).toEqual([]);
  });
  it("filters static, fixture, and absent evidence without conflating them", () => {
    const report = fixture();
    report.checks = [
      evidence(report, { provenance: "STATIC" }),
      evidence(report, {
        id: "demo",
        provenance: "DEMO_FIXTURE",
        filePaths: [report.pr.files[1].path],
      }),
    ];
    const rows = verificationGaps(report).rows,
      defaults: GapFilters = { query: "", risk: "ALL", scope: "ALL" };
    expect(
      filterEvidenceFiles(rows, { ...defaults, scope: "STATIC" }).map(
        (row) => row.index,
      ),
    ).toEqual([0]);
    expect(
      filterEvidenceFiles(rows, { ...defaults, scope: "FIXTURE" }).map(
        (row) => row.index,
      ),
    ).toEqual([1]);
    expect(
      filterEvidenceFiles(rows, { ...defaults, scope: "NONE" }),
    ).toHaveLength(rows.length - 2);
  });
  it("does not mutate saved reports or copy raw execution output into file summaries", () => {
    const report = fixture();
    report.checks = [evidence(report, { output: "RAW_EXECUTION_LOG" })];
    const original = structuredClone(report);
    const gaps = verificationGaps(report);
    expect(report).toEqual(original);
    expect(JSON.stringify(gaps.rows)).not.toContain("RAW_EXECUTION_LOG");
    expect(verificationGaps(report)).toEqual(gaps);
  });
});

describe("finding handoff and test proposal downloads", () => {
  it("pins a focused live draft to both commits and preserves saved decisions and evidence", () => {
    const report = fixture(),
      review = state(report);
    report.findings[0].evidence = [
      evidence(report, { status: "FAIL", output: "RAW_LOG" }),
    ];
    review.findings["finding-1"] = {
      status: "NEEDS_FIX",
      note: "Check token consumption atomically.",
      updatedAt: report.createdAt,
    };
    const output = findingHandoff(report, "finding-1", review);
    expect(output).toContain(report.pr.headSha);
    expect(output).toContain(report.pr.baseSha);
    expect(output).toContain("`INCONCLUSIVE`");
    expect(output).toContain("`FAIL` / `EXECUTED`");
    expect(output).toContain("**Needs fix**");
    expect(output).toContain("Check token consumption atomically");
    expect(output).toContain("- [ ] Inspect the proposed test");
    expect(output).toContain("Diff coverage is partial");
    expect(output).not.toContain("RAW_LOG");
    expect(output).not.toContain(report.findings[0].generatedTest!.code);
  });
  it("keeps fixture evidence visibly synthetic and reviewer dismissal separate from verification", () => {
    const report = fixture(),
      review = state(report);
    report.mode = "DEMO";
    review.findings["finding-1"].status = "DISMISSED";
    const output = findingHandoff(report, "finding-1", review);
    expect(output).toContain("DEMO — synthetic PR");
    expect(output).toContain("**Dismissed**");
    expect(output).toContain(
      "do not change evidence, verify a fix, or approve a merge",
    );
    expect(output).toContain("not posted to GitHub");
  });
  it("rejects unrelated finding IDs and stale/foreign review states", () => {
    const report = fixture(),
      review = state(report);
    expect(() => findingHandoff(report, "unknown", review)).toThrow(
      "does not belong",
    );
    expect(() => proposedTestDownload(report, "unknown")).toThrow(
      "does not belong",
    );
    expect(() =>
      findingHandoff(report, "finding-1", { ...review, reportId: "another" }),
    ).toThrow("do not belong");
    expect(() =>
      findingHandoff(report, "finding-1", {
        ...review,
        headSha: "c".repeat(40),
      }),
    ).toThrow("do not belong");
  });
  it("escapes untrusted Markdown, HTML, file names, and unsafe URL schemes", () => {
    const report = fixture(),
      review = state(report);
    report.findings[0].title = "<script>x</script>\n# APPROVED";
    report.findings[0].affectedFiles = [
      { path: "src/`odd``.ts", side: "LEFT", startLine: 5 },
    ];
    report.pr.url = "javascript:alert(1)";
    review.findings["finding-1"].note =
      "[click](javascript:alert(1))\n\n# DONE";
    const output = findingHandoff(report, "finding-1", review);
    expect(output).not.toContain("<script>");
    expect(output).not.toContain("\n# APPROVED");
    expect(output).not.toContain("[click](javascript:");
    expect(output).toContain("&lt;script&gt;");
    expect(output).toContain("```src/`odd``.ts:5``` (base revision)");
    expect(output).toContain("Pull request URL: `javascript:alert(1)`");
  });
  it("handles findings without tests, evidence, saved notes, or file references", () => {
    const report = fixture(),
      review = state(report);
    report.findings[0].generatedTest = undefined;
    report.findings[0].affectedFiles = [];
    delete review.findings["finding-1"];
    const output = findingHandoff(report, "finding-1", review);
    expect(output).toContain("**Needs review**");
    expect(output).toContain("No affected file references");
    expect(output).toContain("No evidence recorded");
    expect(output).toContain("No test proposal");
    expect(output).toContain("No saved note");
    expect(proposedTestDownload(report, "finding-1")).toBeNull();
  });
  it("downloads exact recorded source while removing directories and reserved filename risks", () => {
    const report = fixture();
    report.findings[0].generatedTest!.filename = "../../CON.test.ts";
    const proposal = proposedTestDownload(report, "finding-1")!;
    expect(proposal.filename).toBe("change-verifier-pr-127-CON.test.ts");
    expect(proposal.code).toBe(report.findings[0].generatedTest!.code);
    expect(proposal.filename).not.toMatch(/[\\/]/);
    report.findings[0].generatedTest!.filename = "C:\\temp\\unsafe.test.js.exe";
    expect(proposedTestDownload(report, "finding-1")?.filename).toBe(
      "change-verifier-pr-127-proposal.test.ts",
    );
  });
  it("bounds download names and refuses empty test proposals", () => {
    const report = fixture();
    report.findings[0].generatedTest!.filename = "x".repeat(500) + ".test.ts";
    expect(
      proposedTestDownload(report, "finding-1")!.filename.length,
    ).toBeLessThan(140);
    report.findings[0].generatedTest!.code = " \n";
    expect(proposedTestDownload(report, "finding-1")).toBeNull();
  });
  it("keeps report evidence and review decisions unchanged across exports", () => {
    const report = fixture(),
      review = state(report),
      original = structuredClone({ report, review });
    expect(findingHandoff(report, "finding-1", review)).toBe(
      findingHandoff(report, "finding-1", review),
    );
    proposedTestDownload(report, "finding-1");
    expect({ report, review }).toEqual(original);
  });
});
