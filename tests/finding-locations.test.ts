import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, it, vi } from "vitest";
import { DraftNavigationProvider } from "@/components/report/draft-navigation";
import { ReportView } from "@/components/report/report-view";
import {
  sampleHypotheses,
  samplePullRequest,
} from "@/lib/demo/sample-analysis";
import { reportStore } from "@/lib/reports/store";
import type { AnalysisReport, LocationAnchor } from "@/lib/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/report/dae18434-a668-4846-b92e-522766cf3986/findings",
  useRouter: () => ({}),
}));
const report: AnalysisReport = {
  id: "dae18434-a668-4846-b92e-522766cf3986",
  createdAt: "2026-11-01T00:00:00Z",
  pr: samplePullRequest(),
  mode: "LIVE",
  provider: "Nebius",
  summary: "Review",
  findings: [
    {
      ...sampleHypotheses[0],
      id: "finding-1",
      severity: "HIGH",
      status: "UNVERIFIED_RISK",
      riskScore: 80,
      evidence: [],
    },
  ],
  events: [],
  behaviors: [],
  checks: [],
  warnings: [],
  riskMap: [],
  reviewSurface: { priorityLines: 0, totalLines: 10, partial: true },
};
function render(report: AnalysisReport) {
  return renderToStaticMarkup(
    createElement(
      DraftNavigationProvider,
      null,
      createElement(ReportView, { report }),
    ),
  );
}
it("renders a versionless saved finding without assigning a location badge", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "legacy-locations-"));
  try {
    await writeFile(
      path.join(directory, report.id + ".json"),
      JSON.stringify(report),
    );
    const stored = await reportStore(directory).get(report.id);
    expect(stored).toEqual(report);
    const html = render(stored!);
    expect(html).toContain(report.findings[0].title);
    expect(html).not.toMatch(/>Path only<|>Location not found in this PR</);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it.each(["path-only", "unanchored", "verified"] as const)(
  "renders the %s citation on the Findings page",
  (status: LocationAnchor["status"]) => {
    const file = "src/citation.ts";
    const location = {
      path: file,
      anchor: { status },
      ...(status === "verified" && { startLine: 3 }),
    };
    const html = render({
      ...report,
      findings: [
        { ...report.findings[0], locations: [location], anchor: { status } },
      ],
    });
    expect(html.includes(">Path only<")).toBe(status === "path-only");
    expect(html.includes(">Location not found in this PR<")).toBe(
      status === "unanchored",
    );
    const url =
      "https://github.com/acme/platform/blob/" + report.pr.headSha + "/" + file;
    expect(html.includes('href="' + url)).toBe(status !== "unanchored");
    expect(html.includes(url + "#L3")).toBe(status === "verified");
  },
);
