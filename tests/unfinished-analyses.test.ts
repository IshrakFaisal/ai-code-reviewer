import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import {
  UnfinishedAnalyses,
  UnfinishedRunRow,
} from "@/components/history/unfinished-analyses";
import type { UnfinishedRun } from "@/lib/agent/run-summary";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
const run: UnfinishedRun = {
  runId: "ef28ef20-3311-4e57-8f02-09196a51acc9",
  repository: "acme/platform",
  prNumber: 127,
  title: "Recover account",
  mode: "DEMO",
  status: "PAUSED",
  stage: 4,
  totalStages: 14,
  startedAt: "2026-11-20T10:00:00.000Z",
  updatedAt: "2026-11-20T10:01:00.000Z",
  error: "",
};
function findClick(node: ReactNode, label: string): (() => void) | undefined {
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node))
    return;
  if (node.props.children === label && node.props.onClick)
    return node.props.onClick;
  for (const child of Children.toArray(node.props.children)) {
    const click = findClick(child, label);
    if (click) return click;
  }
}
afterEach(() => vi.unstubAllGlobals());
it.each(["RUNNING", "PAUSED", "INTERRUPTED"] as const)(
  "shows %s and its available actions",
  (status) => {
    const markup = renderToStaticMarkup(
      createElement(UnfinishedAnalyses, {
        initial: { runs: [{ ...run, status }], unreadable: [] },
      }),
    );
    expect(markup).toContain(status);
    expect(markup).toContain("Stage 4 of 14");
    expect(markup).toContain("/analyze?run=" + run.runId);
    expect(markup.includes(">Resume<")).toBe(status !== "RUNNING");
    expect(markup.includes('disabled=""')).toBe(status === "RUNNING");
  },
);
it("renders only a notice when unreadable checkpoints are all that remain", () => {
  const render = (unreadable: string[]) =>
    renderToStaticMarkup(
      createElement(UnfinishedAnalyses, { initial: { runs: [], unreadable } }),
    );
  expect(render([])).toBe("");
  expect(render(["first.json", "second.json"])).toContain(
    "Unreadable checkpoints: 2",
  );
});
it("posts Resume to the existing endpoint and requires confirmation before Discard", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      String(url).includes("/discard")
        ? new Response(null, { status: 204 })
        : Response.json({
            id: run.runId,
            input: { input: "acme/platform", demo: true },
            status: "RUNNING",
            attempt: 2,
            createdAt: run.startedAt,
            updatedAt: run.updatedAt,
            events: [],
            error: "",
          }),
    );
  const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("window", { confirm });
  let pending: Promise<void> | undefined;
  const row = UnfinishedRunRow({
    run,
    busy: false,
    onAction: (work) => {
      pending = work();
    },
  });
  findClick(row, "Resume")!();
  await pending;
  expect(fetcher).toHaveBeenCalledWith(
    "/api/analyze/" + run.runId,
    expect.objectContaining({ method: "POST" }),
  );
  const discard = findClick(row, "Discard")!;
  discard();
  expect(fetcher).toHaveBeenCalledTimes(1);
  discard();
  await pending;
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(fetcher).toHaveBeenLastCalledWith(
    "/api/runs/" + run.runId + "/discard",
    { method: "POST" },
  );
});
