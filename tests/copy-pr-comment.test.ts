import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { CopyPrComment } from "@/components/report/copy-pr-comment";
import { buildPrComment } from "@/lib/reports/pr-comment";
import { samplePullRequest } from "@/lib/demo/sample-analysis";
import type { AnalysisReport } from "@/lib/types";

it("copies the preview verbatim, confirms success and offers manual selection on rejection", async () => {
  const report: AnalysisReport = {
    id: "demo",
    createdAt: "2026-11-22T00:00:00Z",
    mode: "DEMO",
    provider: "Demo",
    pr: samplePullRequest(),
    summary: "",
    findings: [],
    checks: [],
    behaviors: [],
    riskMap: [],
    warnings: [],
    events: [],
    reviewSurface: { partial: false, priorityLines: 0, totalLines: 0 },
  };
  const comment = buildPrComment(report, null);
  const writeText = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("denied"));
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  try {
    const control = new CopyPrComment({ comment, hasDrafts: true });
    // Exercise the rendered button with a synchronous state update in Node.
    vi.spyOn(control, "setState").mockImplementation((patch) =>
      Object.assign(control.state, patch),
    );
    const markup = () => renderToStaticMarkup(control.render());
    const click = () => control.render().props.children[0].props.onClick();
    expect(markup()).toContain("Preview comment");
    expect(markup()).toContain("Unsaved review drafts are excluded");
    await click();
    expect(writeText).toHaveBeenCalledWith(comment);
    expect(markup()).toContain("Copied");
    await click();
    expect(markup()).toContain("Clipboard unavailable");
    expect(markup()).toContain("Select all");
    expect(
      control.render().props.children.at(-1).props.children[1].props.value,
    ).toBe(comment);
  } finally {
    vi.unstubAllGlobals();
  }
});
