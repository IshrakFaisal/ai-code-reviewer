import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const handlers = vi.hoisted(() => ({
  start: vi.fn(),
  get: vi.fn(),
  resume: vi.fn(),
  pause: vi.fn(),
  after: vi.fn(),
}));
vi.mock("next/server", () => ({ after: handlers.after }));
vi.mock("@/lib/agent/runs", () => ({
  analysisRuns: handlers,
  RunError: class extends Error {},
}));
import { POST as start } from "@/app/api/analyze/route";
import { GET, POST, DELETE } from "@/app/api/analyze/[id]/route";
import { requestRun, waitForRun } from "@/lib/agent/run-client";
const id = randomUUID(),
  params = { params: Promise.resolve({ id }) };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ORIGIN", "");
  vi.stubEnv("APP_AUTH_USERNAME", "");
  vi.stubEnv("APP_AUTH_PASSWORD", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("resumable analysis HTTP boundary", () => {
  it("starts an idempotent run and keeps background work attached to the server lifecycle", async () => {
    const snapshot = { id, status: "RUNNING" },
      done = Promise.resolve();
    handlers.start.mockResolvedValue({ snapshot, done });
    const response = await start(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        body: JSON.stringify({ input: "acme/platform", demo: true, runId: id }),
      }),
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(snapshot);
    expect(handlers.start).toHaveBeenCalledWith(
      { input: "acme/platform", demo: true },
      id,
    );
    expect(handlers.after).toHaveBeenCalledOnce();
    expect(handlers.after.mock.calls[0][0]()).toBe(done);
  });
  it.each([
    ["GET", GET],
    ["POST", POST],
    ["DELETE", DELETE],
  ] as const)(
    "authenticates %s before reading or changing runs",
    async (method, handler) => {
      vi.stubEnv("APP_ORIGIN", "https://review.example");
      vi.stubEnv("APP_AUTH_USERNAME", "owner");
      vi.stubEnv("APP_AUTH_PASSWORD", "long-secret-password-for-tests");
      expect(
        (
          await handler(
            new Request(`https://review.example/api/analyze/${id}`, { method }),
            params,
          )
        ).status,
      ).toBe(401);
      expect(handlers.get).not.toHaveBeenCalled();
      expect(handlers.resume).not.toHaveBeenCalled();
      expect(handlers.pause).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["POST", POST],
    ["DELETE", DELETE],
  ] as const)("rejects cross-origin %s", async (method, handler) => {
    expect(
      (
        await handler(
          new Request(`http://localhost/api/analyze/${id}`, {
            method,
            headers: { Origin: "https://attacker.example" },
          }),
          params,
        )
      ).status,
    ).toBe(403);
    expect(handlers.resume).not.toHaveBeenCalled();
    expect(handlers.pause).not.toHaveBeenCalled();
  });
  it("returns uncached progress and explicitly resumes or pauses", async () => {
    handlers.get.mockResolvedValue({ id, status: "PAUSED" });
    handlers.resume.mockResolvedValue({
      snapshot: { id, status: "RUNNING" },
      done: Promise.resolve(),
    });
    handlers.pause.mockResolvedValue({ id, status: "PAUSED" });
    expect(
      (
        await GET(new Request(`http://localhost/api/analyze/${id}`), params)
      ).headers.get("cache-control"),
    ).toBe("no-store");
    expect(
      (
        await POST(
          new Request(`http://localhost/api/analyze/${id}`, { method: "POST" }),
          params,
        )
      ).status,
    ).toBe(202);
    expect(
      (
        await DELETE(
          new Request(`http://localhost/api/analyze/${id}`, {
            method: "DELETE",
          }),
          params,
        )
      ).status,
    ).toBe(200);
    expect(handlers.resume).toHaveBeenCalledWith(id);
    expect(handlers.pause).toHaveBeenCalledWith(id);
  });
});
describe("run client", () => {
  it("rejects mismatched run or report IDs before navigating", async () => {
    const now = new Date().toISOString(),
      snapshot = {
        id,
        status: "COMPLETE",
        reportId: randomUUID(),
        attempt: 1,
        input: { input: "acme/platform", demo: true },
        createdAt: now,
        updatedAt: now,
        error: "",
        events: [],
      };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(snapshot)));
    await expect(requestRun(`/api/analyze/${id}`, id)).rejects.toThrow(
      "invalid analysis state",
    );
  });
  it("cancels status polling without sending a server pause", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController(),
      pending = waitForRun(controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
