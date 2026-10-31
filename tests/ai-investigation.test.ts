import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PullRequest } from "@/lib/types";
import { assessRisk } from "@/lib/risk/engine";

vi.mock("@/lib/github/pull-request", () => ({
  fetchPullRequest: vi.fn(),
}));
vi.mock("@/lib/verification/runner", () => ({
  runLiveVerification: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/ai/test-context", () => ({
  testContextLoader: () => async () => ({
    headSha: "b".repeat(40),
    files: [
      {
        path: "src/auth/session.ts",
        sha: "c".repeat(40),
        role: "source",
        content: "export const signIn = () => database.save(session);",
        truncated: false,
      },
    ],
    limitations: [],
  }),
}));

import { fetchPullRequest } from "@/lib/github/pull-request";
import { investigate } from "@/lib/agent/investigator";
import { runLiveVerification } from "@/lib/verification/runner";
import type { InvestigationCheckpoint } from "@/lib/agent/checkpoint";

const changedPath = "src/auth/session.ts";

function pullRequest(): PullRequest {
  const file = {
    path: changedPath,
    status: "modified",
    additions: 1,
    deletions: 1,
    categories: [
      "AUTHENTICATION",
    ] as PullRequest["files"][number]["categories"],
    patch:
      "@@ -1,1 +1,1 @@\n-return session;\n+return await database.save(session);",
    lines: [
      {
        line: 1,
        side: "LEFT" as const,
        kind: "remove" as const,
        content: "return session;",
      },
      {
        line: 1,
        side: "RIGHT" as const,
        kind: "add" as const,
        content: "return await database.save(session);",
      },
    ],
  };
  return {
    owner: "acme",
    repo: "platform",
    number: 1,
    title: "Persist sessions",
    description: "Persist the session when signing in",
    url: "https://github.com/acme/platform/pull/1",
    author: "test-user",
    base: "main",
    head: "session-storage",
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    files: [{ ...file, risk: assessRisk(file) }],
    warnings: [],
  };
}

beforeEach(() => {
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("NEBIUS_API_KEY", "unit-test-key");
  vi.stubEnv("NEBIUS_MODEL", "nvidia/test-model");
  vi.stubEnv("NEBIUS_REQUIRE_NVIDIA", "true");
  vi.stubEnv("NEBIUS_BASE_URL", "https://api.tokenfactory.nebius.com/v1");
  vi.stubEnv("RISK_WEIGHTS_JSON", "");
  vi.mocked(fetchPullRequest).mockImplementation(async (_ref, onProgress) => {
    for (let stage = 0; stage < 3; stage++)
      await onProgress?.(stage, "Mock GitHub response");
    return pullRequest();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function mockModel(invalidRefinement = false) {
  const observedHypothesisScores: number[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith("/models"))
      return Response.json({
        object: "list",
        data: [{ id: "nvidia/test-model" }],
      });
    const request = JSON.parse(String(options?.body));
    const { task, data } = JSON.parse(request.messages[1].content);
    let result: unknown;
    if (task.startsWith("Summarize the intended"))
      result = { intent: "Inference: sessions are now persisted." };
    else if (task.startsWith("Refine changed-file"))
      result = {
        files: [
          {
            path: changedPath,
            categories: invalidRefinement ? ["SAFE"] : ["DATABASE", "TESTS"],
          },
          { path: "invented.ts", categories: ["SECURITY"] },
        ],
      };
    else if (task.startsWith("Identify meaningful"))
      result = {
        changes: [
          {
            title: "Session storage",
            description: "Sign-in now writes a session.",
            files: [changedPath],
          },
        ],
      };
    else if (task.startsWith("Generate at most")) {
      observedHypothesisScores.push(data.files[0].risk.score);
      result = {
        hypotheses: [
          {
            title: "Session write can fail",
            category: "DATABASE",
            description: "The database write may fail.",
            behavioralChange: "Sign-in now persists sessions.",
            potentialImpact: "Sign-in may become unavailable.",
            affectedFiles: [{ path: changedPath }],
            recommendation: "Test persistence failures.",
          },
        ],
      };
    } else if (task.startsWith("Generate one targeted"))
      result = {
        plan: {
          filename: "session.test.ts",
          framework: "vitest",
          strategy: "Verify sign-in handles persistence failure.",
          code: "// Test template only: repository execution is mocked in this test.",
        },
        limitation: "",
      };
    else throw new Error(`Unexpected model task: ${task}`);
    return Response.json({
      choices: [{ message: { content: JSON.stringify(result) } }],
    });
  });
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, observedHypothesisScores };
}

describe("live AI category refinement orchestration", () => {
  it("resumes after generation with pinned data and no repeated inference, even if model credentials are now unavailable", async () => {
    const { fetcher } = mockModel();
    const controller = new AbortController();
    let checkpoint: InvestigationCheckpoint | undefined;
    const session = {
      id: "d327444d-54b7-4407-b218-213f98c8c3a9",
      persist: async (value: InvestigationCheckpoint) => {
        checkpoint = value;
      },
    };
    await expect(
      investigate(
        { input: "acme/platform", prNumber: 1 },
        (event) => {
          if (event.stage === 10) controller.abort();
        },
        controller.signal,
        session,
      ),
    ).rejects.toThrow();
    const count = fetcher.mock.calls.length;
    expect(checkpoint!.values).toHaveProperty("test:finding-1");
    vi.stubEnv("NEBIUS_API_KEY", "");
    vi.stubEnv("NEBIUS_MODEL", "");
    const report = await investigate(
      { input: "acme/platform", prNumber: 1 },
      undefined,
      undefined,
      { ...session, checkpoint },
    );
    expect(report.id).toBe(session.id);
    expect(report.findings[0].generatedTest?.context?.headSha).toBe(
      "b".repeat(40),
    );
    expect(fetcher).toHaveBeenCalledTimes(count);
    expect(fetchPullRequest).toHaveBeenCalledOnce();
    expect(runLiveVerification).toHaveBeenCalledOnce();
    const replay = await investigate(
      { input: "acme/platform", prNumber: 1 },
      undefined,
      undefined,
      { ...session, checkpoint },
    );
    expect(replay).toEqual(report);
    expect(runLiveVerification).toHaveBeenCalledOnce();
  });
  it("grounds and merges AI categories before hypotheses, scoring, and report construction", async () => {
    const { fetcher, observedHypothesisScores } = mockModel();
    const report = await investigate({ input: "acme/platform", prNumber: 1 });
    expect(observedHypothesisScores).toEqual([60]);
    expect(report.pr.files[0].categories).toEqual([
      "AUTHENTICATION",
      "DATABASE",
    ]);
    expect(report.pr.files[0].risk.score).toBe(60);
    expect(report.findings[0]).toMatchObject({
      riskScore: 60,
      severity: "HIGH",
      status: "UNVERIFIED_RISK",
    });
    expect(report.riskMap.some((item) => item.category === "DATABASE")).toBe(
      true,
    );
    expect(report.reviewSurface.priorityLines).toBe(2);
    expect(new Set(report.events.map((event) => event.stage)).size).toBe(14);
    expect(report.events[4].detail).toContain("additive AI inference");
    expect(report.warnings.join(" ")).toContain(
      "cannot remove deterministic risk signals",
    );
    expect(report.checks.every((check) => check.provenance === "STATIC")).toBe(
      true,
    );
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).endsWith("/models")),
    ).toHaveLength(1);
  });

  it("retains heuristic risk and finishes the report when AI category output is invalid", async () => {
    const { fetcher, observedHypothesisScores } = mockModel(true);
    const report = await investigate({ input: "acme/platform", prNumber: 1 });
    expect(observedHypothesisScores).toEqual([30]);
    expect(report.pr.files[0].categories).toEqual(["AUTHENTICATION"]);
    expect(report.pr.files[0].risk.score).toBe(30);
    expect(report.findings[0]).toMatchObject({
      riskScore: 30,
      severity: "MEDIUM",
      status: "UNVERIFIED_RISK",
    });
    expect(new Set(report.events.map((event) => event.stage)).size).toBe(14);
    expect(report.events[4].detail).toContain("using path heuristics");
    expect(report.events[4].detail).not.toContain("AI inference");
    expect(report.warnings.join(" ")).toContain(
      "AI category refinement unavailable; deterministic categories retained",
    );
    expect(report.behaviors[0].source).toBe("AI_INFERENCE");
    expect(
      fetcher.mock.calls.filter(([, options]) =>
        String(options?.body).includes("Refine changed-file"),
      ),
    ).toHaveLength(2);
  });
});
