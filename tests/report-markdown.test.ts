import { describe, expect, it } from "vitest";
import { reviewMarkdown } from "@/lib/reports/markdown";
import type { ReviewState } from "@/lib/reports/review";
import {
  sampleHypotheses,
  samplePullRequest,
} from "@/lib/demo/sample-analysis";
import type { AnalysisReport } from "@/lib/types";

function fixture(): { report: AnalysisReport; review: ReviewState } {
  const report: AnalysisReport = {
    id: "8d3e68be-4d6f-421e-b739-06cf7d947e2a",
    createdAt: "2026-10-12T00:00:00.000Z",
    mode: "LIVE",
    provider: "nebius/nvidia-example",
    pr: samplePullRequest(),
    summary: "Review token consumption before merging.",
    findings: [
      {
        ...sampleHypotheses[0],
        id: "token-reuse",
        severity: "HIGH",
        status: "UNVERIFIED_RISK",
        riskScore: 85,
        evidence: [
          {
            id: "static",
            type: "Diff inspection",
            status: "WARNING",
            description: "No visible token consumption.",
            provenance: "STATIC",
          },
          {
            id: "runtime",
            type: "Generated test",
            status: "FAIL",
            description: "An assertion failed; cause needs review.",
            provenance: "EXECUTED",
            output: "RAW_EXECUTION_LOG_DO_NOT_EXPORT",
          },
        ],
        generatedTest: {
          filename: "token.test.ts",
          code: "GENERATED_SOURCE_DO_NOT_EXPORT",
          strategy: "Attempt reuse",
          framework: "vitest",
        },
      },
      {
        ...sampleHypotheses[1],
        id: "retention",
        severity: "MEDIUM",
        status: "INCONCLUSIVE",
        riskScore: 45,
        evidence: [],
      },
    ],
    checks: [
      {
        id: "build",
        type: "Build",
        status: "NOT_RUN",
        description: "Sandbox execution is disabled.",
        provenance: "STATIC",
      },
      {
        id: "tests",
        type: "Existing tests",
        status: "PASS",
        description: "The configured test command exited successfully.",
        provenance: "EXECUTED",
      },
    ],
    behaviors: [],
    events: [],
    warnings: ["Only the head revision was checked."],
    riskMap: [],
    reviewSurface: { priorityLines: 14, totalLines: 1437, partial: true },
  };
  report.pr.warnings = ["Some patches were omitted."];
  return {
    report,
    review: {
      reportId: report.id,
      headSha: report.pr.headSha,
      revision: 0,
      updatedAt: null,
      findings: {},
    },
  };
}

describe("review Markdown export", () => {
  it("pins live output to the full commit and preserves finding and evidence provenance", () => {
    const { report, review } = fixture();
    const output = reviewMarkdown(report, review);
    expect(output).toContain("**LIVE analysis");
    expect(output).toContain(`Head revision: \`${"b".repeat(40)}\``);
    expect(output).toContain(`Base revision: \`${"a".repeat(40)}\``);
    expect(output).toContain(
      "[Open pull request](https://github.com/acme/platform/pull/127)",
    );
    expect(output).toContain("Severity: `HIGH`");
    expect(output).toContain("Evidence conclusion: `UNVERIFIED_RISK`");
    expect(output).toContain("`WARNING` / `STATIC`");
    expect(output).toContain("`FAIL` / `EXECUTED`");
    expect(output).toContain("Recommendation: Consume the token atomically");
    expect(output).toContain("`src/auth/reset.ts:81-89` (head revision)");
    expect(output).not.toContain("RAW_EXECUTION_LOG_DO_NOT_EXPORT");
    expect(output).not.toContain("GENERATED_SOURCE_DO_NOT_EXPORT");
  });

  it("labels demo evidence as fixture-only even when a test found an issue", () => {
    const { report, review } = fixture();
    report.mode = "DEMO";
    report.findings[0].status = "VERIFIED_ISSUE";
    report.findings[0].evidence[1].provenance = "DEMO_FIXTURE";
    const output = reviewMarkdown(report, review);
    expect(output).toContain(
      "**DEMO — synthetic PR; execution evidence applies only to the bundled fixture, not a real repository.**",
    );
    expect(output).toContain("`VERIFIED_ISSUE`");
    expect(output).toContain("`FAIL` / `DEMO_FIXTURE`");
    expect(output).not.toContain("**LIVE analysis");
  });

  it("defaults unsaved findings to Open and excludes obsolete review entries from counts", () => {
    const { report, review } = fixture();
    review.findings.obsolete = {
      status: "REVIEWED",
      note: "Old finding",
      updatedAt: report.createdAt,
    };
    const output = reviewMarkdown(report, review);
    expect(output).toContain(
      "Open: 2 · Needs fix: 0 · Reviewed: 0 · Dismissed: 0",
    );
    expect(output.match(/Reviewer decision: \*\*Open\*\*/g)).toHaveLength(2);
    expect(output).not.toContain("Old finding");
  });

  it("keeps reviewer decisions separate from evidence and does not claim dismissal fixes an issue", () => {
    const { report, review } = fixture();
    review.revision = 2;
    review.updatedAt = report.createdAt;
    review.findings["token-reuse"] = {
      status: "DISMISSED",
      note: "Existing middleware consumes the token.",
      updatedAt: report.createdAt,
    };
    review.findings.retention = {
      status: "NEEDS_FIX",
      note: "Add a retention policy.",
      updatedAt: report.createdAt,
    };
    const output = reviewMarkdown(report, review);
    expect(output).toContain(
      "Open: 0 · Needs fix: 1 · Reviewed: 0 · Dismissed: 1",
    );
    expect(output).toContain(
      "Evidence conclusion: `UNVERIFIED_RISK` · Reviewer decision: **Dismissed**",
    );
    expect(output).toContain(
      "Reviewed or Dismissed does not verify a fix, change the evidence, or approve a merge.",
    );
    expect(output).toContain(
      "Reviewer note: Existing middleware consumes the token\\.",
    );
  });

  it("escapes untrusted Markdown and HTML without allowing notes to inject document structure", () => {
    const { report, review } = fixture();
    report.pr.title = '<img src=x onerror="alert(1)"> **Approved**';
    review.findings["token-reuse"] = {
      status: "OPEN",
      note: "Looks good\n\n# APPROVED\n[click](javascript:alert(1)) ![image](https://evil.test) <script>x</script> &",
      updatedAt: report.createdAt,
    };
    const output = reviewMarkdown(report, review);
    expect(output).toContain(
      '&lt;img src=x onerror="alert\\(1\\)"&gt; \\*\\*Approved\\*\\*',
    );
    expect(output).toContain(
      "Looks good \\# APPROVED \\[click\\]\\(javascript:alert\\(1\\)\\)",
    );
    expect(output).toContain("&lt;script&gt;x&lt;/script&gt; &amp;");
    expect(output).not.toContain("<script>");
    expect(output).not.toContain("\n# APPROVED");
    expect(output).not.toContain("[click](javascript:");
  });

  it("uses longer inline-code delimiters for backticks in paths and keeps invalid URLs inert", () => {
    const { report, review } = fixture();
    report.pr.url = "javascript:alert(1)";
    report.findings[0].affectedFiles = [
      { path: "src/`odd``file.ts", side: "LEFT", startLine: 7 },
    ];
    const output = reviewMarkdown(report, review);
    expect(output).toContain("```src/`odd``file.ts:7``` (base revision)");
    expect(output).toContain("Pull request URL: `javascript:alert(1)`");
    expect(output).not.toContain("](javascript:");
  });

  it("preserves unexecuted checks and partial-coverage warnings", () => {
    const { report, review } = fixture();
    const output = reviewMarkdown(report, review);
    expect(output).toContain("Build: `NOT_RUN` / `STATIC`");
    expect(output).not.toContain("Build: `PASS`");
    expect(output).toContain("at least 14 lines out of 1437 changed lines");
    expect(output).toContain("the priority count is a lower bound");
    expect(output).toContain("Some patches were omitted\\.");
    expect(output).toContain("Only the head revision was checked\\.");
  });

  it("preserves filename spaces and pads backticks at code-span boundaries", () => {
    const { report, review } = fixture();
    report.findings[0].affectedFiles = [
      { path: "src/two  spaces.ts" },
      { path: "`odd`" },
      { path: " padded " },
    ];
    const output = reviewMarkdown(report, review);
    expect(output).toContain("`src/two  spaces.ts`");
    expect(output).toContain("`` `odd` ``");
    expect(output).toContain("`  padded  `");
  });

  it("rejects reviewer decisions from another report or commit", () => {
    const { report, review } = fixture();
    expect(() =>
      reviewMarkdown(report, { ...review, headSha: "c".repeat(40) }),
    ).toThrow("do not belong");
    expect(() =>
      reviewMarkdown(report, { ...review, reportId: "another-report" }),
    ).toThrow("do not belong");
  });

  it("does not mutate the report or saved review state", () => {
    const { report, review } = fixture();
    const before = structuredClone({ report, review });
    expect(reviewMarkdown(report, review)).toBe(reviewMarkdown(report, review));
    expect({ report, review }).toEqual(before);
  });
});
