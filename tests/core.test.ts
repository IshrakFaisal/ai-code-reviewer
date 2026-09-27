import { describe, expect, it, afterEach, vi } from "vitest";
import { parseGitHubInput } from "@/lib/github/input";
import { parseDiff } from "@/lib/github/diff";
import { categorize } from "@/lib/analysis/categorizer";
import { assessRisk, riskLevel, reviewSurface } from "@/lib/risk/engine";
import { DEFAULT_WEIGHTS, configuredWeights } from "@/lib/risk/signals";
import {
  findingStatus,
  notRun,
  executionEvidence,
} from "@/lib/verification/execution";
import { staticChecks } from "@/lib/verification/static";
import {
  samplePullRequest,
  sampleHypotheses,
} from "@/lib/demo/sample-analysis";
import { groundHypotheses } from "@/lib/ai/provider";
import { localAllowed, LocalSandboxProvider } from "@/lib/sandbox/local";
import type { Evidence, Finding } from "@/lib/types";

afterEach(() => vi.unstubAllEnvs());
describe("GitHub input boundary", () => {
  it("accepts PR links and repository-plus-number inputs", () => {
    expect(
      parseGitHubInput("https://github.com/acme/platform/pull/127"),
    ).toEqual({ owner: "acme", repo: "platform", number: 127 });
    expect(parseGitHubInput("acme/platform", 127)).toEqual({
      owner: "acme",
      repo: "platform",
      number: 127,
    });
    expect(
      parseGitHubInput("https://github.com/acme/platform", 127).number,
    ).toBe(127);
  });
  it.each([
    "https://github.com.evil.test/acme/repo/pull/1",
    "https://github.com@evil.test/acme/repo/pull/1",
    "http://github.com/acme/repo/pull/1",
    "https://github.com/acme/repo/pull/1?token=x",
    "https://github.com/acme/repo/pull/-1",
    "https://github.com/acme/repo/issues/1",
    "../../file",
    "https://localhost/acme/repo/pull/1",
    "acme/repo;echo/pull/1",
  ])("rejects unsafe or invalid input %s", (input) => {
    expect(() => parseGitHubInput(input)).toThrow();
  });
  it("requires a positive integer PR number", () => {
    expect(() => parseGitHubInput("acme/repo", 1.5)).toThrow();
    expect(() => parseGitHubInput("acme/repo")).toThrow();
  });
});
describe("diff and categorization", () => {
  it("tracks both sides across hunks without counting metadata", () => {
    expect(
      parseDiff(
        "--- a/file\n+++ b/file\n@@ -8,2 +8,2 @@\n-old\n+new\n context\n@@ -30,1 +32,2 @@\n stay\n+extra\n\\ No newline at end of file",
      ),
    ).toEqual([
      { line: 8, side: "LEFT", kind: "remove", content: "old" },
      { line: 8, side: "RIGHT", kind: "add", content: "new" },
      { line: 33, side: "RIGHT", kind: "add", content: "extra" },
    ]);
    expect(parseDiff()).toEqual([]);
  });
  it("recognizes sensitive paths but treats tests as tests", () => {
    expect(categorize("src/auth/session.ts")).toContain("AUTHENTICATION");
    expect(categorize("tests/auth/session.test.ts")).toEqual(["TESTS"]);
    expect(categorize(".env.production")).toContain("ENVIRONMENT");
    expect(categorize("pnpm-lock.yaml")).toContain("DEPENDENCIES");
    expect(categorize("prisma/migrations/init.sql")).toContain("DATABASE");
  });
});
describe("explainable risk and review surface", () => {
  it("applies thresholds precisely", () => {
    expect([0, 24, 25, 49, 50].map(riskLevel)).toEqual([
      "LOW",
      "LOW",
      "MEDIUM",
      "MEDIUM",
      "HIGH",
    ]);
  });
  it("weights authentication plus deleted validation and configurable overrides", () => {
    const file = samplePullRequest().files[0];
    expect(assessRisk(file).score).toBe(60);
    expect(
      assessRisk(file, [], { ...DEFAULT_WEIGHTS, authentication: 10 }).score,
    ).toBe(40);
    vi.stubEnv("RISK_WEIGHTS_JSON", '{"authentication":40,"security":-100}');
    expect(configuredWeights().authentication).toBe(40);
    expect(configuredWeights().security).toBe(25);
  });
  it("does not score missing or unrelated execution as failure", () => {
    const f = samplePullRequest().files[1];
    const before = assessRisk(f).score;
    expect(assessRisk(f, [notRun("Build", "not configured")]).score).toBe(
      before,
    );
    const e: Evidence = {
      id: "x",
      type: "Generated test",
      status: "FAIL",
      description: "failure",
      provenance: "EXECUTED",
      filePaths: ["other.ts"],
    };
    expect(assessRisk(f, [e]).score).toBe(before);
    expect(
      assessRisk(f, [
        { ...e, filePaths: [f.path] },
        { ...e, filePaths: [f.path] },
      ]).score,
    ).toBe(before + 40);
  });
  it("deduplicates overlapping findings while keeping old/new lines distinct", () => {
    const pr = samplePullRequest();
    const file = {
      ...pr.files[0],
      additions: 1,
      deletions: 1,
      lines: parseDiff("@@ -2,1 +2,1 @@\n-old\n+new"),
      risk: { score: 60, level: "HIGH" as const, reasons: [] },
    };
    const f: Finding = {
      ...sampleHypotheses[0],
      id: "one",
      severity: "HIGH",
      status: "UNVERIFIED_RISK",
      riskScore: 60,
      evidence: [],
    };
    expect(reviewSurface([file], [f, f], 2)).toEqual({
      priorityLines: 2,
      totalLines: 2,
      partial: false,
    });
  });
});
describe("evidence honesty", () => {
  const fail: Evidence = {
    id: "x",
    type: "Generated test",
    status: "FAIL",
    description: "assertion failure",
    provenance: "EXECUTED",
  };
  it("never upgrades unexecuted checks or live generated failures to confirmed bugs", () => {
    expect(findingStatus([notRun("Generated test", "unavailable")])).toBe(
      "UNVERIFIED_RISK",
    );
    expect(findingStatus([fail])).toBe("INCONCLUSIVE");
    expect(findingStatus([{ ...fail, status: "WARNING" }])).toBe(
      "INCONCLUSIVE",
    );
    expect(findingStatus([{ ...fail, status: "PASS" }])).toBe(
      "VERIFIED_FOR_TEST",
    );
    expect(findingStatus([{ ...fail, provenance: "DEMO_FIXTURE" }], true)).toBe(
      "VERIFIED_ISSUE",
    );
  });
  it("never passes a timeout even if its exit code is zero", () => {
    expect(
      executionEvidence("Build", {
        exitCode: 0,
        output: "",
        durationMs: 100,
        timedOut: true,
      }).status,
    ).toBe("FAIL");
  });
  it("treats missing patches as incomplete, not a clean bill of health", () => {
    const pr = samplePullRequest();
    const checks = staticChecks(pr);
    expect(checks.find((c) => c.id === "removed-tests")?.status).toBe(
      "WARNING",
    );
    expect(checks.find((c) => c.id === "environment")?.description).toContain(
      "APP_URL",
    );
    expect(checks.every((c) => c.provenance === "STATIC")).toBe(true);
  });
  it("drops invented files and line locations from model findings", () => {
    const pr = samplePullRequest();
    expect(
      groundHypotheses(
        [{ ...sampleHypotheses[0], affectedFiles: [{ path: "invented.ts" }] }],
        pr,
      ),
    ).toEqual([]);
    expect(
      groundHypotheses(
        [
          {
            ...sampleHypotheses[0],
            affectedFiles: [
              { path: pr.files[0].path, startLine: 99999, endLine: 100000 },
            ],
          },
        ],
        pr,
      )[0].affectedFiles[0],
    ).toEqual({ path: pr.files[0].path });
  });
});
describe("execution gate", () => {
  it("blocks local execution in production even if enabled and trusted", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_LOCAL_SANDBOX", "true");
    vi.stubEnv("LOCAL_SANDBOX_REPOSITORIES", "acme/platform");
    expect(localAllowed("acme/platform")).toBe(false);
    expect(() => new LocalSandboxProvider("acme/platform")).toThrow();
  });
  it("requires a specific trusted repository in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENABLE_LOCAL_SANDBOX", "true");
    vi.stubEnv("LOCAL_SANDBOX_REPOSITORIES", "acme/platform");
    expect(localAllowed("acme/platform")).toBe(true);
    expect(localAllowed("evil/platform")).toBe(false);
  });
});
