import { afterEach, describe, expect, it, vi } from "vitest";
import { runDemoFixture } from "@/lib/demo/fixture";
import { investigate } from "@/lib/agent/investigator";
import { samplePullRequest } from "@/lib/demo/sample-analysis";
import { validateReport } from "@/lib/reports/schema";
import type { AgentEvent } from "@/lib/types";
afterEach(() => vi.unstubAllEnvs());
describe("end-to-end demo investigation", () => {
  it("actually executes three passing assertions and a token-reuse failure", async () => {
    const results = await runDemoFixture();
    expect(results.filter((r) => r.status === "PASS")).toHaveLength(3);
    expect(results.filter((r) => r.status === "FAIL")).toHaveLength(1);
    expect(results[3].output).toContain("Received HTTP status: 200");
    expect(results[3].output).toContain("Expected HTTP status: 400");
  });
  it("keeps the declared demo totals consistent", () => {
    const pr = samplePullRequest();
    expect(pr.files).toHaveLength(18);
    expect(pr.additions + pr.deletions).toBe(1437);
  });
  it("streams all stages, bounds the loop, and only claims fixture evidence", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("MAX_INVESTIGATIONS", "1");
    const events: AgentEvent[] = [];
    const report = await investigate(
      { input: "acme/platform", demo: true },
      (e) => events.push(e),
    );
    expect(
      events.filter((e) => e.status !== "RUNNING").map((e) => e.stage),
    ).toEqual(Array.from({ length: 14 }, (_, i) => i));
    expect(report.findings).toHaveLength(1);
    expect(validateReport(report)).toEqual(report);
    expect(report.findings[0].status).toBe("VERIFIED_ISSUE");
    expect(report.findings[0].severity).toBe("HIGH");
    expect(
      report.findings[0].evidence.every((e) => e.provenance === "DEMO_FIXTURE"),
    ).toBe(true);
    expect(
      report.checks
        .filter((c) =>
          ["Build", "TypeScript", "Existing tests"].includes(c.type),
        )
        .every((c) => c.status === "NOT_RUN"),
    ).toBe(true);
    expect(report.reviewSurface.partial).toBe(true);
    expect(report.reviewSurface.priorityLines).toBeGreaterThan(0);
    expect(report.riskMap.find((r) => r.category === "EMAIL")?.level).toBe(
      "MEDIUM",
    );
  }, 10000);
  it("honors cancellation before investigation proceeds", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const c = new AbortController();
    c.abort();
    await expect(
      investigate({ input: "acme/platform", demo: true }, () => {}, c.signal),
    ).rejects.toThrow();
  });
});
