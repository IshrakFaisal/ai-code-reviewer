import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { NebiusProvider } from "@/lib/ai/nebius";
import { samplePullRequest } from "@/lib/demo/sample-analysis";
const schema = z.object({ answer: z.string() });
const response = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
  });
const catalog = (ids = ["nvidia/test-model"]) =>
  new Response(
    JSON.stringify({ object: "list", data: ids.map((id) => ({ id })) }),
  );
const withCatalog = () =>
  vi.fn<typeof fetch>().mockResolvedValueOnce(catalog());
beforeEach(() => {
  vi.stubEnv("NEBIUS_API_KEY", "unit-test-key");
  vi.stubEnv("NEBIUS_MODEL", "nvidia/test-model");
  vi.stubEnv("NEBIUS_BASE_URL", "https://api.tokenfactory.nebius.com/v1");
  vi.stubEnv("NEBIUS_REQUIRE_NVIDIA", "true");
});
afterEach(() => vi.unstubAllEnvs());
describe("Nebius structured adapter", () => {
  it("uses the configured endpoint/model and documented JSON mode", async () => {
    const fetcher = withCatalog().mockResolvedValue(
      response('{"answer":"yes"}'),
    );
    expect(
      await new NebiusProvider(undefined, fetcher).structured(
        "test",
        {},
        schema,
      ),
    ).toEqual({ answer: "yes" });
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api.tokenfactory.nebius.com/v1/models",
    );
    expect(fetcher.mock.calls[1][0]).toBe(
      "https://api.tokenfactory.nebius.com/v1/chat/completions",
    );
    const body = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(body.model).toBe("nvidia/test-model");
    expect(body.response_format).toEqual({ type: "json_object" });
  });
  it("repairs invalid JSON once, then validates the repaired schema", async () => {
    const fetcher = withCatalog()
      .mockResolvedValueOnce(response("markdown instead"))
      .mockResolvedValueOnce(response('{"answer":"repaired"}'));
    expect(
      await new NebiusProvider(undefined, fetcher).structured(
        "test",
        {},
        schema,
      ),
    ).toEqual({ answer: "repaired" });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(String(fetcher.mock.calls[2][1]?.body)).toContain(
      "Previous output was invalid",
    );
  });
  it("stops after two malformed responses", async () => {
    const fetcher = withCatalog().mockImplementation(async () =>
      response('{"wrong":true}'),
    );
    await expect(
      new NebiusProvider(undefined, fetcher).structured("test", {}, schema),
    ).rejects.toThrow("validation twice");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("handles HTTP failure without exposing response bodies or credentials", async () => {
    const fetcher = withCatalog().mockResolvedValue(
      new Response("secret upstream details", { status: 503 }),
    );
    await expect(
      new NebiusProvider(undefined, fetcher).structured("test", {}, schema),
    ).rejects.toThrow("HTTP 503");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not silently use another provider or model", async () => {
    vi.stubEnv("NEBIUS_MODEL", "");
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      new NebiusProvider(undefined, fetcher).structured("test", {}, schema),
    ).rejects.toThrow("not configured");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("checks exact model availability before inference and rejects a missing model", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(catalog(["nvidia/another-model"]));
    await expect(
      new NebiusProvider(undefined, fetcher).structured("test", {}, schema),
    ).rejects.toThrow("not available");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("checks the model catalog once for a complete provider session", async () => {
    const fetcher = withCatalog().mockImplementation(async () =>
      response('{"answer":"yes"}'),
    );
    const provider = new NebiusProvider(undefined, fetcher);
    await provider.structured("first", {}, schema);
    await provider.structured("second", {}, schema);
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).endsWith("/models")),
    ).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("requires an explicitly selected NVIDIA model by default", async () => {
    vi.stubEnv("NEBIUS_MODEL", "other/vendor-model");
    vi.stubEnv("NEBIUS_REQUIRE_NVIDIA", "");
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      new NebiusProvider(undefined, fetcher).structured("test", {}, schema),
    ).rejects.toThrow("Choose an NVIDIA model");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("allows explicit alternative models without changing the selected ID", async () => {
    vi.stubEnv("NEBIUS_MODEL", "other/vendor-model");
    vi.stubEnv("NEBIUS_REQUIRE_NVIDIA", "false");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(catalog(["other/vendor-model"]))
      .mockResolvedValueOnce(response('{"answer":"yes"}'));
    await new NebiusProvider(undefined, fetcher).structured("test", {}, schema);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).model).toBe(
      "other/vendor-model",
    );
  });
  it("rejects malformed catalogs and never emits upstream secrets", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("private upstream body"));
    await expect(
      new NebiusProvider(undefined, fetcher).structured("test", {}, schema),
    ).rejects.toThrow("invalid model catalog");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects unavailable catalogs without sending the PR to inference", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("secret", { status: 401 }));
    await expect(
      new NebiusProvider(undefined, fetcher).structured("test", {}, schema),
    ).rejects.toThrow("catalog failed (HTTP 401)");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid endpoint settings and prohibits redirects", async () => {
    const fetcher = withCatalog().mockResolvedValue(
      response('{"answer":"yes"}'),
    );
    await new NebiusProvider(undefined, fetcher).structured("test", {}, schema);
    expect(
      fetcher.mock.calls.every(([, options]) => options?.redirect === "error"),
    ).toBe(true);
    vi.stubEnv("NEBIUS_BASE_URL", "https://user:secret@example.com/v1");
    await expect(
      new NebiusProvider(undefined, fetcher).structured("test", {}, schema),
    ).rejects.toThrow("clean HTTPS");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("grounds category refinements to files actually included in model context", async () => {
    const pr = samplePullRequest();
    const fetcher = withCatalog().mockResolvedValue(
      response(
        JSON.stringify({
          files: [
            { path: pr.files[0].path, categories: ["DATABASE"] },
            { path: "invented.ts", categories: ["AUTHENTICATION"] },
          ],
        }),
      ),
    );
    expect(
      await new NebiusProvider(undefined, fetcher).refineFileCategories(pr),
    ).toEqual([{ path: pr.files[0].path, categories: ["DATABASE"] }]);
  });
  it("validates the category vocabulary and falls back after malformed output", async () => {
    const pr = samplePullRequest();
    const fetcher = withCatalog().mockImplementation(async () =>
      response(
        JSON.stringify({
          files: [{ path: pr.files[0].path, categories: ["SAFE"] }],
        }),
      ),
    );
    await expect(
      new NebiusProvider(undefined, fetcher).refineFileCategories(pr),
    ).rejects.toThrow("validation twice");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
