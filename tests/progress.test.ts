import { afterEach, describe, expect, it, vi } from "vitest";
import { completedStageCount } from "@/lib/agent/progress";
import { STAGES, type AgentEvent } from "@/lib/types";

vi.mock("@/lib/github/pull-request", async () => {
  const { samplePullRequest } = await import("@/lib/demo/sample-analysis");
  return { fetchPullRequest: vi.fn().mockImplementation(samplePullRequest) };
});
vi.mock("@/lib/verification/runner", () => ({
  runLiveVerification: vi.fn(),
}));

import { investigate } from "@/lib/agent/investigator";
import { runLiveVerification } from "@/lib/verification/runner";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const event = (stage: number, status?: AgentEvent["status"]): AgentEvent => ({
  stage,
  status,
  label: STAGES[stage],
  detail: "Verification progress",
  at: "2026-09-28T00:00:00.000Z",
});

describe("investigation progress", () => {
  it("keeps verification active while the sandbox runs and advances only on completion", () => {
    expect(completedStageCount([])).toBe(0);
    expect(completedStageCount([event(10, "COMPLETE")])).toBe(11);
    expect(completedStageCount([event(11, "RUNNING")])).toBe(11);
    expect(completedStageCount([event(11, "COMPLETE")])).toBe(12);
    expect(completedStageCount([event(13, "COMPLETE")])).toBe(STAGES.length);
  });

  it("preserves completion semantics for events saved before status was added", () => {
    expect(completedStageCount([event(11)])).toBe(12);
  });

  it("streams a running event before awaiting remote work and completion afterward", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("NEBIUS_API_KEY", "");
    vi.stubEnv("NEBIUS_MODEL", "");
    const events: AgentEvent[] = [];
    vi.mocked(runLiveVerification).mockImplementation(async () => {
      expect(events.at(-1)).toMatchObject({ stage: 11, status: "RUNNING" });
      expect(completedStageCount(events)).toBe(11);
      return [];
    });
    const report = await investigate(
      { input: "acme/platform", prNumber: 127 },
      (next) => events.push(next),
    );
    expect(runLiveVerification).toHaveBeenCalledOnce();
    expect(
      report.events
        .filter((next) => next.stage === 11)
        .map((next) => next.status),
    ).toEqual(["RUNNING", "COMPLETE"]);
    expect(completedStageCount(events)).toBe(STAGES.length);
  });

  it("does not show verification completed when the investigation is interrupted", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("NEBIUS_API_KEY", "");
    vi.stubEnv("NEBIUS_MODEL", "");
    const events: AgentEvent[] = [];
    vi.mocked(runLiveVerification).mockRejectedValue(new Error("Cancelled"));
    await expect(
      investigate({ input: "acme/platform", prNumber: 127 }, (next) =>
        events.push(next),
      ),
    ).rejects.toThrow("Cancelled");
    expect(events.at(-1)).toMatchObject({ stage: 11, status: "RUNNING" });
    expect(completedStageCount(events)).toBe(11);
    expect(
      events.some((next) => next.stage === 11 && next.status === "COMPLETE"),
    ).toBe(false);
  });
});
