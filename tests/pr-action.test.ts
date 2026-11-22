import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Octokit } from "@octokit/rest";
import { afterEach, expect, it, vi } from "vitest";
import {
  decideExit,
  readPolicy,
  runAction,
  upsertStickyComment,
} from "../scripts/pr-action";
import type { review } from "../scripts/review-cli";

const marker = "<!-- ai-change-verifier:sticky -->";
const token = "mock-token-should-never-appear-in-diagnostics";
type Comment = { id: number; body: string; user: { type: string } };
const comment = (body: string, type = "Bot"): Comment => ({
  id: 42,
  body,
  user: { type },
});
function github(pages: Comment[][] = [[]], denyWrites = false) {
  const writes: string[] = [],
    reads: number[] = [];
  // Exercise Octokit's real Link-header pagination with an in-memory transport.
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (method === "GET") {
      const page = Number(url.searchParams.get("page") ?? 1);
      reads.push(page);
      url.searchParams.set("page", String(page + 1));
      return Response.json(pages[page - 1], {
        headers: page < pages.length ? { link: `<${url}>; rel="next"` } : {},
      });
    }
    writes.push(method);
    if (denyWrites)
      return Response.json(
        { message: "private diagnostic " + token },
        { status: 403 },
      );
    const { body } = JSON.parse(String(init?.body));
    if (method === "POST") pages[0].push(comment(body));
    else {
      expect(method).toBe("PATCH");
      pages
        .flat()
        .find(
          (item) => item.id === Number(url.pathname.split("/").pop()),
        )!.body = body;
    }
    return Response.json({ id: 42 });
  };
  const octokit = new Octokit({
    auth: token,
    request: { fetch: fetcher },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  const post = (body = "Review") =>
    upsertStickyComment({
      octokit,
      owner: "acme",
      repo: "app",
      issueNumber: 7,
      body,
      marker,
    });
  return { octokit, writes, reads, pages, post };
}

it("creates a marked comment", async () => {
  const gh = github();
  await gh.post();
  expect(gh.writes).toEqual(["POST"]);
  expect(gh.pages[0][0].body).toBe(marker + "\n\nReview");
});
it("updates a Bot comment starting with the marker", async () => {
  const gh = github([[comment(marker + "\r\nold")]]);
  await gh.post();
  expect(gh.writes).toEqual(["PATCH"]);
  expect(gh.pages[0][0].body).toContain("Review");
});
it.each([
  [marker, "User"],
  ["unrelated", "Bot"],
  ["quoted\n" + marker, "Bot"],
])("leaves a human or unmarked comment intact (%#)", async (body, type) => {
  const gh = github([[comment(body, type)]]);
  await gh.post();
  expect(gh.writes).toEqual(["POST"]);
  expect(gh.pages[0][0].body).toBe(body);
});
it("finds the sticky comment on page three", async () => {
  const gh = github([[], [], [comment(marker)]]);
  await gh.post();
  expect(gh.reads).toEqual([1, 2, 3]);
  expect(gh.writes).toEqual(["PATCH"]);
});
it("preserves the marker and revision footer when truncating", async () => {
  const gh = github();
  const footer = "<sub>Analysis of head `abcd123`, generated 2026-11-22.</sub>";
  await gh.post("x".repeat(70000) + "\n\n" + footer);
  const { body } = gh.pages[0][0];
  expect(body.length).toBeLessThanOrEqual(60000);
  expect(body.startsWith(marker + "\n")).toBe(true);
  expect(body.endsWith(footer)).toBe(true);
});
it("leaves one comment across two runs", async () => {
  const gh = github();
  await gh.post("first");
  await gh.post("second");
  expect(gh.pages.flat()).toEqual([comment(marker + "\n\nsecond")]);
});
it("replaces raw GitHub errors with a single safe diagnostic", async () => {
  await expect(github([[]], true).post()).rejects.toThrow(
    /^GitHub could not update the sticky PR comment\.$/,
  );
});
for (const strict of [false, true]) {
  for (const failOn of ["none", "medium", "high"] as const) {
    it.each([0, 1, 2, 3, 130])(
      `maps exit %i for ${failOn}, strict=${strict}`,
      (cliExit) => {
        expect(decideExit({ cliExit, failOn, strict })).toBe(
          cliExit === 3 || strict ? cliExit : 0,
        );
      },
    );
  }
}
it.each([{ REVIEW_FAIL_ON: "critical" }, { REVIEW_STRICT: "yes" }])(
  "rejects invalid policy inputs",
  (env) => {
    expect(() => readPolicy(env)).toThrow();
  },
);
let temp: string | undefined;
afterEach(async () => {
  if (temp) await rm(temp, { recursive: true, force: true });
  temp = undefined;
});
async function invocation(fork: boolean, cliExit: Awaited<ReturnType<typeof review>>) {
  temp = await mkdtemp(path.join(os.tmpdir(), "pr-action-"));
  const env = {
    GITHUB_EVENT_PATH: path.join(temp, "event.json"),
    GITHUB_STEP_SUMMARY: path.join(temp, "summary.md"),
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_REPOSITORY: "acme/app",
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_TOKEN: token,
    DEMO_MODE: "false",
    REVIEW_FAIL_ON: "high",
  };
  await writeFile(
    env.GITHUB_EVENT_PATH,
    JSON.stringify({
      number: 7,
      pull_request: {
        base: { repo: { full_name: "acme/app" } },
        head: { repo: { full_name: fork ? "contributor/app" : "acme/app" } },
      },
    }),
  );
  const gh = github();
  const fake = vi.fn<typeof review>(async (args, _signal, io) => {
    expect(args).toEqual([
      "https://github.com/acme/app/pull/7",
      "--fail-on",
      "high",
      "--quiet",
    ]);
    if (cliExit === 0 || cliExit === 3) io?.stdout?.("### Example review\n");
    return cliExit;
  });
  const code = await runAction(
    env,
    new AbortController().signal,
    fake,
    () => gh.octokit,
  );
  expect(fake).toHaveBeenCalledOnce();
  return {
    code,
    writes: gh.writes,
    reads: gh.reads,
    summary: await readFile(env.GITHUB_STEP_SUMMARY, "utf8"),
  };
}
it("publishes a threshold-crossing review before returning failure", async () => {
  expect(await invocation(false, 3)).toMatchObject({
    code: 3,
    writes: ["POST"],
    summary: "### Example review\n",
  });
});
it("writes a fork summary without making any comment API calls", async () => {
  expect(await invocation(true, 0)).toMatchObject({
    code: 0,
    writes: [],
    reads: [],
    summary: "### Example review\n",
  });
});
it("writes an unavailable summary for a non-strict CLI failure", async () => {
  expect(await invocation(false, 2)).toMatchObject({
    code: 0,
    writes: [],
    reads: [],
    summary: "Review unavailable (CLI exit 2).\n",
  });
});
