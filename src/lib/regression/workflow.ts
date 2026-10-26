import { randomUUID } from "node:crypto";
import {
  createSandboxProvider,
  selectedSandboxProvider,
} from "@/lib/sandbox/factory";
import { optionalFile } from "@/lib/sandbox/commands";
import type { SandboxProvider } from "@/lib/sandbox/provider";
import type { AnalysisReport, Finding } from "@/lib/types";
import { NebiusProvider } from "@/lib/ai/nebius";
import {
  compareRevisions,
  parseRegressionRun,
  sha256,
  stableRevision,
} from "./evidence";
import { groundRepair, repairSchema, validateRepairPath } from "./repair";
import type { RegressionResult, RepairProposal, RevisionResult } from "./types";
import { assertionNames } from "./comparison";

export type WorkflowProgress = (label: string) => void;
export const describeError = (error: unknown) =>
  error instanceof Error
    ? error.message.slice(0, 1600)
    : "Execution could not complete.";
export interface RegressionDependencies {
  sandbox?: (repository: string, signal?: AbortSignal) => SandboxProvider;
  propose?: (
    finding: Finding,
    originals: { path: string; content: string }[],
    previous: RegressionResult,
  ) => Promise<unknown>;
}
const commands = [
  ["Build", "build"],
  ["TypeScript", "typecheck"],
  ["Existing tests", "tests"],
] as const;

function requirePlan(report: AnalysisReport, finding: Finding) {
  if (
    report.mode !== "LIVE" ||
    !finding.generatedTest ||
    finding.generatedTest.framework !== "vitest"
  )
    throw new Error(
      "Live reproduction requires a saved live report and a generated Vitest test.",
    );
  if (
    !/^[a-f0-9]{40}$/.test(report.pr.baseSha) ||
    !/^[a-f0-9]{40}$/.test(report.pr.headSha) ||
    report.pr.baseSha === report.pr.headSha
  )
    throw new Error(
      "Reproduction requires distinct immutable base and head revisions.",
    );
  if (Buffer.byteLength(finding.generatedTest.code) > 16000)
    throw new Error("Generated test exceeds the supported size.");
}
async function environment(sandbox: SandboxProvider) {
  if (!sandbox.runtimeIdentity)
    throw new Error(
      "This provider cannot identify a consistent runtime. Use Docker or Nebius.",
    );
  const files = await Promise.all(
    [
      "package.json",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "node_modules/vitest/package.json",
    ].map(async (path) => [
      path,
      await optionalFile((p) => sandbox.readFile(p), path),
    ]),
  );
  return sha256(JSON.stringify([await sandbox.runtimeIdentity(), files]));
}
async function sources(sandbox: SandboxProvider, finding: Finding) {
  const result: { path: string; content: string }[] = [];
  let total = 0;
  for (const path of [
    ...new Set(finding.affectedFiles.map((f) => f.path)),
  ].slice(0, 8)) {
    try {
      validateRepairPath(path);
    } catch {
      continue;
    }
    const content = await optionalFile((p) => sandbox.readFile(p), path);
    if (
      content !== undefined &&
      Buffer.byteLength(content) <= 24000 &&
      total + content.length <= 32000
    ) {
      result.push({ path, content });
      total += content.length;
    }
    if (result.length === 3) break;
  }
  return result;
}
async function assertUnchanged(
  sandbox: SandboxProvider,
  originals: { path: string; content: string }[],
) {
  for (const file of originals)
    if ((await sandbox.readFile(file.path)) !== file.content)
      throw new Error(
        "A verification command changed protected source. Results are inconclusive.",
      );
}
async function testTwice(
  sandbox: SandboxProvider,
  code: string,
  result: RevisionResult,
  prefix: string,
  signal?: AbortSignal,
  progress: WorkflowProgress = () => {},
) {
  for (let i = 1; i <= 2; i++) {
    signal?.throwIfAborted();
    const filename = `${prefix}-${i}.test.ts`;
    progress(`Run ${i}/2 · ${prefix}`);
    await sandbox.writeFile(`.change-verifier/${filename}`, code);
    const execution = await sandbox.runCommand("generated", filename);
    if ((await sandbox.readFile(`.change-verifier/${filename}`)) !== code)
      throw new Error("The generated test was modified during execution.");
    result.runs.push(parseRegressionRun(execution, filename));
  }
}
async function checks(
  sandbox: SandboxProvider,
  result: RevisionResult,
  prefix: string,
  signal?: AbortSignal,
  progress: WorkflowProgress = () => {},
) {
  for (const [name, command] of commands) {
    signal?.throwIfAborted();
    progress(`${prefix} · ${name}`);
    try {
      const execution = await sandbox.runCommand(command);
      result.checks.push({
        name: `${prefix} · ${name}`,
        status:
          execution.exitCode === 0 && !execution.timedOut ? "PASS" : "FAIL",
        output: execution.output.slice(0, 16000),
      });
    } catch (error) {
      signal?.throwIfAborted();
      result.checks.push({
        name: `${prefix} · ${name}`,
        status: "NOT_RUN",
        output: describeError(error),
      });
    }
  }
}

async function revision(
  report: AnalysisReport,
  finding: Finding,
  sha: string,
  label: string,
  progress: WorkflowProgress,
  signal?: AbortSignal,
  dependencies: RegressionDependencies = {},
) {
  const result: RevisionResult = { revision: sha, runs: [], checks: [] };
  let sandbox: SandboxProvider | undefined;
  try {
    progress(`Prepare isolated ${label} checkout · ${sha.slice(0, 8)}`);
    sandbox = (dependencies.sandbox || createSandboxProvider)(
      `${report.pr.owner}/${report.pr.repo}`,
      signal,
    );
    await sandbox.createSandbox();
    const pinned = { ...report.pr, headSha: sha };
    await sandbox.cloneRepository(pinned);
    await sandbox.checkoutPullRequest(pinned);
    signal?.throwIfAborted();
    const install = await sandbox.installDependencies();
    if (install.exitCode || install.timedOut)
      throw new Error(
        "Dependency installation failed; no behavioral conclusion can be drawn.",
      );
    result.environmentHash = await environment(sandbox);
    const originals = await sources(sandbox, finding);
    await testTwice(
      sandbox,
      finding.generatedTest!.code,
      result,
      label,
      signal,
      progress,
    );
    await assertUnchanged(sandbox, originals);
    if (result.environmentHash !== (await environment(sandbox)))
      throw new Error("Dependencies or runtime changed during verification.");
  } catch (error) {
    signal?.throwIfAborted();
    result.error = describeError(error);
  } finally {
    if (sandbox)
      await sandbox.destroySandbox().catch(() => {
        result.error =
          "Sandbox cleanup could not be confirmed; operator follow-up is required.";
      });
  }
  return result;
}

export async function reproduce(
  report: AnalysisReport,
  finding: Finding,
  progress: WorkflowProgress = () => {},
  signal?: AbortSignal,
  dependencies: RegressionDependencies = {},
): Promise<RegressionResult> {
  requirePlan(report, finding);
  const events: RegressionResult["events"] = [];
  const emit = (label: string) => {
    events.push({ label, at: new Date().toISOString() });
    progress(label);
  };
  // Independent checkouts keep each revision's dependency installation isolated.
  const outcomes = await Promise.allSettled([
    revision(
      report,
      finding,
      report.pr.baseSha,
      "base",
      emit,
      signal,
      dependencies,
    ),
    revision(
      report,
      finding,
      report.pr.headSha,
      "head",
      emit,
      signal,
      dependencies,
    ),
  ]);
  signal?.throwIfAborted();
  if (outcomes[0].status === "rejected") throw outcomes[0].reason;
  if (outcomes[1].status === "rejected") throw outcomes[1].reason;
  const [base, head] = [outcomes[0].value, outcomes[1].value];
  const verdict = compareRevisions(base, head);
  emit("Compare completed assertion identities and repeatability");
  return {
    version: 1,
    id: randomUUID(),
    reportId: report.id,
    findingId: finding.id,
    mode: "LIVE",
    provider: selectedSandboxProvider(),
    createdAt: new Date().toISOString(),
    baseSha: report.pr.baseSha,
    headSha: report.pr.headSha,
    test: {
      filename: "regression.test.ts",
      code: finding.generatedTest!.code,
      sha256: sha256(finding.generatedTest!.code),
      framework: "vitest",
    },
    base,
    head,
    verdict,
    events,
    limitations: [
      "Results support only the generated assertions; their intended behavior still requires human review.",
      "Each revision is run twice. Matching package/lockfile, installed Vitest, runtime, and image fingerprints are required; dependency changes are inconclusive.",
      "Execution does not establish complete behavioral coverage or merge safety. No GitHub writes are performed.",
      "The comparison uses recorded base/head tips and does not isolate every intervening change or prove causation.",
      ...(base.environmentHash !== head.environmentHash
        ? ["The recorded execution environments differ or are unavailable."]
        : []),
    ],
  };
}

export async function repairAndRecheck(
  report: AnalysisReport,
  finding: Finding,
  previous: RegressionResult,
  progress: WorkflowProgress = () => {},
  signal?: AbortSignal,
  dependencies: RegressionDependencies = {},
): Promise<RegressionResult> {
  requirePlan(report, finding);
  if (
    previous.mode !== "LIVE" ||
    previous.reportId !== report.id ||
    previous.findingId !== finding.id ||
    previous.baseSha !== report.pr.baseSha ||
    previous.headSha !== report.pr.headSha ||
    previous.test.sha256 !== sha256(finding.generatedTest!.code) ||
    previous.test.code !== finding.generatedTest!.code ||
    previous.verdict !== "REGRESSION_REPRODUCED" ||
    compareRevisions(previous.base, previous.head) !== "REGRESSION_REPRODUCED"
  )
    throw new Error(
      "Reproduce a stable regression for the current test and commits before requesting a repair.",
    );
  const result: RegressionResult = {
    ...previous,
    events: [...previous.events],
    repair: { status: "INCONCLUSIVE", provider: "Nebius" },
  };
  const emit = (label: string) => {
    result.events.push({ label, at: new Date().toISOString() });
    progress(label);
  };
  const revisionResult: RevisionResult = {
    revision: report.pr.headSha,
    runs: [],
    checks: [],
  };
  result.repair!.result = revisionResult;
  let sandbox: SandboxProvider | undefined;
  try {
    emit("Prepare a fresh isolated head checkout for repair");
    sandbox = (dependencies.sandbox || createSandboxProvider)(
      `${report.pr.owner}/${report.pr.repo}`,
      signal,
    );
    if (!sandbox.replaceSource)
      throw new Error(
        "This execution provider does not support guarded source repairs.",
      );
    await sandbox.createSandbox();
    await sandbox.cloneRepository(report.pr);
    await sandbox.checkoutPullRequest(report.pr);
    const install = await sandbox.installDependencies();
    if (install.exitCode || install.timedOut)
      throw new Error("Dependency installation failed.");
    revisionResult.environmentHash = await environment(sandbox);
    if (revisionResult.environmentHash !== previous.head.environmentHash)
      throw new Error(
        "Repair environment differs from the reproduced regression.",
      );
    const originals = await sources(sandbox, finding);
    if (!originals.length)
      throw new Error(
        "No supported, bounded application source files are available for a repair.",
      );
    const confirmation: RevisionResult = {
      revision: report.pr.headSha,
      environmentHash: revisionResult.environmentHash,
      runs: [],
      checks: [],
    };
    await testTwice(
      sandbox,
      previous.test.code,
      confirmation,
      "confirm-head",
      signal,
      emit,
    );
    if (
      !stableRevision(confirmation) ||
      JSON.stringify(
        confirmation.runs[0].assertions.map((a) => [a.name, a.status]).sort(),
      ) !==
        JSON.stringify(
          previous.head.runs[0].assertions
            .map((a) => [a.name, a.status])
            .sort(),
        )
    )
      throw new Error(
        "The original head failure could not be reproduced again.",
      );
    await checks(sandbox, revisionResult, "Before repair", signal, emit);
    await assertUnchanged(sandbox, originals);
    emit(
      "Ask Nebius for one bounded source repair; the regression test stays unchanged",
    );
    const ai = new NebiusProvider(signal);
    const raw = dependencies.propose
      ? await dependencies.propose(finding, originals, previous)
      : await ai.structured(
          "Propose one minimal repair for the reproduced behavioral regression. Return complete replacement content for at most three supplied application source files. Preserve APIs and unrelated behavior. Never edit tests, dependency manifests, configuration, or runner files. No shell commands. If you cannot repair using the supplied files, return an empty files array rather than inventing paths.",
          {
            hypothesis: {
              title: finding.title,
              category: finding.category,
              description: finding.description,
              behavioralChange: finding.behavioralChange,
              potentialImpact: finding.potentialImpact,
              recommendation: finding.recommendation,
              affectedFiles: finding.affectedFiles,
            },
            sourceFiles: originals,
            test: previous.test.code,
            baseAssertions: previous.base.runs[0].assertions,
            headAssertions: previous.head.runs[0].assertions,
          },
          repairSchema.extend({ files: repairSchema.shape.files.min(0) }),
        );
    result.repair!.provider = dependencies.propose ? "Test provider" : ai.name;
    const proposal: RepairProposal = groundRepair(raw, originals);
    result.repair!.proposal = proposal;
    signal?.throwIfAborted();
    emit("Apply hash-guarded source replacements inside the sandbox");
    for (const file of proposal.files)
      await sandbox.replaceSource(file.path, file.originalHash, file.after);
    const patched = originals.map((f) => ({
      path: f.path,
      content:
        proposal.files.find((p) => p.path === f.path)?.after ?? f.content,
    }));
    await testTwice(
      sandbox,
      previous.test.code,
      revisionResult,
      "repair",
      signal,
      emit,
    );
    await checks(sandbox, revisionResult, "After repair", signal, emit);
    await assertUnchanged(sandbox, patched);
    if (revisionResult.environmentHash !== (await environment(sandbox)))
      throw new Error("Repair changed execution dependencies or runtime.");
    const originalNames = assertionNames(previous.head);
    const repairedNames = assertionNames(revisionResult);
    const after = revisionResult.checks.filter((c) =>
      c.name.startsWith("After repair"),
    );
    result.repair!.status =
      stableRevision(revisionResult) &&
      revisionResult.runs.every((r) => r.status === "PASS") &&
      originalNames === repairedNames &&
      after.length === 3 &&
      after.every((c) => c.status === "PASS")
        ? "VALIDATED_FOR_TEST"
        : after.some((c) => c.status === "FAIL") ||
            revisionResult.runs.some((r) => r.status === "FAIL")
          ? "CHECKS_FAILED"
          : "INCONCLUSIVE";
    emit(
      "Repair checks completed; review the patch and evidence before applying it",
    );
  } catch (error) {
    signal?.throwIfAborted();
    result.repair!.error = describeError(error);
  } finally {
    if (sandbox)
      await sandbox.destroySandbox().catch(() => {
        result.repair!.status = "INCONCLUSIVE";
        result.repair!.error =
          "Sandbox cleanup could not be confirmed; operator follow-up is required.";
      });
  }
  return result;
}
