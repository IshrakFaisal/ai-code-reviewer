import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/github/pull-request", async () => {
  const { samplePullRequest } = await import("@/lib/demo/sample-analysis");
  return {
    fetchPullRequest: async (
      _ref: unknown,
      progress: (stage: number, detail: string) => Promise<void>,
    ) => {
      for (let stage = 0; stage < 3; stage++)
        await progress(stage, "Mock GitHub response");
      return samplePullRequest();
    },
  };
});
import { investigate } from "@/lib/agent/investigator";
afterEach(() => vi.unstubAllEnvs());
describe("live orchestration without credentials", () => {
  it("retains useful static analysis without inventing model or execution evidence", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("NEBIUS_API_KEY", "");
    vi.stubEnv("NEBIUS_MODEL", "");
    vi.stubEnv("ENABLE_LOCAL_SANDBOX", "false");
    const report = await investigate({ input: "acme/platform", prNumber: 127 });
    expect(report.mode).toBe("LIVE");
    expect(new Set(report.events.map((event) => event.stage)).size).toBe(14);
    expect(
      report.events
        .filter((event) => event.stage === 11)
        .map((event) => event.status),
    ).toEqual(["RUNNING", "COMPLETE"]);
    expect(report.provider).toBe("Deterministic analysis");
    expect(report.findings.length).toBeGreaterThan(0);
    expect(
      report.findings.every(
        (f) => f.status === "UNVERIFIED_RISK" && !f.generatedTest,
      ),
    ).toBe(true);
    expect(report.behaviors.every((b) => b.source === "HEURISTIC")).toBe(true);
    expect(
      report.checks
        .filter((e) => e.provenance === "EXECUTED")
        .every((e) => e.status === "NOT_RUN"),
    ).toBe(true);
    expect(report.checks.some((e) => e.provenance === "DEMO_FIXTURE")).toBe(
      false,
    );
    expect(report.warnings.join()).toContain(
      "Nebius credentials or model missing",
    );
  });
});
