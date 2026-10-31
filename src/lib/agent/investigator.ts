import { randomUUID } from "node:crypto";
import { z } from "zod";
import { checkpointSteps, type InvestigationSession } from "./checkpoint";
import { analysisReportSchema } from "@/lib/reports/schema";
import { categoryRefinementSchema, hypothesisSchema } from "@/lib/ai/provider";
import { testContextLoader } from "@/lib/ai/test-context";
import { getConfig } from "@/lib/config";
import { parseGitHubInput } from "@/lib/github/input";
import { fetchPullRequest } from "@/lib/github/pull-request";
import {
  samplePullRequest,
  sampleHypotheses,
  sampleBehaviors,
} from "@/lib/demo/sample-analysis";
import { demoGeneratedTest, runDemoFixture } from "@/lib/demo/fixture";
import { NebiusProvider } from "@/lib/ai/nebius";
import {
  heuristicBehaviors,
  heuristicHypotheses,
} from "@/lib/analysis/behavioral-change";
import { blastRadius } from "@/lib/analysis/blast-radius";
import { refineCategories } from "@/lib/analysis/categorizer";
import { assessRisk, reviewSurface, riskLevel } from "@/lib/risk/engine";
import { configuredWeights } from "@/lib/risk/signals";
import { staticChecks } from "@/lib/verification/static";
import { findingStatus, notRun } from "@/lib/verification/execution";
import { runLiveVerification } from "@/lib/verification/runner";
import { verificationCheckpointSchema } from "@/lib/verification/checkpoint";
import {
  STAGES,
  type AnalysisReport,
  type AgentEvent,
  type Finding,
} from "@/lib/types";

export async function investigate(
  input: { input: string; prNumber?: number; demo?: boolean },
  onEvent: (event: AgentEvent) => unknown = () => {},
  signal?: AbortSignal,
  session?: InvestigationSession,
): Promise<AnalysisReport> {
  const checkpoint = checkpointSteps(session);
  const fields = analysisReportSchema.shape;
  signal?.throwIfAborted();
  const settings = await checkpoint.step(
    "settings",
    z.object({
      demo: z.boolean(),
      maxInvestigations: z.number().int().min(1).max(10),
      createdAt: z.iso.datetime(),
    }),
    async () => ({
      demo: getConfig().demo || input.demo === true,
      maxInvestigations: getConfig().maxInvestigations,
      createdAt: new Date().toISOString(),
    }),
  );
  const { demo } = settings;
  const config = settings;
  const events = checkpoint.events;
  const warnings: string[] = [];
  const progress = async (
    stage: number,
    detail: string,
    phase?: string,
    status: AgentEvent["status"] = "COMPLETE",
  ) => {
    signal?.throwIfAborted();
    const event = {
      stage,
      status,
      detail,
      label: STAGES[stage],
      at: new Date().toISOString(),
      phase,
    };
    if (!(await checkpoint.event(event))) return;
    await onEvent(event);
    if (demo) await new Promise((resolve) => setTimeout(resolve, 180));
  };
  const pr = await checkpoint.step("pullRequest", fields.pr, async () =>
    demo
      ? samplePullRequest()
      : await fetchPullRequest(
          parseGitHubInput(input.input, input.prNumber),
          progress,
          signal,
        ),
  );
  if (demo) {
    await progress(0, "Loaded acme/platform · synthetic repository");
    await progress(1, `#${pr.number} · ${pr.title}`);
    await progress(
      2,
      `${pr.changedFiles} files · ${pr.additions + pr.deletions} changed lines (abbreviated excerpts)`,
    );
  }
  warnings.push(...pr.warnings);
  if (!demo)
    warnings.push(
      "AI context is bounded to 60 files and 75,000 patch characters, ordered by deterministic risk. Static checks inspect all retrieved patches (up to 500 files).",
    );
  let provider = demo
    ? "Deterministic demo provider"
    : "Deterministic analysis";
  let ai: NebiusProvider | undefined =
    !demo && process.env.NEBIUS_API_KEY && process.env.NEBIUS_MODEL
      ? new NebiusProvider(signal)
      : undefined;
  const defaultIntent = demo
    ? "Introduce email-based password recovery with expiring reset tokens and a new account recovery flow."
    : pr.description.slice(0, 600) || pr.title;
  const intentResult = await checkpoint.step(
    "intent",
    z.object({
      value: z.string().max(20000),
      provider: z.string().max(4096),
      useAI: z.boolean(),
      warning: z.string(),
    }),
    async () => {
      try {
        return {
          value: ai ? await ai.analyzePullRequest(pr) : defaultIntent,
          provider: ai?.name ?? provider,
          useAI: !!ai,
          warning: "",
        };
      } catch (error) {
        signal?.throwIfAborted();
        return {
          value: defaultIntent,
          provider,
          useAI: false,
          warning: (error as Error).message,
        };
      }
    },
  );
  const intent = intentResult.value;
  provider = intentResult.provider;
  if (!intentResult.useAI) ai = undefined;
  if (
    !demo &&
    !intentResult.useAI &&
    (!process.env.NEBIUS_API_KEY || !process.env.NEBIUS_MODEL)
  )
    warnings.push(
      "Nebius credentials or model missing. Behavioral analysis uses path heuristics; no model findings or tests are invented.",
    );
  if (intentResult.warning) warnings.push(intentResult.warning);
  async function optionalAI<T>(
    key: string,
    schema: z.ZodType<T>,
    fallback: T,
    warning: string,
    work: () => Promise<T>,
  ) {
    const result = await checkpoint.step(
      key,
      z.object({ value: schema, warning: z.string() }),
      async () => {
        try {
          return { value: await work(), warning: "" };
        } catch {
          signal?.throwIfAborted();
          return { value: fallback, warning };
        }
      },
    );
    if (result.warning) warnings.push(result.warning);
    return result;
  }
  await progress(3, intent, "OBSERVE");
  let categorySource = "path heuristics";
  if (intentResult.useAI) {
    const result = await optionalAI(
      "categories",
      z.array(categoryRefinementSchema).max(60),
      [],
      "AI category refinement unavailable; deterministic categories retained.",
      () => ai!.refineFileCategories(pr),
    );
    pr.files = refineCategories(pr.files, result.value);
    for (const file of pr.files)
      file.risk = assessRisk(file, [], configuredWeights());
    if (!result.warning)
      categorySource = "path heuristics with additive AI inference";
    if (!result.warning)
      warnings.push(
        "AI category refinements are inferences added to path-based categories. They cannot remove deterministic risk signals; scores still use configured deterministic weights.",
      );
  }
  await progress(
    4,
    `${new Set(pr.files.flatMap((f) => f.categories)).size} categories identified using ${categorySource}`,
  );
  let behaviors = demo ? sampleBehaviors : heuristicBehaviors(pr);
  if (intentResult.useAI)
    behaviors = (
      await optionalAI(
        "behaviors",
        fields.behaviors,
        behaviors,
        "Behavior analysis unavailable; path-based observations shown.",
        () => ai!.identifyBehavioralChanges(pr),
      )
    ).value;
  await progress(
    5,
    `${behaviors.length} behavioral observations; inference is labeled`,
    "THINK",
  );
  await progress(
    6,
    "Mapped potential connections using category heuristics; not a runtime dependency graph",
  );
  await progress(
    7,
    "Applied configurable deterministic weights to changed files",
  );
  let hypotheses = demo
    ? sampleHypotheses.slice(0, config.maxInvestigations)
    : heuristicHypotheses(pr, config.maxInvestigations);
  if (intentResult.useAI)
    hypotheses = (
      await optionalAI(
        "hypotheses",
        z.array(hypothesisSchema).max(10),
        hypotheses,
        "Hypothesis generation unavailable; deterministic review priorities retained.",
        () => ai!.generateRiskHypotheses(pr, config.maxInvestigations),
      )
    ).value;
  await progress(
    8,
    `${hypotheses.length} bounded investigations selected (limit ${config.maxInvestigations})`,
    "HYPOTHESIZE",
  );
  const findings: Finding[] = hypotheses.map((h, i) => {
    const score = Math.max(
      0,
      ...h.affectedFiles.map(
        (r) => pr.files.find((f) => f.path === r.path)?.risk.score || 0,
      ),
    );
    return {
      ...h,
      id: `finding-${i + 1}`,
      severity: riskLevel(score),
      status: "UNVERIFIED_RISK",
      riskScore: score,
      evidence: [],
    };
  });
  await progress(
    9,
    demo
      ? "Attempt two password resets with one token; second request must fail"
      : "Selected targeted regression strategies for each hypothesis",
    "PLAN",
  );
  const loadTestContext = testContextLoader(pr, signal);
  for (const f of findings) {
    if (demo && f.id === "finding-1") f.generatedTest = demoGeneratedTest;
    else if (intentResult.useAI) {
      const result = await checkpoint.step(
        `test:${f.id}`,
        z.object({
          plan: fields.findings.element.shape.generatedTest.unwrap().nullable(),
          warning: z.string(),
        }),
        async () => {
          try {
            const repository = await loadTestContext(f);
            const plan = await ai!.generateVerificationPlan(pr, f, repository);
            return { plan, warning: "" };
          } catch (error) {
            signal?.throwIfAborted();
            return {
              plan: null,
              warning: `Test generation unavailable for ${f.title}: ${error instanceof Error ? error.message.slice(0, 2400) : "Insufficient repository context."}`,
            };
          }
        },
      );
      if (result.plan) f.generatedTest = result.plan;
      if (result.plan?.context && result.plan.context.headSha !== pr.headSha)
        throw new Error(
          "Saved test context does not match the pinned revision. Start a new analysis.",
        );
      if (result.warning) warnings.push(result.warning);
    }
  }
  await progress(
    10,
    `${findings.filter((f) => f.generatedTest).length} targeted test templates ready`,
    "GENERATE",
  );
  const checks = staticChecks(pr);
  await progress(
    11,
    demo
      ? "Executing four assertions against the bundled password-reset fixture"
      : "Checking execution availability, preparing the sandbox, and running repository verification",
    "EXECUTE",
    "RUNNING",
  );
  const verification = await checkpoint.step(
    "verification",
    z.object({
      headSha: z.string(),
      baseSha: z.string(),
      checks: fields.checks,
      findings: fields.findings,
      warnings: z.array(z.string()),
    }),
    async () => {
      const verificationWarnings: string[] = [];
      const executionChecks = [] as AnalysisReport["checks"];
      if (demo) {
        try {
          const results = await runDemoFixture();
          if (findings[0]) findings[0].evidence.push(...results);
          executionChecks.push(...results);
        } catch (e) {
          verificationWarnings.push((e as Error).message);
          findings[0]?.evidence.push(
            notRun(
              "Generated test",
              "Fixture execution unavailable in this environment.",
            ),
          );
        }
        executionChecks.push(
          ...["Build", "TypeScript", "Existing tests"].map((t) =>
            notRun(t, "No real repository was checked out in demo mode."),
          ),
        );
        for (const f of findings.slice(1))
          f.evidence.push(
            notRun(
              "Generated test",
              "Requires repository context and external integration; not covered by the demo fixture.",
            ),
          );
      } else {
        const saved = checkpoint.read(
          "verificationProgress",
          verificationCheckpointSchema,
        );
        if (saved)
          verificationWarnings.push(
            "Verification resumed at the recorded commits in a fresh sandbox. Completed command and test results are retained; dependency installation and any successful build needed for preparation are repeated. Dependency resolution can differ between attempts.",
          );
        executionChecks.push(
          ...(await runLiveVerification(pr, findings, signal, {
            checkpoint: saved,
            persist: (value) =>
              checkpoint.write(
                "verificationProgress",
                verificationCheckpointSchema,
                value,
              ),
          })),
        );
      }
      signal?.throwIfAborted();
      return {
        headSha: pr.headSha,
        baseSha: pr.baseSha,
        checks: executionChecks,
        findings,
        warnings: verificationWarnings,
      };
    },
  );
  if (
    verification.headSha !== pr.headSha ||
    verification.baseSha !== pr.baseSha
  )
    throw new Error(
      "Saved verification does not match the pinned revisions. Start a new analysis.",
    );
  checks.push(...verification.checks);
  for (const finding of findings)
    finding.evidence =
      verification.findings.find((saved) => saved.id === finding.id)
        ?.evidence ?? [];
  warnings.push(...verification.warnings);
  await progress(
    11,
    "Verification finished; completed checks and unavailable checks are recorded separately",
    "EXECUTE",
  );
  for (const f of findings) f.status = findingStatus(f.evidence, demo);
  for (const file of pr.files)
    file.risk = assessRisk(
      file,
      [...checks, ...findings.flatMap((f) => f.evidence)],
      configuredWeights(),
    );
  for (const f of findings) {
    f.riskScore = Math.max(
      0,
      ...f.affectedFiles.map(
        (r) => pr.files.find((file) => file.path === r.path)?.risk.score || 0,
      ),
    );
    f.severity = riskLevel(f.riskScore);
  }
  await progress(
    12,
    `${findings.filter((f) => f.status === "VERIFIED_ISSUE").length} verified fixture issues · ${findings.filter((f) => f.status === "UNVERIFIED_RISK").length} unverified risks · ${findings.filter((f) => f.status === "INCONCLUSIVE").length} inconclusive`,
    "OBSERVE RESULT",
  );
  await progress(
    13,
    "Evidence linked to findings. Human review ordered by deterministic risk.",
    "CONCLUDE",
  );
  const total = pr.additions + pr.deletions;
  return {
    id: session?.id ?? randomUUID(),
    createdAt: settings.createdAt,
    mode: demo ? "DEMO" : "LIVE",
    provider,
    pr,
    summary: intent,
    findings: findings.sort((a, b) => b.riskScore - a.riskScore),
    checks,
    behaviors,
    events,
    warnings,
    riskMap: blastRadius(pr.files),
    reviewSurface: {
      ...reviewSurface(pr.files, findings, total),
      partial:
        pr.files.length < pr.changedFiles ||
        pr.files.some((f) => f.lines.length < f.additions + f.deletions),
    },
  };
}
