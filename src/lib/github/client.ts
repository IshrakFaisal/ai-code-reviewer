import { Octokit } from "@octokit/rest";
export function githubClient() {
  return new Octokit({
    auth: process.env.GITHUB_TOKEN || undefined,
    request: { timeout: 20000 },
    userAgent: "ai-change-verifier/0.1",
  });
}
export function githubError(error: unknown): Error {
  const e = error as {
    status?: number;
    response?: { headers?: Record<string, string> };
  };
  if (e.status === 404)
    return new Error(
      "Repository or pull request not found. Only public repositories are supported; check the URL and PR number.",
    );
  if (e.status === 401)
    return new Error(
      "GitHub rejected the configured token. Update GITHUB_TOKEN on the server.",
    );
  if (e.status === 403 || e.status === 429) {
    const reset = Number(e.response?.headers?.["x-ratelimit-reset"]);
    return new Error(
      `GitHub rate limit or access restriction. ${reset ? `Retry after ${new Date(reset * 1000).toISOString()}.` : "Retry later or configure GITHUB_TOKEN."}`,
    );
  }
  return new Error(
    "GitHub could not complete this request. Check your network and retry, or run the demo.",
  );
}
