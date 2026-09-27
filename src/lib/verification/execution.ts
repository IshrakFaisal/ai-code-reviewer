import type { Evidence, FindingStatus } from "@/lib/types";
import type { CommandResult } from "@/lib/sandbox/provider";
export function notRun(type: string, description: string): Evidence {
  return {
    id: type.toLowerCase().replaceAll(" ", "-"),
    type,
    status: "NOT_RUN",
    description,
    provenance: "EXECUTED",
  };
}
export function executionEvidence(
  type: string,
  result: CommandResult,
): Evidence {
  return {
    id: type.toLowerCase().replaceAll(" ", "-"),
    type,
    status: result.exitCode === 0 && !result.timedOut ? "PASS" : "FAIL",
    description: result.timedOut
      ? "Command exceeded the execution time limit."
      : `Command exited with code ${result.exitCode}.`,
    output: result.output,
    durationMs: result.durationMs,
    provenance: "EXECUTED",
  };
}
export function findingStatus(
  evidence: Evidence[],
  trustedFixture = false,
): FindingStatus {
  const executed = evidence.filter(
    (e) => e.type === "Generated test" && e.status !== "NOT_RUN",
  );
  if (!executed.length) return "UNVERIFIED_RISK";
  // A model-written assertion can itself be wrong. Only the controlled fixture is
  // automatically promoted; live failures always require human validation.
  if (executed.some((e) => e.status === "FAIL"))
    return trustedFixture &&
      executed.every((e) => e.provenance === "DEMO_FIXTURE")
      ? "VERIFIED_ISSUE"
      : "INCONCLUSIVE";
  if (executed.every((e) => e.status === "PASS")) return "VERIFIED_FOR_TEST";
  return "INCONCLUSIVE";
}

/** Require completed test cases; a green process exit alone is not verification. */
export function generatedEvidence(result: CommandResult): Evidence {
  const evidence = executionEvidence("Generated test", result);
  try {
    const parsed = JSON.parse(result.output);
    const passed = parsed.numPassedTests,
      failed = parsed.numFailedTests;
    if (
      !Number.isInteger(passed) ||
      !Number.isInteger(failed) ||
      passed < 0 ||
      failed < 0 ||
      passed + failed < 1 ||
      !Number.isInteger(parsed.numTotalTests) ||
      parsed.numTotalTests !== passed + failed ||
      (parsed.numPendingTests !== undefined && parsed.numPendingTests !== 0) ||
      (parsed.numTodoTests !== undefined && parsed.numTodoTests !== 0) ||
      parsed.numRuntimeErrorTestSuites > 0 ||
      (Array.isArray(parsed.testResults) &&
        parsed.testResults.some(
          (suite: { status?: string; assertionResults?: unknown[] }) =>
            suite.status === "failed" && !suite.assertionResults?.length,
        )) ||
      result.timedOut ||
      (result.exitCode === 0 && failed > 0) ||
      (result.exitCode === 0 && parsed.success === false) ||
      (result.exitCode !== 0 && failed === 0)
    ) {
      evidence.status = "WARNING";
      evidence.description =
        "No trustworthy completed assertion results; skipped tests, runtime errors, or inconsistent runner output make verification inconclusive.";
    } else {
      evidence.description = `${passed} test cases passed; ${failed} failed at the analyzed PR revision. AI-generated test validity still needs human inspection; the base revision was not compared.`;
    }
  } catch {
    evidence.status = "WARNING";
    evidence.description =
      "Runner output was not valid Vitest JSON; execution is inconclusive (possible syntax, configuration, or runtime error).";
  }
  return evidence;
}
