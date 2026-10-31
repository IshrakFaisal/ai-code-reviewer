import { describe, expect, it } from "vitest";
import {
  reportTargetHref,
  reportSectionLocation,
  reportSections,
  reportSectionHref,
} from "@/lib/reports/sections";
import { leavesReviewPage } from "@/lib/reports/draft-navigation";

describe("report page navigation", () => {
  it("gives every detail a distinct bookmarkable route", () => {
    const paths = reportSections.map(([section]) =>
      reportSectionHref("demo", section),
    );
    expect(new Set(paths).size).toBe(reportSections.length);
    for (const [section] of reportSections)
      expect(reportSectionLocation(reportSectionHref("demo", section))).toEqual(
        { id: "demo", section },
      );
    expect(reportSectionLocation("/report/demo/compare")).toBeNull();
    expect(
      reportSectionLocation("/report/demo/reproduce/finding-1"),
    ).toBeNull();
    expect(reportSectionLocation("/report/demo/missing")).toBeNull();
  });
  it("routes existing evidence links to the page containing their exact target", () => {
    for (const [fragment, page] of [
      ["#finding-1", "findings"],
      ["#finding-evidence-1-0", "findings"],
      ["#report-check-2", "verification"],
      ["#verification", "verification"],
      ["#changed-file-3", "changes"],
      ["#files", "changes"],
      ["#human-review", "review"],
      ["#review-plan", "next-steps"],
      ["#evidence-gaps", "gaps"],
      ["#report-limitations", "gaps"],
      ["#agent-log", "activity"],
      ["#workbench", "workbench"],
    ])
      expect(reportTargetHref("demo", fragment)).toBe(
        `/report/demo/${page}${fragment}`,
      );
    expect(reportTargetHref("demo", "#revision-status")).toBe(
      "/report/demo#revision-status",
    );
    expect(reportTargetHref("demo", "/analyze?run=new")).toBe(
      "/analyze?run=new",
    );
  });
  it("keeps drafts on detail switches but guards destinations that unmount the editor", () => {
    for (const [section] of reportSections) {
      const from = `http://localhost${reportSectionHref("demo", section)}`;
      for (const [destination] of reportSections)
        expect(
          leavesReviewPage(reportSectionHref("demo", destination), from),
        ).toBe(false);
      for (const path of [
        "/report/other/findings",
        "/report/demo/compare",
        "/report/demo/reproduce/finding-1",
        "/report/demo/missing",
        "/history",
        "https://elsewhere.example/report/demo/findings",
      ])
        expect(leavesReviewPage(path, from)).toBe(true);
    }
  });
});
