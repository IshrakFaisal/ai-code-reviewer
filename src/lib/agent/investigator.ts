import { randomUUID } from "node:crypto";
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
import {
  STAGES,
  type AnalysisReport,
  type AgentEvent,
  type Finding,
} from "@/lib/types";

export async function investigate(
  input: { input: string; prNumber?: number; demo?: boolean },
  onEvent: (event: AgentEvent) => void = () => {},
  signal?: AbortSignal,
): Promise<AnalysisReport> {
  const config = getConfig();
  const demo = config.demo || input.demo === true;
  const events: AgentEvent[] = [];
  const warnings: string[] = [];
  const progress = async (stage: number, detail: string, phase?: string) => {
    signal?.throwIfAborted();
    const event = {
      stage,
      detail,
      label: STAGES[stage],
      at: new Date().toISOString(),
      phase,
    };
    events.push(event);
    onEvent(event);
    if (demo) await new Promise((resolve) => setTimeout(resolve, 180));
  };
  const pr = demo
    ? samplePullRequest()
    : await fetchPullRequest(
        parseGitHubInput(input.input, input.prNumber),
        progress,
        signal,
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
  if (!demo && !ai)
    warnings.push(
      "Nebius credentials or model missing. Behavioral analysis uses path heuristics; no model findings or tests are invented.",
    );
  let intent = demo
    ? "Introduce email-based password recovery with expiring reset tokens and a new account recovery flow."
    : pr.description.slice(0, 600) || pr.title;
  if (ai)
    try {
      intent = await ai.analyzePullRequest(pr);
      provider = ai.name;
    } catch (e) {
      warnings.push((e as Error).message);
      ai = undefined;
    }
  await progress(3, intent, "OBSERVE");
  let categorySource = "path heuristics";
  if (ai)
    try {
      pr.files = refineCategories(pr.files, await ai.refineFileCategories(pr));
      for (const file of pr.files)
        file.risk = assessRisk(file, [], configuredWeights());
      categorySource = "path heuristics with additive AI inference";
      warnings.push(
        "AI category refinements are inferences added to path-based categories. They cannot remove deterministic risk signals; scores still use configured deterministic weights.",
      );
    } catch {
      warnings.push(
        "AI category refinement unavailable; deterministic categories retained.",
      );
    }
  await progress(
    4,
    `${new Set(pr.files.flatMap((f) => f.categories)).size} categories identified using ${categorySource}`,
  );
  let behaviors = demo ? sampleBehaviors : heuristicBehaviors(pr);
  if (ai)
    try {
      behaviors = await ai.identifyBehavioralChanges(pr);
    } catch {
      warnings.push(
        "Behavior analysis unavailable; path-based observations shown.",
      );
    }
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
  if (ai)
    try {
      hypotheses = await ai.generateRiskHypotheses(
        pr,
        config.maxInvestigations,
      );
    } catch {
      warnings.push(
        "Hypothesis generation unavailable; deterministic review priorities retained.",
      );
    }
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
  for (const f of findings) {
    if (demo && f.id === "finding-1") f.generatedTest = demoGeneratedTest;
    else if (ai)
      try {
        f.generatedTest = await ai.generateVerificationPlan(pr, f);
      } catch {
        warnings.push(`Test generation unavailable for: ${f.title}`);
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
      : "Running static checks and checking execution availability",
    "EXECUTE",
  );
  if (demo) {
    try {
      const results = await runDemoFixture();
      if (findings[0]) findings[0].evidence.push(...results);
      checks.push(...results);
    } catch (e) {
      warnings.push((e as Error).message);
      findings[0]?.evidence.push(
        notRun(
          "Generated test",
          "Fixture execution unavailable in this environment.",
        ),
      );
    }
    checks.push(
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
  } else checks.push(...(await runLiveVerification(pr, findings, signal)));
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
    id: randomUUID(),
    createdAt: new Date().toISOString(),
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
