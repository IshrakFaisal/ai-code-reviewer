import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { POST } from "@/app/api/reports/[id]/regressions/[findingId]/route";
import { getReport } from "@/lib/reports/store";
import { reproduce, repairAndRecheck } from "@/lib/regression/workflow";
import { regressions } from "@/lib/regression/store";
import {
  samplePullRequest,
  sampleHypotheses,
} from "@/lib/demo/sample-analysis";
import type { AnalysisReport } from "@/lib/types";
import type { RegressionResult } from "@/lib/regression/types";
vi.mock("@/lib/reports/store", () => ({ getReport: vi.fn() }));
vi.mock("@/lib/regression/workflow", () => ({
  reproduce: vi.fn(),
  repairAndRecheck: vi.fn(),
  describeError: (e: Error) => e.message,
}));
vi.mock("@/lib/regression/store", async (original) => ({
  ...(await original<typeof import("@/lib/regression/store")>()),
  regressions: { get: vi.fn(), save: vi.fn() },
}));
const id = "11111111-1111-1111-1111-111111111111";
const context = { params: Promise.resolve({ id, findingId: "finding-1" }) };
const report = {
  id,
  mode: "LIVE",
  pr: samplePullRequest(),
  findings: [
    {
      ...sampleHypotheses[0],
      id: "finding-1",
      generatedTest: { code: "test source", framework: "vitest" },
    },
  ],
} as AnalysisReport;
const state = globalThis as typeof globalThis & {
  verifierActive?: number;
  regressionActive?: Set<string>;
};
const request = (
  body = '{"action":"reproduce"}',
  headers: Record<string, string> = {},
) =>
  new Request(`http://localhost:3000/api/reports/${id}/regressions/finding-1`, {
    method: "POST",
    body,
    headers,
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ORIGIN", "");
  vi.stubEnv("APP_AUTH_USERNAME", "");
  vi.stubEnv("APP_AUTH_PASSWORD", "");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("SANDBOX_PROVIDER", "docker");
  vi.stubEnv("ENABLE_LOCAL_SANDBOX", "true");
  vi.stubEnv("LOCAL_SANDBOX_REPOSITORIES", "acme/platform");
  state.verifierActive = 0;
  state.regressionActive = new Set();
  vi.mocked(getReport).mockResolvedValue(report);
  vi.mocked(regressions.get).mockResolvedValue(null);
});
afterEach(() => {
  vi.unstubAllEnvs();
  state.verifierActive = 0;
  state.regressionActive?.clear();
});
describe("regression action boundaries", () => {
  it("requires owner authentication when configured", async () => {
    vi.stubEnv("APP_AUTH_USERNAME", "owner");
    vi.stubEnv("APP_AUTH_PASSWORD", "long-enough-private-owner-password");
    expect((await POST(request(), context)).status).toBe(401);
    expect(reproduce).not.toHaveBeenCalled();
  });
  it("rejects cross-origin execution before looking up a report", async () => {
    expect(
      (
        await POST(
          request(undefined, { origin: "https://attacker.example" }),
          context,
        )
      ).status,
    ).toBe(403);
    expect(getReport).not.toHaveBeenCalled();
  });
  it.each([
    '{"action":"shell","command":"anything"}',
    '{"action":"repair","code":"injected"}',
    "bad json",
  ])("rejects untrusted instructions %s", async (body) => {
    expect((await POST(request(body), context)).status).toBe(400);
    expect(reproduce).not.toHaveBeenCalled();
  });
  it("limits body bytes even without Content-Length", async () => {
    expect((await POST(request("x".repeat(513)), context)).status).toBe(413);
  });
  it("rejects path traversal", async () => {
    expect(
      (
        await POST(request(), {
          params: Promise.resolve({ id: "../escape", findingId: "finding-1" }),
        })
      ).status,
    ).toBe(400);
  });
  it("reports missing reports and findings", async () => {
    vi.mocked(getReport).mockResolvedValueOnce(null);
    expect((await POST(request(), context)).status).toBe(404);
    expect(
      (
        await POST(request(), {
          params: Promise.resolve({ id, findingId: "finding-2" }),
        })
      ).status,
    ).toBe(404);
  });
  it("gates the provider and exact repository allowlist", async () => {
    vi.stubEnv("SANDBOX_PROVIDER", "native");
    expect((await POST(request(), context)).status).toBe(409);
    vi.stubEnv("SANDBOX_PROVIDER", "docker");
    vi.stubEnv("LOCAL_SANDBOX_REPOSITORIES", "someone/else");
    expect((await POST(request(), context)).status).toBe(409);
    expect(reproduce).not.toHaveBeenCalled();
  });
  it("requires a comparison and live inference configuration for repairs", async () => {
    vi.stubEnv("NEBIUS_API_KEY", "");
    expect((await POST(request('{"action":"repair"}'), context)).status).toBe(
      409,
    );
    vi.stubEnv("NEBIUS_API_KEY", "test-only-key");
    vi.stubEnv("NEBIUS_MODEL", "nvidia/test");
    expect((await POST(request('{"action":"repair"}'), context)).status).toBe(
      409,
    );
    expect(repairAndRecheck).not.toHaveBeenCalled();
  });
  it("honors shared analysis capacity", async () => {
    state.verifierActive = 2;
    expect((await POST(request(), context)).status).toBe(429);
    expect(reproduce).not.toHaveBeenCalled();
  });
  it("streams events, persists completed evidence, and releases its slot", async () => {
    const result = {
      version: 1,
      reportId: id,
      findingId: "finding-1",
      events: [],
    } as unknown as RegressionResult;
    vi.mocked(reproduce).mockImplementationOnce(
      async (_report, _finding, progress) => {
        progress?.("Run base");
        return result;
      },
    );
    const response = await POST(request(), context);
    const lines = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines.map((line) => line.type)).toEqual(["progress", "complete"]);
    expect(regressions.save).toHaveBeenCalledWith(result);
    expect(state.verifierActive).toBe(0);
    expect(state.regressionActive?.size).toBe(0);
  });
  it("keeps previous evidence when execution fails", async () => {
    vi.mocked(reproduce).mockRejectedValueOnce(
      new Error("provider unavailable"),
    );
    const response = await POST(request(), context);
    expect(await response.text()).toContain("provider unavailable");
    expect(regressions.save).not.toHaveBeenCalled();
    expect(state.verifierActive).toBe(0);
  });
});
