import { beforeAll, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { investigate } from "@/lib/agent/investigator";
import { buildPrComment } from "@/lib/reports/pr-comment";
import { emptyReviewState } from "@/lib/reports/review";
import type { AnalysisReport, Evidence } from "@/lib/types";

let demo: AnalysisReport;
beforeAll(async () => {
  demo = await investigate({ input: "acme/platform", demo: true });
}, 15000);

function live(): AnalysisReport {
  const report = structuredClone(demo);
  report.mode = "LIVE";
  report.provider = "Deterministic analysis";
  report.checks = [];
  report.findings = [{ ...report.findings[0], evidence: [] }];
  return report;
}
const output = (report: AnalysisReport) => buildPrComment(report, null);
const check = (
  provenance: Evidence["provenance"],
  status: Evidence["status"],
): Evidence => ({
  id: "check",
  type: "Generated test",
  provenance,
  status,
  description: "Test result",
});

it("summarizes the bundled demo without duplicating fixture checks", () => {
  const comment = output(demo);
  expect(comment).toContain(
    "Demo · Execution: 4 fixture assertions (bundled fixture only)",
  );
  expect(comment).toContain("Bundled fixture assertions: 3/4 passed, 1 failed");
  expect(comment).not.toContain("Generated test runs:");
  expect(comment).toContain(
    "Checks not run: build, typecheck, existing tests, generated tests, +1 more.",
  );
  expect(comment).toContain(
    "A failing assertion is a lead to inspect, not proof of a defect.",
  );
  expect(comment).not.toContain("A failing generated test");
  expect(comment).toContain(
    `Analysis of head \`${demo.pr.headSha.slice(0, 7)}\`, generated ${demo.createdAt.slice(0, 10)}.`,
  );
  expect(comment.length).toBeLessThanOrEqual(3500);
});
it("keeps curated demo findings and their evidence legend verbatim", () => {
  const top = output(demo)
    .split("**Top findings** ")[1]
    .split("\n\n**Verification**")[0];
  expect(top).toBe(
    [
      "(3 of 3)",
      "1. **HIGH · Executed**: Password reset token reuse (`src/auth/reset.ts:81`). Someone holding a previously used reset link could change the password again within the expiry window.",
      "2. **MEDIUM · Demo hypothesis**: Reset token retention needs a policy (`prisma/schema.prisma:40`). Expired credentials may accumulate without an explicit retention or deletion policy.",
      "3. **MEDIUM · Demo hypothesis**: Reset email delivery needs integration coverage (`src/email/reset.ts:1`). Incorrect environment configuration could produce unusable reset links.",
      "",
      "Executed = a check or test ran for this finding · Demo hypothesis = an illustrative finding written for the bundled demo.",
    ].join("\n"),
  );
  expect(demo.findings.every((f) => f.anchor === undefined)).toBe(true);
});
it("omits missing locations and counts only eligible findings in the list", () => {
  const report = live();
  report.provider = "Nebius";
  const template = report.findings[0];
  report.findings = [
    {
      ...template,
      riskScore: 80,
      anchor: { status: "unanchored" },
      locations: [
        { path: "missing.ts", anchor: { status: "unanchored" } },
        { path: "missing-too.ts", anchor: { status: "unanchored" } },
      ],
    },
    {
      ...template,
      title: "Known location",
      riskScore: 50,
      anchor: { status: "verified" },
    },
    {
      ...template,
      riskScore: 60,
      affectedFiles: [],
      locations: [{ path: "other.ts", anchor: { status: "unanchored" } }],
      anchor: { status: "unanchored" },
    },
  ];
  const comment = buildPrComment(report, null, { maxFindings: 2 });
  expect(comment).toContain("**Top findings** (1 of 1)");
  expect(comment).toContain("1. **HIGH · AI inference**: Known location");
  expect(comment).not.toMatch(
    /missing\.ts|other\.ts|Password reset token reuse|more in the full report/,
  );
  expect(comment).toContain(
    "2 AI findings cite locations that do not exist in this PR and are omitted here (see the report).",
  );
  expect(comment).toContain("AI inference = an unverified model judgment.");
  expect(comment).not.toContain("unanchored =");
});
it("keeps the complete dated demo comment byte-identical", () => {
  const comment = output({ ...demo, createdAt: "2026-11-22T00:00:00.000Z" });
  expect(comment).toHaveLength(1766);
  expect(createHash("sha256").update(comment, "utf8").digest("hex")).toBe(
    "947e0530c122cf60752ad7858f50b65bbeebbfd98d0c34be7878db714267dd98",
  );
});
it("explains an entirely unanchored review without revealing a title, warning or legend", () => {
  const report = live();
  report.findings[0].anchor = { status: "unanchored" };
  report.warnings = [
    "Test generation unavailable for " +
      report.findings[0].title +
      ": missing.ts",
  ];
  const comment = output(report);
  expect(comment).toContain(
    "**Top findings** (0 of 0)\nAll AI findings were omitted",
  );
  expect(comment).toContain(
    "1 AI finding cites locations that do not exist in this PR and is omitted here (see the report).",
  );
  expect(comment).not.toContain(report.findings[0].title);
  expect(comment).not.toMatch(/missing\.ts|Heuristic =/);
});
it("prints only the path of a path-only finding even when a stored reference has lines", () => {
  const report = live();
  report.findings[0].anchor = { status: "path-only" };
  expect(output(report)).toContain("(`src/auth/reset.ts`)");
  expect(output(report)).not.toContain("src/auth/reset.ts:81");
});
it("fills the last available rank and counts overflow from listable findings only", () => {
  const report = live();
  const template = report.findings[0];
  report.findings = Array.from({ length: 8 }, (_, i) => ({
    ...template,
    title: "Ranked " + i,
    riskScore: 100 - i,
    anchor: { status: i < 2 ? "unanchored" : "verified" },
  }));
  const comment = output(report);
  expect(comment).toContain("**Top findings** (5 of 6)");
  expect(comment).toContain("5. **HIGH · Heuristic**: Ranked 6");
  expect(comment).toContain("…and 1 more in the full report");
  expect(comment).not.toMatch(/Ranked [017]/);
});
it("omits missing-location warnings for path-only, verified and unchecked findings", () => {
  const report = live();
  report.findings.push(
    { ...report.findings[0], anchor: { status: "path-only" } },
    { ...report.findings[0], anchor: { status: "verified" } },
  );
  expect(output(report)).not.toMatch(
    /location not found|do not exist in this PR/,
  );
});
it("defines exactly the finding labels shown in the legend", () => {
  const heuristic = live();
  const ai = live();
  ai.provider = "Nebius · model";
  ai.findings.push({ ...ai.findings[0], evidence: [check("STATIC", "PASS")] });
  const comments = [
    output(demo),
    output(heuristic),
    output(ai),
    buildPrComment(demo, null, { maxFindings: 1 }),
  ];
  const allLabels = new Set<string>();
  for (const comment of comments) {
    const section = comment.split("**Top findings**")[1].split(/\n\n\*\*/)[0];
    const labels = new Set(
      Array.from(
        section.matchAll(/^\d+\. \*\*\w+ · ([^*]+)\*\*:/gm),
        (match) => match[1],
      ),
    );
    const legend = section.trim().split("\n").at(-1)!;
    const definitions = legend
      .split(" · ")
      .map((entry) => /^(.+?) = [\p{L}].+/u.exec(entry)?.[1]);
    expect(definitions).toEqual([...labels]);
    labels.forEach((label) => allLabels.add(label));
  }
  expect(allLabels).toEqual(
    new Set([
      "Executed",
      "Demo hypothesis",
      "Heuristic",
      "Static analysis",
      "AI inference",
    ]),
  );
});
it("uses the detailed partial-coverage warning once and falls back when it is absent", () => {
  const demoGaps = output(demo).split("**Evidence gaps**")[1].split("\n\n")[0];
  expect(demoGaps).toContain("Line coverage is partial.");
  expect(demoGaps).not.toContain("The analyzed diff is partial.");
  const report = live();
  report.pr.warnings = [];
  report.warnings = [];
  expect(output(report)).toContain("The analyzed diff is partial.");
});
it("omits the failure caveat when generated tests passed and only the build failed", () => {
  const report = live();
  report.checks = [
    check("EXECUTED", "PASS"),
    { ...check("EXECUTED", "FAIL"), type: "Build" },
  ];
  expect(output(report)).not.toContain("lead to inspect");
});
it("omits empty findings, behaviors and reviewer sections", () => {
  const comment = output({ ...live(), findings: [], behaviors: [] });
  expect(comment).not.toMatch(/Top findings|What changed|Reviewer status/);
});
it("orders fifty findings by priority without mutating the report", () => {
  const report = live();
  const template = report.findings[0];
  report.findings = Array.from({ length: 50 }, (_, i) => ({
    ...template,
    title: "Item " + i,
    riskScore: i,
  }));
  const comment = output(report);
  expect(comment).toContain("**Top findings** (5 of 50)");
  expect(comment.indexOf("Item 49")).toBeLessThan(comment.indexOf("Item 48"));
  expect(comment).not.toContain("Item 44");
  expect(comment).toContain("…and 45 more in the full report");
  expect(report.findings[0].riskScore).toBe(0);
});
it("identifies live heuristics with no execution", () => {
  expect(output(live())).toContain("Live heuristics · Execution: Not run");
});
it("requires attached execution even when a global test failed", () => {
  const report = live();
  report.provider = "Nebius · model";
  report.checks = [check("EXECUTED", "FAIL")];
  expect(output(report)).toContain("Live AI");
  expect(output(report)).toContain("· AI inference**");
});
it("reports attached static inspection despite a skipped execution", () => {
  const report = live();
  report.findings[0].evidence = [
    check("STATIC", "PASS"),
    check("EXECUTED", "NOT_RUN"),
  ];
  expect(output(report)).toContain("· Static analysis**");
  expect(output(report)).toContain("Checks not run: generated tests.");
});
it("labels an attached failure as executed and retains the generated-test caveat", () => {
  const report = live();
  report.findings[0].evidence = [
    check("STATIC", "PASS"),
    check("EXECUTED", "FAIL"),
  ];
  expect(output(report)).toContain("· Executed**");
  expect(output(report)).toContain(
    "Generated test runs: 0/1 passed, 1 failed.",
  );
  expect(output(report)).toContain(
    "A failing generated test is a lead to inspect, not proof of a defect.",
  );
});
it("does not promote fixture results to live execution", () => {
  const report = live();
  report.findings[0].evidence = [check("DEMO_FIXTURE", "FAIL")];
  expect(output(report)).not.toContain("· Executed**");
  expect(output(report)).toContain("Execution: Not run");
});
it("counts identical skipped tests attached to distinct findings", () => {
  const report = live();
  const finding = {
    ...report.findings[0],
    evidence: [check("EXECUTED", "NOT_RUN")],
  };
  report.findings = [finding, { ...finding, id: "other" }];
  expect(output(report)).toContain(
    "Checks not run: generated tests, generated tests.",
  );
});
it("neutralizes mentions, HTML, links, images, control characters and code delimiters", () => {
  const report = live();
  const hostile =
    "@everyone <script> [x](http://evil) ![i](http://evil) www.evil.com `escape`\n# injected\u0000\u202e";
  report.findings[0].title = hostile;
  report.findings[0].affectedFiles = [{ path: hostile }];
  report.behaviors[0].description = hostile;
  report.warnings = [hostile];
  const comment = output(report);
  expect(comment).not.toMatch(
    /@everyone|<script>|http:\/\/evil|www\.evil|\x00|\u202e|\n# injected|`escape`/,
  );
  expect(comment).toContain("&lt;script&gt;");
  expect(comment).toContain("\\[x\\]");
});
it("bounds expanded Markdown across all sections and preserves the footer", () => {
  const report = live();
  const long = "&".repeat(5000);
  report.findings = Array.from({ length: 50 }, () => ({
    ...report.findings[0],
    title: long,
    potentialImpact: long,
    affectedFiles: [{ path: long }],
  }));
  report.behaviors = Array(10).fill({ description: long });
  report.warnings = Array(10).fill(long);
  const comment = output(report);
  expect(comment.length).toBeLessThanOrEqual(6000);
  expect(comment).toContain("…");
  expect(comment).toMatch(/automatically\.<\/sub>$/);
});
it("counts saved decisions only for this report and revision", () => {
  const report = live();
  const review = emptyReviewState({
    id: report.id,
    headSha: report.pr.headSha,
    findingIds: [report.findings[0].id],
  });
  expect(buildPrComment(report, review)).not.toContain("Reviewer status");
  review.findings[report.findings[0].id].status = "NEEDS_FIX";
  expect(buildPrComment(report, review)).toContain(
    "1 needs fix · 0 reviewed · 0 dismissed · 0 open",
  );
  expect(
    buildPrComment(report, { ...review, headSha: "c".repeat(40) }),
  ).not.toContain("Reviewer status");
});
it.each([
  [24, "LOW"],
  [25, "MEDIUM"],
  [49, "MEDIUM"],
  [50, "HIGH"],
] as const)("maps score %i to %s priority", (score, level) => {
  const report = live();
  report.pr.files = [];
  report.findings[0].riskScore = score;
  expect(output(report)).toContain(
    `**Review priority: ${level}** (score ${score}; priority, not defect probability)`,
  );
});
