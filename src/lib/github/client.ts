import { Octokit } from "@octokit/rest";

async function delay(milliseconds: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function failureDetails(error: unknown) {
  const details = {
    status: 0,
    headers: {} as Record<string, string>,
    code: "",
    timeout: false,
    transport: false,
    message: "",
  };
  let current = error;
  for (
    let depth = 0;
    depth < 6 && current && typeof current === "object";
    depth++
  ) {
    const value = current as {
      status?: number;
      response?: { headers?: Record<string, string> };
      code?: string;
      name?: string;
      message?: string;
      cause?: unknown;
    };
    if (depth === 0) {
      details.status = value.status || 0;
      details.headers = value.response?.headers || {};
      details.transport = !value.response;
      details.message = value.message || "";
    }
    if (!details.code && typeof value.code === "string")
      details.code = value.code;
    if (value.name === "TimeoutError") details.timeout = true;
    current = value.cause;
  }
  return details;
}

function retryable(error: unknown) {
  const { status, code, timeout, transport } = failureDetails(error);
  if (!transport) return [408, 500, 502, 503, 504].includes(status);
  return (
    timeout ||
    [
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_SOCKET",
    ].includes(code)
  );
}

export function githubClient(transport: typeof fetch = fetch) {
  const github = new Octokit({
    auth: process.env.GITHUB_TOKEN?.trim() || undefined,
    request: { fetch: transport },
    userAgent: "ai-change-verifier/0.1",
  });
  github.hook.wrap("request", async (request, options) => {
    const signal = options.request.signal;
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      try {
        // Octokit's native fetch transport no longer implements request.timeout.
        // The signal bounds connection time and response-body reads per attempt.
        // Earlier hooks bind this same options object, so update it in place.
        options.request.signal = AbortSignal.any([
          AbortSignal.timeout(20000),
          ...(signal ? [signal] : []),
        ]);
        const result = await request(options);
        options.request.signal.throwIfAborted();
        return result;
      } catch (error) {
        signal?.throwIfAborted();
        if (
          attempt >= 2 ||
          !["GET", "HEAD"].includes(options.method) ||
          !retryable(error)
        )
          throw error;
        await delay(250 * 2 ** attempt, signal);
      } finally {
        options.request.signal = signal;
      }
    }
  });
  return github;
}
export function githubError(error: unknown): Error {
  const e = failureDetails(error);
  if (e.transport) {
    if (["EACCES", "EPERM"].includes(e.code))
      return new Error(
        "The app server is blocked from reaching api.github.com. Restart the app in a regular terminal, such as Windows PowerShell, with outbound network access.",
      );
    if (["ENOTFOUND", "EAI_AGAIN"].includes(e.code))
      return new Error(
        "The app server could not resolve api.github.com. Check the server's DNS, VPN or proxy settings. If it is running in a restricted terminal, restart it in a regular terminal.",
      );
    if (
      e.timeout ||
      [
        "ETIMEDOUT",
        "UND_ERR_CONNECT_TIMEOUT",
        "UND_ERR_HEADERS_TIMEOUT",
      ].includes(e.code)
    )
      return new Error(
        "The app server's connection to GitHub timed out. Check its network or proxy settings, then retry.",
      );
    if (e.status === 500 || e.code)
      return new Error(
        "The app server could not connect to api.github.com. Check the server's network, firewall or proxy, then retry. Run the demo while GitHub is unavailable.",
      );
  }
  if (e.status === 404)
    return new Error(
      "Repository or pull request not found. Only public repositories are supported; check the URL and PR number.",
    );
  if (e.status === 401)
    return new Error(
      "GitHub rejected the configured token. Update GITHUB_TOKEN on the server.",
    );
  if (e.status === 403 || e.status === 429) {
    const limited =
      e.status === 429 ||
      e.headers["x-ratelimit-remaining"] === "0" ||
      Boolean(e.headers["retry-after"]) ||
      /rate limit|abuse detection/i.test(e.message);
    if (!limited)
      return new Error(
        "GitHub refused access to this repository. Check that it is public and that any configured GITHUB_TOKEN has permission to read it.",
      );
    const reset = Number(e.headers["x-ratelimit-reset"]);
    const retryAfter = Number(e.headers["retry-after"]);
    const date = new Date(reset * 1000);
    const when =
      Number.isFinite(reset) && reset > 0 && !Number.isNaN(date.getTime())
        ? `Retry after ${date.toISOString()}.`
        : Number.isFinite(retryAfter) && retryAfter > 0
          ? `Retry in ${Math.ceil(retryAfter)} seconds.`
          : "Retry later.";
    return new Error(
      `GitHub API rate limit reached. ${when} Configure GITHUB_TOKEN in .env.local for a higher authenticated limit, then restart the app.`,
    );
  }
  if (e.status >= 500)
    return new Error(
      `GitHub is temporarily unavailable (HTTP ${e.status}). Retry shortly, or run the demo.`,
    );
  if (e.status === 422)
    return new Error(
      "GitHub could not provide this pull request's data (HTTP 422). Check the PR URL; its diff may be too large for GitHub to return.",
    );
  return new Error(
    "GitHub could not complete this request. Check your network and retry, or run the demo.",
  );
}
