import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { githubClient, githubError } from "@/lib/github/client";

// Keep real Octokit requests and hooks; silence expected HTTP failure logging.
vi.mock("@octokit/rest", async (importOriginal) => {
  const { Octokit } = await importOriginal<typeof import("@octokit/rest")>();
  return {
    Octokit: Octokit.defaults({
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }),
  };
});

function json(status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ message: "GitHub response" }), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function connectionError(code: string) {
  return new TypeError("fetch failed", {
    cause: Object.assign(new Error("Connection failed"), { code }),
  });
}

beforeEach(() => {
  vi.stubEnv("GITHUB_TOKEN", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("bounded GitHub requests", () => {
  it("recovers from brief socket resets with at most two retries", async () => {
    vi.useFakeTimers();
    const transport = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(connectionError("ECONNRESET"))
      .mockRejectedValueOnce(connectionError("ECONNRESET"))
      .mockResolvedValueOnce(json());
    const result = githubClient(transport).repos.get({
      owner: "acme",
      repo: "platform",
    });
    await vi.runAllTimersAsync();
    expect((await result).status).toBe(200);
    expect(transport).toHaveBeenCalledTimes(3);
    expect(
      transport.mock.calls.map(([, options]) => options?.signal),
    ).toHaveLength(3);
    expect(
      new Set(transport.mock.calls.map(([, options]) => options?.signal)).size,
    ).toBe(3);
  });

  it("stops retrying a persistent connection failure", async () => {
    vi.useFakeTimers();
    const transport = vi
      .fn<typeof fetch>()
      .mockRejectedValue(connectionError("ECONNRESET"));
    const result = githubClient(transport).repos.get({
      owner: "acme",
      repo: "platform",
    });
    const rejected = expect(result).rejects.toThrow("Connection failed");
    await vi.runAllTimersAsync();
    await rejected;
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it("retries a temporary GitHub service error", async () => {
    vi.useFakeTimers();
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(503))
      .mockResolvedValueOnce(json());
    const result = githubClient(transport).pulls.get({
      owner: "acme",
      repo: "platform",
      pull_number: 1,
    });
    await vi.runAllTimersAsync();
    expect((await result).status).toBe(200);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 404, 422, 429])(
    "does not repeatedly consume API requests for HTTP %i",
    async (status) => {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(json(status));
      await expect(
        githubClient(transport).repos.get({ owner: "acme", repo: "platform" }),
      ).rejects.toMatchObject({ status });
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["ENOTFOUND", "EPERM", "EACCES"])(
    "does not retry a server configuration problem (%s)",
    async (code) => {
      const transport = vi
        .fn<typeof fetch>()
        .mockRejectedValue(connectionError(code));
      await expect(
        githubClient(transport).repos.get({ owner: "acme", repo: "platform" }),
      ).rejects.toThrow("Connection failed");
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );

  it("actually enforces the 20-second timeout on a stalled transport", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(
        () =>
          controller.abort(
            new DOMException("Request timed out", "TimeoutError"),
          ),
        milliseconds,
      );
      return controller.signal;
    });
    const transport = vi.fn<typeof fetch>().mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          const signal = options!.signal!;
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const result = githubClient(transport).repos.get({
      owner: "acme",
      repo: "platform",
    });
    const rejected = expect(result).rejects.toThrow("Request timed out");
    await vi.advanceTimersByTimeAsync(19999);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true);
    await vi.runAllTimersAsync();
    await rejected;
    expect(transport).toHaveBeenCalledTimes(3);
    expect(AbortSignal.timeout).toHaveBeenCalledWith(20000);
  });

  it("cancels the pending retry when the analysis is aborted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const transport = vi
      .fn<typeof fetch>()
      .mockRejectedValue(connectionError("ECONNRESET"));
    const result = githubClient(transport).repos.get({
      owner: "acme",
      repo: "platform",
      request: { signal: controller.signal },
    });
    const rejected = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await rejected;
    await vi.runAllTimersAsync();
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("does not start an already cancelled request", async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = vi.fn<typeof fetch>();
    await expect(
      githubClient(transport).repos.get({
        owner: "acme",
        repo: "platform",
        request: { signal: controller.signal },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("actionable GitHub failures", () => {
  it("explains server DNS and permission failures without blaming the browser", () => {
    expect(githubError(connectionError("ENOTFOUND")).message).toContain(
      "app server could not resolve api.github.com",
    );
    expect(githubError(connectionError("EPERM")).message).toContain(
      "regular terminal",
    );
    expect(
      githubError({ status: 500, cause: connectionError("ECONNRESET") })
        .message,
    ).toContain("app server could not connect");
  });

  it("distinguishes timeouts from GitHub service failures", () => {
    expect(
      githubError({
        status: 500,
        cause: new DOMException("timeout", "TimeoutError"),
      }).message,
    ).toContain("timed out");
    expect(
      githubError({ status: 503, response: { headers: {} } }).message,
    ).toContain("temporarily unavailable (HTTP 503)");
  });

  it("distinguishes exhausted rate limits from access restrictions", () => {
    expect(
      githubError({
        status: 403,
        response: {
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "1800000000",
          },
        },
      }).message,
    ).toContain("Retry after");
    expect(
      githubError({
        status: 429,
        response: { headers: { "retry-after": "60" } },
      }).message,
    ).toContain("Retry in 60 seconds");
    expect(
      githubError({
        status: 403,
        response: { headers: { "x-ratelimit-remaining": "12" } },
      }).message,
    ).toContain("refused access");
  });

  it("does not throw while formatting a malformed rate-limit reset header", () => {
    for (const reset of ["Infinity", "999999999999999999999", "invalid"]) {
      expect(
        githubError({
          status: 429,
          response: { headers: { "x-ratelimit-reset": reset } },
        }).message,
      ).toContain("Retry later");
    }
  });

  it("never includes raw credential-bearing transport messages", () => {
    const error = Object.assign(
      new Error("Bearer secret-token from failed request"),
      { status: 500 },
    );
    expect(githubError(error).message).not.toContain("secret-token");
  });
});
