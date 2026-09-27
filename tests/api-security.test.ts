import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/analyze/route";
import { investigate } from "@/lib/agent/investigator";

vi.mock("@/lib/agent/investigator", () => ({ investigate: vi.fn() }));
vi.mock("@/lib/reports/store", () => ({ saveReport: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ORIGIN", "");
  vi.stubEnv("APP_AUTH_USERNAME", "");
  vi.stubEnv("APP_AUTH_PASSWORD", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("analysis route security before expensive work", () => {
  it("independently protects the API even when the proxy is bypassed", async () => {
    vi.stubEnv("APP_ORIGIN", "https://review.example");
    vi.stubEnv("APP_AUTH_USERNAME", "reviewer");
    vi.stubEnv("APP_AUTH_PASSWORD", "long-enough-test-password-for-owner");
    const response = await POST(
      new Request("https://review.example/api/analyze", {
        method: "POST",
        body: '{"input":"acme/platform","demo":true}',
      }),
    );
    expect(response.status).toBe(401);
    expect(investigate).not.toHaveBeenCalled();
  });
  it("rejects cross-origin requests even with correct owner credentials", async () => {
    vi.stubEnv("APP_ORIGIN", "https://review.example");
    vi.stubEnv("APP_AUTH_USERNAME", "reviewer");
    const password = "long-enough-test-password-for-owner";
    vi.stubEnv("APP_AUTH_PASSWORD", password);
    const response = await POST(
      new Request("https://review.example/api/analyze", {
        method: "POST",
        body: '{"input":"acme/platform","demo":true}',
        headers: {
          origin: "https://attacker.example",
          authorization: `Basic ${Buffer.from(`reviewer:${password}`).toString("base64")}`,
        },
      }),
    );
    expect(response.status).toBe(403);
    expect(investigate).not.toHaveBeenCalled();
  });
  it("returns 413 for a body whose size was not declared", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/analyze", {
        method: "POST",
        body: "x".repeat(4097),
      }),
    );
    expect(response.status).toBe(413);
    expect(investigate).not.toHaveBeenCalled();
  });
});
