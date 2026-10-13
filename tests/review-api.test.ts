import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH } from "@/app/api/reports/[id]/review/route";
import {
  ReviewConflictError,
  ReviewStoreError,
  reviewStore,
} from "@/lib/reports/review-store";
import { emptyReviewState } from "@/lib/reports/review";

vi.mock("@/lib/reports/review-store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/reports/review-store")>();
  return { ...actual, reviewStore: { get: vi.fn(), update: vi.fn() } };
});

const state = emptyReviewState({
  id: "demo",
  headSha: "b".repeat(40),
  findingIds: ["finding-1"],
});
const context = { params: Promise.resolve({ id: "demo" }) };
const decision = {
  findingId: "finding-1",
  status: "NEEDS_FIX",
  note: "Check token reuse",
  revision: 0,
};
function patch(body: unknown = decision, headers?: HeadersInit) {
  return new Request("http://localhost:3000/api/reports/demo/review", {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ORIGIN", "");
  vi.stubEnv("APP_AUTH_USERNAME", "");
  vi.stubEnv("APP_AUTH_PASSWORD", "");
  vi.mocked(reviewStore.get).mockResolvedValue(state);
  vi.mocked(reviewStore.update).mockResolvedValue({ ...state, revision: 1 });
});
afterEach(() => vi.unstubAllEnvs());

describe("review API authorization and validation", () => {
  it("loads and saves decisions with no-store responses", async () => {
    const loaded = await GET(
      new Request("http://localhost:3000/api/reports/demo/review"),
      context,
    );
    expect(loaded.status).toBe(200);
    expect(loaded.headers.get("cache-control")).toBe("no-store");
    expect(await loaded.json()).toEqual(state);
    const saved = await PATCH(patch(), context);
    expect(saved.status).toBe(200);
    expect(saved.headers.get("cache-control")).toBe("no-store");
    expect(reviewStore.update).toHaveBeenCalledWith("demo", decision);
  });

  it("protects reads and writes independently of the proxy", async () => {
    vi.stubEnv("APP_AUTH_USERNAME", "reviewer");
    vi.stubEnv("APP_AUTH_PASSWORD", "long-enough-test-password-for-owner");
    expect(
      (
        await GET(
          new Request("http://localhost:3000/api/reports/demo/review"),
          context,
        )
      ).status,
    ).toBe(401);
    expect((await PATCH(patch(), context)).status).toBe(401);
    expect(reviewStore.get).not.toHaveBeenCalled();
    expect(reviewStore.update).not.toHaveBeenCalled();
  });

  it("rejects cross-origin writes even with valid owner credentials", async () => {
    vi.stubEnv("APP_AUTH_USERNAME", "reviewer");
    const password = "long-enough-test-password-for-owner";
    vi.stubEnv("APP_AUTH_PASSWORD", password);
    const response = await PATCH(
      patch(decision, {
        origin: "https://attacker.example",
        authorization: `Basic ${Buffer.from(`reviewer:${password}`).toString("base64")}`,
      }),
      context,
    );
    expect(response.status).toBe(403);
    expect(reviewStore.update).not.toHaveBeenCalled();
  });

  it.each([
    { ...decision, status: "VERIFIED_ISSUE" },
    { ...decision, note: "x".repeat(2001) },
    { ...decision, revision: -1 },
    { ...decision, revision: 1.5 },
    { ...decision, reportId: "some-other-report" },
    { ...decision, findingId: "../../secret" },
  ])(
    "rejects invalid or extra fields before touching storage",
    async (body) => {
      const response = await PATCH(patch(body), context);
      expect(response.status).toBe(400);
      expect(reviewStore.update).not.toHaveBeenCalled();
    },
  );

  it("returns 400 for malformed JSON and 413 for an undeclared oversized body", async () => {
    const request = (body: string) =>
      new Request("http://localhost:3000/api/reports/demo/review", {
        method: "PATCH",
        body,
      });
    expect((await PATCH(request("{"), context)).status).toBe(400);
    expect((await PATCH(request("x".repeat(16385)), context)).status).toBe(413);
    expect(reviewStore.update).not.toHaveBeenCalled();
  });

  it("accepts 2,000-character notes including escaped JSON and Unicode", async () => {
    const response = await PATCH(
      patch({ ...decision, note: "\u0001漢".repeat(1000) }),
      context,
    );
    expect(response.status).toBe(200);
  });

  it("returns a conflicting tab's current state for explicit retry", async () => {
    const current = { ...state, revision: 2 };
    vi.mocked(reviewStore.update).mockRejectedValue(
      new ReviewConflictError(current),
    );
    const response = await PATCH(patch(), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ current });
  });

  it("returns missing-report errors and hides filesystem details", async () => {
    vi.mocked(reviewStore.get).mockRejectedValue(
      new ReviewStoreError("Report not found.", 404),
    );
    expect(
      (
        await GET(
          new Request("http://localhost:3000/api/reports/demo/review"),
          context,
        )
      ).status,
    ).toBe(404);
    vi.mocked(reviewStore.update).mockRejectedValue(
      new Error("EACCES at private/server/path"),
    );
    const response = await PATCH(patch(), context);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private/server/path");
  });
});
