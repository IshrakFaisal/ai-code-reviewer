import { afterEach, describe, expect, it, vi } from "vitest";
import { isSameOrigin, readSmallBody } from "@/lib/http";
afterEach(() => vi.unstubAllEnvs());
describe("analysis HTTP boundary", () => {
  it("accepts the actual request host even when Next normalizes the internal URL", () => {
    expect(
      isSameOrigin(
        new Request("http://localhost:3000/api/analyze", {
          headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
        }),
      ),
    ).toBe(true);
  });
  it.each([
    "https://evil.test",
    "http://localhost:4000",
    "null",
    "https://localhost:3000",
  ])("rejects cross-origin requests %s", (origin) => {
    expect(
      isSameOrigin(
        new Request("http://localhost:3000/api/analyze", {
          headers: {
            host: "localhost:3000",
            origin,
            "x-forwarded-host": "evil.test",
          },
        }),
      ),
    ).toBe(false);
  });
  it("bounds chunked bodies without trusting content length", async () => {
    await expect(
      readSmallBody(
        new Request("http://localhost", {
          method: "POST",
          body: "x".repeat(4097),
        }),
      ),
    ).rejects.toThrow("too large");
  });
  it("accepts bounded JSON input", async () => {
    expect(
      await readSmallBody(
        new Request("http://localhost", {
          method: "POST",
          body: '{"demo":true}',
        }),
      ),
    ).toBe('{"demo":true}');
  });
  it("uses the pinned external HTTPS origin behind a reverse proxy", () => {
    vi.stubEnv("APP_ORIGIN", "https://review.example");
    expect(
      isSameOrigin(
        new Request("http://localhost/api/analyze", {
          headers: { host: "review.example", origin: "https://review.example" },
        }),
      ),
    ).toBe(true);
  });
  it("stops reading a stalled request body", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    const request = new Request("http://localhost", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    await expect(readSmallBody(request, 4096, 20)).rejects.toMatchObject({
      status: 408,
    });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("returns a size-specific error for a chunked oversized body", async () => {
    await expect(
      readSmallBody(
        new Request("http://localhost", {
          method: "POST",
          body: "x".repeat(4097),
        }),
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
});
