import { describe, expect, it } from "vitest";
import {
  sampleHypotheses,
  samplePullRequest,
} from "@/lib/demo/sample-analysis";
import type { AnalysisReport } from "@/lib/types";
import {
  analysisMarkdown,
  readableReport,
  reportExportFilename,
} from "@/lib/reports/readable-export";
import { createReportPdf, reportPdfDefinition } from "@/lib/reports/pdf-export";

function fixture(): AnalysisReport {
  return {
    id: "demo",
    createdAt: "2026-10-30T09:00:00Z",
    mode: "DEMO",
    provider: "Demo fixture",
    pr: samplePullRequest(),
    summary: "Review password reset behavior before merging.",
    findings: [
      {
        ...sampleHypotheses[0],
        id: "finding-1",
        severity: "HIGH",
        riskScore: 90,
        status: "VERIFIED_ISSUE",
        evidence: [
          {
            id: "test-1",
            type: "Generated test",
            status: "FAIL",
            provenance: "DEMO_FIXTURE",
            description: "A reset token was accepted twice.",
            output: "RAW_LOG_NOT_IN_READABLE_EXPORT",
          },
        ],
        generatedTest: {
          filename: "reset.test.ts",
          code: "SOURCE_NOT_IN_READABLE_EXPORT",
          strategy: "Reuse the token",
          framework: "vitest",
        },
      },
    ],
    checks: [
      {
        id: "build",
        type: "Build",
        status: "NOT_RUN",
        provenance: "STATIC",
        description: "No repository sandbox was configured.",
      },
    ],
    behaviors: [],
    events: [],
    warnings: ["Partial analysis context."],
    riskMap: [],
    reviewSurface: { priorityLines: 10, totalLines: 20, partial: true },
  };
}

describe("portable report exports", () => {
  it("includes scope, conclusions, finding-only evidence, and limits without raw logs or invented review decisions", () => {
    const report = fixture();
    const content = analysisMarkdown(report);
    expect(content).toContain("Synthetic pull request");
    expect(content).toContain("Verified issue in demo fixture");
    expect(content).toContain("A reset token was accepted twice");
    expect(content).toContain("NOT RUN");
    expect(content).toContain("Partial analysis context");
    expect(content).toContain("lower bound");
    expect(content).not.toContain("RAW_LOG_NOT_IN_READABLE_EXPORT");
    expect(content).not.toContain("SOURCE_NOT_IN_READABLE_EXPORT");
    expect(content).toContain("separate exports");
    expect(reportExportFilename(report, "pdf")).toMatch(/\.pdf$/);
    expect(reportExportFilename(report, "md")).toMatch(/\.md$/);
  });
  it("escapes untrusted Markdown and uses inert text in the PDF definition", () => {
    const report = fixture();
    report.pr.title = "<script>alert(1)</script> [click](javascript:alert(1))";
    report.summary = "Summary\n# Injected heading";
    const md = analysisMarkdown(report);
    expect(md).not.toContain("<script>");
    expect(md).not.toContain("\n# Injected");
    expect(md).not.toContain("[click](javascript:");
    const definition = JSON.stringify(reportPdfDefinition(report));
    expect(definition).not.toContain('"html":');
    expect(definition).not.toContain('"link":');
    expect(readableReport(report).title).toBe(report.pr.title);
  });
  it("handles an empty live report without claiming verification", () => {
    const report = fixture();
    report.mode = "LIVE";
    report.findings = [];
    report.checks = [];
    const md = analysisMarkdown(report);
    expect(md).toContain("No findings were recorded");
    expect(md).toContain("No verification checks were recorded");
    expect(md).toContain("recorded commits only");
    expect(md).not.toContain("Synthetic pull request");
  });
  it("creates a real paginated PDF with the browser engine and embedded fonts", async () => {
    const report = fixture();
    report.pr.title = "Résumé: café and naïve token checks";
    report.findings = Array.from({ length: 12 }, (_, i) => ({
      ...report.findings[0],
      id: `finding-${i}`,
      title: `Finding ${i + 1}`,
      affectedFiles: [
        { path: "src/" + "very-long-component-name/".repeat(20) + "reset.ts" },
      ],
    }));
    const blob = await createReportPdf(report);
    expect(blob.type).toBe("application/pdf");
    const bytes = Buffer.from(await blob.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(
      bytes.toString("latin1").match(/\/Type \/Page\b/g)!.length,
    ).toBeGreaterThan(2);
    expect(bytes.toString("latin1")).toContain("/FontFile2");
    expect(bytes.toString("latin1")).not.toContain("/JavaScript");
  }, 15000);
});
