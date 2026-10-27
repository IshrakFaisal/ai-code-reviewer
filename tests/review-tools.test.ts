import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisReport, Evidence } from "@/lib/types";
import {
  sampleHypotheses,
  samplePullRequest,
} from "@/lib/demo/sample-analysis";
import { emptyReviewState } from "@/lib/reports/review";
import {
  revisionChanges,
  revisionCheckExpired,
  revisionCheckSchema,
  revisionRetryDelay,
  type RevisionCheck,
} from "@/lib/reports/freshness";
import { buildReviewPlan, reviewPlanMarkdown } from "@/lib/reports/review-plan";
import { filterWorkbenchFiles } from "@/lib/reports/workbench";
import { evidenceTarget } from "@/lib/reports/evidence-targets";
import { reportEvidence } from "@/lib/reports/verification-gaps";
import { githubClient } from "@/lib/github/client";
import { checkPullRequestRevision } from "@/lib/github/revision";
import { getReport } from "@/lib/reports/store";
import { POST } from "@/app/api/reports/[id]/revision/route";

vi.mock("@/lib/github/client", async (original) => ({
  ...(await original<typeof import("@/lib/github/client")>()),
  githubClient: vi.fn(),
}));
vi.mock("@/lib/reports/store", () => ({ getReport: vi.fn() }));

const now = Date.parse("2026-10-26T12:00:00.000Z");
function fixture(): AnalysisReport {
  const pr = samplePullRequest();
  pr.warnings = [];
  pr.files = pr.files.slice(0, 3);
  pr.changedFiles = pr.files.length;
  pr.files.forEach((file) => {
    file.risk = { score: 80, level: "HIGH", reasons: [] };
    file.additions = file.lines.filter((line) => line.kind === "add").length;
    file.deletions = file.lines.filter((line) => line.kind === "remove").length;
  });
  return {
    id: "11111111-1111-4111-8111-111111111111",
    createdAt: new Date(now).toISOString(),
    mode: "LIVE",
    provider: "test",
    pr,
    summary: "Review",
    findings: [
      {
        ...structuredClone(sampleHypotheses[0]),
        id: "finding-1",
        severity: "HIGH",
        riskScore: 80,
        status: "UNVERIFIED_RISK",
        evidence: [],
      },
    ],
    checks: [],
    behaviors: [],
    events: [],
    warnings: [],
    riskMap: [],
    reviewSurface: { priorityLines: 1, totalLines: 10, partial: false },
  };
}
function state(report: AnalysisReport) {
  return emptyReviewState({
    id: report.id,
    headSha: report.pr.headSha,
    findingIds: report.findings.map((finding) => finding.id),
  });
}
function snapshot(report: AnalysisReport): RevisionCheck {
  return {
    reportId: report.id,
    recordedBase: report.pr.baseSha,
    recordedHead: report.pr.headSha,
    currentBase: report.pr.baseSha,
    currentHead: report.pr.headSha,
    checkedAt: new Date(now).toISOString(),
    state: "OPEN",
    draft: false,
  };
}
function check(
  type = "Generated test",
  changes: Partial<Evidence> = {},
): Evidence {
  return {
    id: type,
    type,
    description: "Recorded check",
    provenance: "EXECUTED",
    status: "PASS",
    ...changes,
  };
}

describe("review action planning", () => {
  it("does not invent open decisions when saved decisions are unavailable", () => {
    const report = fixture();
    const plan = buildReviewPlan(report, null, snapshot(report), now);
    expect(plan.decisionsLoaded).toBe(false);
    expect(
      plan.actions.some((action) => action.id === "decisions-unavailable"),
    ).toBe(true);
    expect(plan.actions.some((action) => action.kind === "FINDING")).toBe(
      false,
    );
    expect(plan.counts.open).toBe(0);
  });
  it("prioritizes revision drift, saved needs-fix decisions, failures, and open risks", () => {
    const report = fixture(),
      review = state(report),
      revision = snapshot(report);
    review.findings["finding-1"].status = "NEEDS_FIX";
    report.findings[0].severity = "LOW";
    report.checks = [check("Build", { status: "FAIL" })];
    revision.currentHead = "c".repeat(40);
    const plan = buildReviewPlan(report, review, revision, now);
    expect(plan.actions.slice(0, 3).map((action) => action.id)).toEqual([
      "revision-moved",
      "finding-finding-1",
      "execution-failures",
    ]);
    expect(plan.counts).toMatchObject({ open: 0, needsFix: 1, failures: 1 });
    expect(
      new URL(plan.actions[0].href, "http://localhost").searchParams.get(
        "input",
      ),
    ).toBe("https://github.com/acme/platform/pull/127");
  });
  it("requires a new check when unknown or expired, while keeping old drift actionable", () => {
    const report = fixture();
    expect(buildReviewPlan(report, null, null, now).actions[0].id).toBe(
      "revision-check",
    );
    const revision = snapshot(report);
    expect(
      buildReviewPlan(report, null, revision, now + 300000).actions[0].id,
    ).toBe("revision-check");
    revision.currentBase = "d".repeat(40);
    expect(
      buildReviewPlan(report, null, revision, now + 300000).actions[0].id,
    ).toBe("revision-moved");
  });
  it("does not let a dismissal hide failed execution or high-risk evidence gaps", () => {
    const report = fixture(),
      review = state(report);
    review.findings["finding-1"].status = "DISMISSED";
    report.findings[0].evidence = [check("Generated test", { status: "FAIL" })];
    const plan = buildReviewPlan(report, review, snapshot(report), now);
    expect(plan.actions.some((action) => action.kind === "FINDING")).toBe(
      false,
    );
    expect(
      plan.actions.some((action) => action.id === "execution-failures"),
    ).toBe(true);
    expect(plan.counts.highRiskGaps).toBe(3);
    expect(
      plan.actions.find((action) => action.id === "execution-failures"),
    ).toMatchObject({ href: "#finding-evidence-0-0", findingId: "finding-1" });
  });
  it("links every failed check and finding warning to its own visible evidence", () => {
    const report = fixture();
    report.checks = [
      check("Build", { status: "FAIL" }),
      check("Generated test", {
        status: "WARNING",
        description: "Orphan test warning",
      }),
    ];
    report.findings[0].evidence = [
      check("Generated test", {
        status: "FAIL",
        description: "Assertion mismatch",
      }),
      check("Generated test", {
        id: "warning",
        status: "WARNING",
        description: "Repeated results disagree",
      }),
    ];
    const plan = buildReviewPlan(report, state(report), snapshot(report), now);
    expect(
      plan.actions.find((action) => action.id === "execution-failures")
        ?.targets,
    ).toEqual([
      { title: "Build: Recorded check", href: "#report-check-0" },
      {
        title: "Generated test: Assertion mismatch",
        href: "#finding-evidence-0-0",
        findingId: "finding-1",
      },
    ]);
    expect(
      plan.actions.find((action) => action.id === "execution-warnings")
        ?.targets,
    ).toEqual([
      { title: "Generated test: Orphan test warning", href: "#report-check-1" },
      {
        title: "Generated test: Repeated results disagree",
        href: "#finding-evidence-0-1",
        findingId: "finding-1",
      },
    ]);
    const markdown = reviewPlanMarkdown(
      report,
      state(report),
      snapshot(report),
      now,
    );
    expect(markdown).toContain("Build: Recorded check");
    expect(markdown).toContain("Generated test: Repeated results disagree");
  });
  it("deduplicates copied evidence without collapsing distinct execution outputs", () => {
    const report = fixture();
    const first = check("Generated test", {
      status: "FAIL",
      output: "first assertion",
      durationMs: 5,
    });
    const second = { ...first, output: "second assertion" };
    report.checks = [first, second];
    report.findings[0].evidence = [structuredClone(first)];
    expect(reportEvidence(report)).toHaveLength(2);
    expect(evidenceTarget(report, first).href).toBe("#finding-evidence-0-0");
    expect(evidenceTarget(report, second).href).toBe("#report-check-1");
    expect(
      buildReviewPlan(report, state(report), snapshot(report), now).counts
        .failures,
    ).toBe(2);
  });
  it("deduplicates repeated evidence and keeps static failures out of execution counts", () => {
    const report = fixture();
    const failed = check("Build", { status: "FAIL" });
    report.checks = [
      failed,
      check("Static rule", { status: "FAIL", provenance: "STATIC" }),
    ];
    report.findings[0].evidence = [structuredClone(failed)];
    expect(
      buildReviewPlan(report, state(report), snapshot(report), now).counts
        .failures,
    ).toBe(1);
  });
  it("does not accept fixture, static, or NOT_RUN checks as repository execution", () => {
    const report = fixture();
    report.checks = [
      check("Build", { provenance: "STATIC" }),
      check("TypeScript", { provenance: "DEMO_FIXTURE" }),
      check("Existing tests", { status: "NOT_RUN" }),
    ];
    expect(
      buildReviewPlan(report, state(report), snapshot(report), now)
        .missingChecks,
    ).toEqual(["Build", "TypeScript", "Existing tests"]);
    report.mode = "DEMO";
    report.checks.forEach((item) => {
      item.status = "PASS";
      item.provenance = "EXECUTED";
    });
    const plan = buildReviewPlan(report, state(report), null, now);
    expect(plan.missingChecks).toHaveLength(3);
    expect(plan.actions.some((action) => action.kind === "REVISION")).toBe(
      false,
    );
  });
  it("retains execution warnings and incomplete scope after all findings are reviewed", () => {
    const report = fixture(),
      review = state(report);
    review.findings["finding-1"].status = "REVIEWED";
    report.checks = [check("Build", { status: "WARNING" })];
    report.pr.files[0].patch = undefined;
    report.pr.warnings = ["Some changes could not be retrieved."];
    const plan = buildReviewPlan(report, review, snapshot(report), now);
    expect(plan.actions.map((action) => action.id)).toEqual(
      expect.arrayContaining([
        "execution-warnings",
        "partial-scope",
        "limitations",
      ]),
    );
    expect(
      plan.actions.find((action) => action.id === "file-0")?.fileIndex,
    ).toBe(0);
  });
  it("can complete these review steps without claiming merge approval", () => {
    const report = fixture(),
      review = state(report);
    review.findings["finding-1"].status = "REVIEWED";
    report.pr.files.forEach((file) => {
      file.risk.level = "LOW";
    });
    report.checks = ["Build", "TypeScript", "Existing tests"].map((type) =>
      check(type),
    );
    expect(
      buildReviewPlan(report, review, snapshot(report), now).actions,
    ).toEqual([]);
    const markdown = reviewPlanMarkdown(report, review, snapshot(report), now);
    expect(markdown).toContain("not merge approval or proof of safety");
    expect(markdown).toContain("No outstanding actions identified");
  });
  it("rejects decisions and revision snapshots for other scopes", () => {
    const report = fixture(),
      review = state(report),
      revision = snapshot(report);
    review.headSha = "e".repeat(40);
    expect(() => buildReviewPlan(report, review, null, now)).toThrow(
      "decisions do not match",
    );
    revision.recordedBase = "f".repeat(40);
    expect(() => buildReviewPlan(report, null, revision, now)).toThrow(
      "check does not match",
    );
  });
  it("exports saved notes safely, pinned revisions, limitations, and an expired snapshot", () => {
    const report = fixture(),
      review = state(report),
      revision = snapshot(report);
    report.findings[0].title = "[click](javascript:evil)\n# Forged";
    review.findings["finding-1"].note = "<script>alert(1)</script>\n# injected";
    const markdown = reviewPlanMarkdown(report, review, revision, now + 300000);
    expect(markdown).toContain(report.pr.headSha);
    expect(markdown).toContain("check expired");
    expect(markdown).toContain("Only saved decisions");
    expect(markdown).not.toContain("<script>");
    expect(markdown).not.toContain("\n# Forged");
    expect(markdown).not.toContain("[click](javascript:");
  });
});

describe("workbench review focus", () => {
  it("filters by saved decisions and refuses missing or mismatched review state", () => {
    const report = fixture(),
      review = state(report);
    expect(
      filterWorkbenchFiles(report, report.pr.files, "", "OPEN", review),
    ).toHaveLength(2);
    expect(
      filterWorkbenchFiles(report, report.pr.files, "", "NEEDS_FIX", review),
    ).toHaveLength(0);
    review.findings["finding-1"].status = "NEEDS_FIX";
    expect(
      filterWorkbenchFiles(
        report,
        report.pr.files,
        "reset",
        "NEEDS_FIX",
        review,
      ).map((file) => file.path),
    ).toEqual(["src/auth/reset.ts"]);
    expect(
      filterWorkbenchFiles(report, report.pr.files, "", "OPEN", review),
    ).toHaveLength(0);
    expect(
      filterWorkbenchFiles(report, report.pr.files, "", "OPEN", null),
    ).toHaveLength(0);
    review.headSha = "c".repeat(40);
    expect(
      filterWorkbenchFiles(report, report.pr.files, "", "NEEDS_FIX", review),
    ).toHaveLength(0);
  });
  it("retains a file with multiple findings when any saved decision matches", () => {
    const report = fixture();
    report.findings.push({
      ...structuredClone(report.findings[0]),
      id: "finding-2",
    });
    const review = state(report);
    review.findings["finding-1"].status = "DISMISSED";
    expect(
      filterWorkbenchFiles(report, report.pr.files, "", "OPEN", review),
    ).toHaveLength(2);
    review.findings["finding-2"].status = "REVIEWED";
    expect(
      filterWorkbenchFiles(report, report.pr.files, "", "OPEN", review),
    ).toHaveLength(0);
  });
  it("combines case-insensitive terms with category/status and risk scope", () => {
    const report = fixture();
    report.pr.files[0].risk.level = "LOW";
    expect(
      filterWorkbenchFiles(report, report.pr.files, "SRC AUTH", "ALL"),
    ).toHaveLength(2);
    expect(
      filterWorkbenchFiles(report, report.pr.files, "src auth", "HIGH"),
    ).toHaveLength(1);
    expect(
      filterWorkbenchFiles(report, report.pr.files, "modified", "ALL"),
    ).toHaveLength(3);
    expect(
      filterWorkbenchFiles(report, report.pr.files, "nothing", "ALL"),
    ).toEqual([]);
  });
  it("shows finding-linked files without inventing a match", () => {
    const report = fixture();
    expect(
      filterWorkbenchFiles(report, report.pr.files, "", "FINDINGS").map(
        (file) => file.path,
      ),
    ).toEqual(["src/auth/reset.ts", "src/auth/token.ts"]);
  });
  it("requires real scoped execution for high-risk gap filtering", () => {
    const report = fixture();
    report.checks = [check("Build", { filePaths: [report.pr.files[0].path] })];
    expect(
      filterWorkbenchFiles(report, report.pr.files, "", "GAPS"),
    ).toHaveLength(2);
    report.mode = "DEMO";
    expect(
      filterWorkbenchFiles(report, report.pr.files, "", "GAPS"),
    ).toHaveLength(3);
  });
});

describe("revision snapshot validation", () => {
  it("honors numeric and HTTP-date cooldowns with bounded malformed-header fallback", () => {
    expect(revisionRetryDelay("30", now)).toBe(30000);
    expect(revisionRetryDelay(new Date(now + 45000).toUTCString(), now)).toBe(
      45000,
    );
    expect(revisionRetryDelay("99999999", now)).toBe(3600000);
    expect(revisionRetryDelay("0", now)).toBe(1000);
    for (const value of [
      null,
      "",
      "-5",
      "1.5",
      "tomorrow",
      "Infinity",
      new Date(now - 1000).toUTCString(),
    ])
      expect(revisionRetryDelay(value, now)).toBe(15000);
  });
  it("detects base-only and head-only movement and exact expiry", () => {
    const value = snapshot(fixture());
    expect(revisionChanges(value)).toEqual({ base: false, head: false });
    value.currentBase = "c".repeat(40);
    expect(revisionChanges(value)).toEqual({ base: true, head: false });
    value.currentBase = value.recordedBase;
    value.currentHead = "d".repeat(40);
    expect(revisionChanges(value)).toEqual({ base: false, head: true });
    expect(revisionCheckExpired(value, now + 299999)).toBe(false);
    expect(revisionCheckExpired(value, now + 300000)).toBe(true);
    expect(revisionCheckExpired(value, now - 60001)).toBe(true);
  });
  it("rejects malformed hashes, timestamps, states, IDs, and extra fields", () => {
    const value = snapshot(fixture());
    for (const change of [
      { currentHead: "main" },
      { checkedAt: "yesterday" },
      { state: "SAFE" },
      { reportId: "../report" },
      { token: "not-a-valid-field" },
    ])
      expect(
        revisionCheckSchema.safeParse({ ...value, ...change }).success,
      ).toBe(false);
  });
});

const repos = { get: vi.fn() },
  pulls = { get: vi.fn() };
let routeSequence = 0;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ORIGIN", "");
  vi.stubEnv("APP_AUTH_USERNAME", "");
  vi.stubEnv("APP_AUTH_PASSWORD", "");
  vi.mocked(githubClient).mockReturnValue({
    repos,
    pulls,
  } as unknown as ReturnType<typeof githubClient>);
  repos.get.mockResolvedValue({ data: { private: false } });
  const report = fixture();
  report.pr.repo = `revision-test-${routeSequence++}`;
  vi.mocked(getReport).mockResolvedValue(report);
  pulls.get.mockResolvedValue({
    data: {
      base: { sha: report.pr.baseSha },
      head: { sha: report.pr.headSha },
      state: "open",
      merged: false,
      draft: false,
    },
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const context = {
  params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
};
function request(headers?: HeadersInit) {
  return new Request(
    "http://localhost:3000/api/reports/11111111-1111-4111-8111-111111111111/revision",
    { method: "POST", headers },
  );
}

describe("GitHub revision service and API", () => {
  it.each([
    ["open", false, false, "OPEN"],
    ["open", false, true, "OPEN"],
    ["closed", false, false, "CLOSED"],
    ["closed", true, false, "MERGED"],
  ])(
    "reads exact revision and lifecycle state (%s/%s/%s)",
    async (state, merged, draft, expected) => {
      const report = fixture();
      pulls.get.mockResolvedValue({
        data: {
          base: { sha: "c".repeat(40) },
          head: { sha: "d".repeat(40) },
          state,
          merged,
          draft,
        },
      });
      const result = await checkPullRequestRevision(report);
      expect(result).toMatchObject({
        recordedHead: report.pr.headSha,
        currentHead: "d".repeat(40),
        currentBase: "c".repeat(40),
        state: expected,
        draft,
      });
      expect(pulls.get).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: "acme",
          repo: "platform",
          pull_number: 127,
        }),
      );
    },
  );
  it("rejects private repositories before requesting their PR", async () => {
    repos.get.mockResolvedValue({ data: { private: true } });
    await expect(checkPullRequestRevision(fixture())).rejects.toThrow(
      "public repositories only",
    );
    expect(pulls.get).not.toHaveBeenCalled();
  });
  it("does not request GitHub after cancellation", async () => {
    await expect(
      checkPullRequestRevision(fixture(), AbortSignal.abort()),
    ).rejects.toThrow();
    expect(githubClient).not.toHaveBeenCalled();
  });
  it("bounds concurrent revision requests and releases slots after completion", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    repos.get.mockImplementation(async () => {
      await gate;
      return { data: { private: false } };
    });
    const first = fixture(),
      second = fixture(),
      third = fixture();
    first.pr.repo = `concurrent-a-${routeSequence}`;
    second.pr.repo = `concurrent-b-${routeSequence}`;
    third.pr.repo = `concurrent-c-${routeSequence++}`;
    vi.mocked(getReport)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(third);
    const a = POST(request(), context),
      b = POST(request(), context);
    try {
      await vi.waitFor(() => expect(repos.get).toHaveBeenCalledTimes(2));
      expect((await POST(request(), context)).status).toBe(429);
    } finally {
      release();
      const results = await Promise.all([a, b]);
      expect(results.every((result) => result.status === 200)).toBe(true);
    }
  });
  it("rejects invalid stored repository references and incomplete upstream data", async () => {
    const report = fixture();
    report.pr.owner = "../elsewhere";
    await expect(checkPullRequestRevision(report)).rejects.toThrow();
    expect(repos.get).not.toHaveBeenCalled();
    pulls.get.mockResolvedValue({
      data: {
        base: { sha: "main" },
        head: { sha: "short" },
        state: "open",
        merged: false,
      },
    });
    await expect(checkPullRequestRevision(fixture())).rejects.toThrow(
      "incomplete revision data",
    );
  });
  it("propagates actionable GitHub rate-limit errors without token data", async () => {
    pulls.get.mockRejectedValue({
      status: 429,
      message: "rate limit",
      response: { headers: { "retry-after": "30" } },
    });
    await expect(checkPullRequestRevision(fixture())).rejects.toThrow(
      "rate limit reached",
    );
  });
  it("returns a validated no-store snapshot and throttles repeated PR checks", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(revisionCheckSchema.safeParse(await response.json()).success).toBe(
      true,
    );
    const again = await POST(request(), context);
    expect(again.status).toBe(429);
    expect(again.headers.get("retry-after")).toBe("15");
    expect(pulls.get).toHaveBeenCalledTimes(1);
  });
  it("allows retry after the cooldown and releases a failed request slot", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    pulls.get.mockRejectedValueOnce({ status: 503 });
    expect((await POST(request(), context)).status).toBe(502);
    clock.mockReturnValue(now + 15000);
    expect((await POST(request(), context)).status).toBe(200);
  });
  it("protects the API independently of the request proxy", async () => {
    vi.stubEnv("APP_AUTH_USERNAME", "reviewer");
    vi.stubEnv("APP_AUTH_PASSWORD", "long-enough-revision-test-password");
    expect((await POST(request(), context)).status).toBe(401);
    expect(getReport).not.toHaveBeenCalled();
  });
  it("returns cancellation safely without contacting GitHub", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/reports/test/revision", {
        method: "POST",
        signal: AbortSignal.abort(),
      }),
      context,
    );
    expect(response.status).toBe(504);
    expect((await response.json()).error).toContain("cancelled");
    expect(githubClient).not.toHaveBeenCalled();
  });
  it("rejects a cross-origin request before storage or GitHub", async () => {
    expect(
      (await POST(request({ origin: "https://attacker.example" }), context))
        .status,
    ).toBe(403);
    expect(getReport).not.toHaveBeenCalled();
    expect(githubClient).not.toHaveBeenCalled();
  });
  it("rejects invalid IDs, missing reports, and both kinds of demo reports", async () => {
    expect(
      (await POST(request(), { params: Promise.resolve({ id: "../bad" }) }))
        .status,
    ).toBe(400);
    expect(
      (await POST(request(), { params: Promise.resolve({ id: "demo" }) }))
        .status,
    ).toBe(400);
    expect(getReport).not.toHaveBeenCalled();
    vi.mocked(getReport).mockResolvedValueOnce(null);
    expect((await POST(request(), context)).status).toBe(404);
    vi.mocked(getReport).mockResolvedValueOnce({ ...fixture(), mode: "DEMO" });
    expect((await POST(request(), context)).status).toBe(400);
    expect(githubClient).not.toHaveBeenCalled();
  });
});
