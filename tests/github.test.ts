import { describe, expect, it, vi, beforeEach } from "vitest";
const mock = vi.hoisted(() => ({
  repo: vi.fn(),
  pull: vi.fn(),
  files: vi.fn(),
}));
vi.mock("@/lib/github/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/github/client")>()),
  githubClient: () => ({
    repos: { get: mock.repo },
    pulls: { get: mock.pull, listFiles: mock.files },
  }),
}));
import { fetchPullRequest } from "@/lib/github/pull-request";
import { githubError } from "@/lib/github/client";
const ref = { owner: "acme", repo: "platform", number: 1 };
const pull = {
  number: 1,
  title: "Change",
  body: "Body",
  html_url: "https://github.com/acme/platform/pull/1",
  user: { login: "developer" },
  base: { ref: "main", sha: "a".repeat(40) },
  head: { ref: "feature", sha: "b".repeat(40) },
  additions: 1,
  deletions: 0,
  changed_files: 1,
};
beforeEach(() => {
  vi.resetAllMocks();
  mock.repo.mockResolvedValue({
    data: { full_name: "acme/platform", private: false },
  });
  mock.pull.mockResolvedValue({ data: pull });
  mock.files.mockResolvedValue({
    data: [
      {
        filename: "src/api/users.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: "@@ -1,0 +1,1 @@\n+export const version = 2;",
      },
    ],
  });
});
describe("GitHub retrieval", () => {
  it("retrieves immutable metadata and categorizes real patches", async () => {
    const events: number[] = [];
    const result = await fetchPullRequest(ref, async (s) => {
      events.push(s);
    });
    expect(events).toEqual([0, 1, 2]);
    expect(result.headSha).toBe(pull.head.sha);
    expect(result.files[0].categories).toContain("API");
    expect(result.files[0].lines[0].line).toBe(1);
  });
  it("refuses revision drift during retrieval", async () => {
    mock.pull.mockResolvedValueOnce({ data: pull }).mockResolvedValueOnce({
      data: { ...pull, head: { ...pull.head, sha: "c".repeat(40) } },
    });
    await expect(fetchPullRequest(ref, async () => {})).rejects.toThrow(
      "changed during retrieval",
    );
  });
  it("rejects private repositories even when a token can access them", async () => {
    mock.repo.mockResolvedValue({ data: { private: true } });
    await expect(fetchPullRequest(ref, async () => {})).rejects.toThrow(
      "public repositories only",
    );
  });
  it("flags absent patches", async () => {
    mock.files.mockResolvedValue({
      data: [
        { filename: "binary.png", status: "added", additions: 1, deletions: 0 },
      ],
    });
    expect(
      (await fetchPullRequest(ref, async () => {})).warnings.join(),
    ).toContain("missing or truncated");
  });
  it("returns actionable not-found and rate-limit errors", () => {
    expect(githubError({ status: 404 }).message).toContain("not found");
    expect(
      githubError({
        status: 429,
        response: { headers: { "x-ratelimit-reset": "1800000000" } },
      }).message,
    ).toContain("Retry after");
  });
});
