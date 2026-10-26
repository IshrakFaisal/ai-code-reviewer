import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { RESET_FIXTURE, REUSE_TEST } from "@/lib/demo/fixture";
import type { AnalysisReport, Finding } from "@/lib/types";
import { compareRevisions, parseRegressionRun, sha256 } from "./evidence";
import type { RegressionResult, RevisionResult } from "./types";
import type { WorkflowProgress } from "./workflow";

// Only these application-owned constants can reach the host fixture runner.
// Repository files, model output, saved test strings, and patches never execute here.
const fixedReset = RESET_FIXTURE.replace(
  "// Intentional demo defect: successful reset does not consume the token.",
  "tokens.delete(token);",
);
export const fixtureScenarios = [
  {
    id: "token-reuse",
    title: "Reset token becomes reusable",
    base: fixedReset,
    head: RESET_FIXTURE,
    repaired: fixedReset,
    test: REUSE_TEST,
    expected: "REGRESSION_REPRODUCED",
  },
  {
    id: "authorization",
    title: "Owner permission check removed",
    base: "function allowed(owner, actor) { return owner === actor; }",
    head: "function allowed(owner, actor) { return true; }",
    repaired: "function allowed(owner, actor) { return owner === actor; }",
    test: 'assert.equal(allowed("alice", "mallory"), false, "Only the owner can access the record");',
    expected: "REGRESSION_REPRODUCED",
  },
  {
    id: "validation",
    title: "Negative payment validation removed",
    base: "function valid(amount) { return Number.isFinite(amount) && amount > 0; }",
    head: "function valid(amount) { return Number.isFinite(amount); }",
    repaired:
      "function valid(amount) { return Number.isFinite(amount) && amount > 0; }",
    test: 'assert.equal(valid(-10), false, "Negative amounts must be rejected");',
    expected: "REGRESSION_REPRODUCED",
  },
  {
    id: "healthy-refactor",
    title: "Equivalent permission refactor",
    base: "function allowed(owner, actor) { return owner === actor; }",
    head: "function allowed(owner, actor) { const isOwner = owner === actor; return isOwner; }",
    repaired:
      "function allowed(owner, actor) { const isOwner = owner === actor; return isOwner; }",
    test: 'assert.equal(allowed("alice", "mallory"), false); assert.equal(allowed("alice", "alice"), true);',
    expected: "NO_REGRESSION_OBSERVED",
  },
  {
    id: "healthy-addition",
    title: "Unrelated function addition",
    base: "function valid(amount) { return Number.isFinite(amount) && amount > 0; }",
    head: "function formatCurrency(amount) { return String(amount); }\nfunction valid(amount) { return Number.isFinite(amount) && amount > 0; }",
    repaired:
      "function formatCurrency(amount) { return String(amount); }\nfunction valid(amount) { return Number.isFinite(amount) && amount > 0; }",
    test: "assert.equal(valid(-10), false); assert.equal(valid(10), true);",
    expected: "NO_REGRESSION_OBSERVED",
  },
] as const;
export type FixtureId = (typeof fixtureScenarios)[number]["id"];

export async function executeTrustedFixture(
  id: FixtureId,
  revision: "base" | "head" | "repaired",
  signal?: AbortSignal,
) {
  const fixture = fixtureScenarios.find((s) => s.id === id);
  if (!fixture) throw new Error("Unknown bundled fixture.");
  const filename = "fixture.test.ts";
  const script = `import assert from 'node:assert/strict';\n${fixture[revision]}\nlet failure; try { ${fixture.test} } catch(error) { failure=String(error); }\nconsole.log(JSON.stringify({success:!failure,numTotalTests:1,numPassedTests:failure?0:1,numFailedTests:failure?1:0,testResults:[{name:'/.change-verifier/${filename}',assertionResults:[{fullName:${JSON.stringify(fixture.title)},status:failure?'failed':'passed',failureMessages:failure?[failure]:[]}]}]})); process.exitCode=failure?1:0;`;
  const started = Date.now();
  const execution = await new Promise<{
    output: string;
    exitCode: number;
    durationMs: number;
    timedOut: boolean;
  }>((resolve, reject) => {
    execFile(
      process.execPath,
      ["--input-type=module", "--eval", script],
      {
        timeout: 10000,
        maxBuffer: 24000,
        windowsHide: true,
        signal,
        env: { SystemRoot: process.env.SystemRoot, NODE_ENV: "test" },
      },
      (error, stdout) => {
        if (error && (!stdout || signal?.aborted)) {
          reject(
            new Error(
              "Trusted fixture execution was interrupted or unavailable.",
            ),
          );
          return;
        }
        resolve({
          output: stdout,
          exitCode: error ? 1 : 0,
          durationMs: Date.now() - started,
          timedOut: !!error && "killed" in error && error.killed === true,
        });
      },
    );
  });
  return parseRegressionRun(execution, filename);
}

export async function demoReproduction(
  report: AnalysisReport,
  finding: Finding,
  action: "reproduce" | "repair",
  previous?: RegressionResult,
  progress: WorkflowProgress = () => {},
  signal?: AbortSignal,
): Promise<RegressionResult> {
  if (report.mode !== "DEMO" || finding.id !== "finding-1")
    throw new Error(
      "The bundled walkthrough covers only the reset-token finding.",
    );
  const fixture = fixtureScenarios[0];
  const events: RegressionResult["events"] = previous
    ? [...previous.events]
    : [];
  const emit = (label: string) => {
    events.push({ label, at: new Date().toISOString() });
    progress(label);
  };
  const run = async (
    which: "base" | "head" | "repaired",
    revision: string,
  ): Promise<RevisionResult> => {
    emit(`Execute bundled ${which} fixture twice`);
    return {
      revision,
      environmentHash: sha256(
        JSON.stringify(["trusted-node-fixture", process.version]),
      ),
      runs: [
        await executeTrustedFixture("token-reuse", which, signal),
        await executeTrustedFixture("token-reuse", which, signal),
      ],
      checks: [],
    };
  };
  if (action === "repair") {
    if (
      !previous ||
      previous.mode !== "DEMO" ||
      previous.reportId !== report.id ||
      previous.findingId !== finding.id ||
      previous.verdict !== "REGRESSION_REPRODUCED"
    )
      throw new Error(
        "Run the bundled comparison before its repair walkthrough.",
      );
    const patched = await run("repaired", report.pr.headSha);
    emit(
      "Curated fixture repair passed; no model inference or GitHub changes were made",
    );
    return {
      ...previous,
      events,
      repair: {
        status: patched.runs.every((r) => r.status === "PASS")
          ? "VALIDATED_FOR_TEST"
          : "INCONCLUSIVE",
        provider: "Curated demo repair · no inference",
        proposal: {
          explanation:
            "Consume the reset token after a successful password update. This is a bundled illustrative repair, not an AI-generated live patch.",
          files: [
            {
              path: "src/auth/reset.js",
              originalHash: sha256(fixture.head),
              before: fixture.head,
              after: fixture.repaired,
            },
          ],
        },
        result: patched,
      },
    };
  }
  const base = await run("base", report.pr.baseSha),
    head = await run("head", report.pr.headSha);
  const code = `import assert from "node:assert/strict";\n// Run this same assertion with each bundled fixture source.\n${fixture.test}`;
  return {
    version: 1,
    id: randomUUID(),
    reportId: report.id,
    findingId: finding.id,
    mode: "DEMO",
    provider: "Trusted bundled Node fixture · no inference",
    createdAt: new Date().toISOString(),
    baseSha: report.pr.baseSha,
    headSha: report.pr.headSha,
    test: {
      filename: "fixture-regression.test.mjs",
      code,
      framework: "node:test",
      sha256: sha256(code),
    },
    base,
    head,
    verdict: compareRevisions(base, head),
    events,
    fixtureSources: {
      base: fixture.base,
      head: fixture.head,
      repaired: fixture.repaired,
    },
    limitations: [
      "This walkthrough executes trusted, synthetic fixture variants. It does not fetch or verify a GitHub repository.",
      "Base and head identifiers refer to the synthetic report, not actual Git commits. The fixture runner uses Node assertions, not Vitest.",
      "The repair is curated bundled content. No Nebius inference, sandbox account, or complete application build is exercised.",
      "Passing assertions establish only the behavior tested; review is still required.",
    ],
  };
}
