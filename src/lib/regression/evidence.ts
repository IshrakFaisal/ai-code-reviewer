import { createHash } from "node:crypto";
import { z } from "zod";
import type { CommandResult } from "@/lib/sandbox/provider";
import type { RegressionRun } from "./types";
export { stableRevision, compareRevisions } from "./comparison";

export const sha256 = (source: string) =>
  createHash("sha256").update(source).digest("hex");
const reportSchema = z.object({
  numTotalTests: z.number().int().positive().max(100),
  numPassedTests: z.number().int().nonnegative(),
  numFailedTests: z.number().int().nonnegative(),
  numPendingTests: z.number().int().nonnegative().optional(),
  numTodoTests: z.number().int().nonnegative().optional(),
  numRuntimeErrorTestSuites: z.number().int().nonnegative().optional(),
  success: z.boolean(),
  testResults: z
    .array(
      z.object({
        name: z.string(),
        assertionResults: z
          .array(
            z.object({
              fullName: z.string().min(1).max(1000),
              status: z.enum(["passed", "failed"]),
              failureMessages: z.array(z.string()).optional(),
            }),
          )
          .min(1)
          .max(100),
      }),
    )
    .length(1),
});

export function parseRegressionRun(
  result: CommandResult,
  filename: string,
): RegressionRun {
  const inconclusive = (why: string): RegressionRun => ({
    status: "INCONCLUSIVE",
    assertions: [],
    durationMs: result.durationMs,
    output: why + "\n" + result.output.slice(0, 18000),
  });
  if (result.timedOut) return inconclusive("Execution exceeded its deadline.");
  try {
    const data = reportSchema.parse(JSON.parse(result.output));
    const suite = data.testResults[0];
    if (
      !suite.name
        .replaceAll("\\", "/")
        .endsWith(`/.change-verifier/${filename}`)
    )
      return inconclusive("Runner report belongs to a different test.");
    const assertions = suite.assertionResults;
    const passed = assertions.filter((a) => a.status === "passed").length;
    const failed = assertions.length - passed;
    if (
      data.numTotalTests !== assertions.length ||
      data.numPassedTests !== passed ||
      data.numFailedTests !== failed ||
      data.numPendingTests ||
      data.numTodoTests ||
      data.numRuntimeErrorTestSuites ||
      new Set(assertions.map((a) => a.fullName)).size !== assertions.length ||
      data.success !== (failed === 0) ||
      (result.exitCode === 0) !== (failed === 0)
    )
      return inconclusive(
        "Runner counts or completed assertions are inconsistent.",
      );
    if (
      assertions.some(
        (a) =>
          a.status === "failed" &&
          !a.failureMessages?.some((m) => /\bAssertionError\b/.test(m)),
      )
    )
      return inconclusive(
        "A test threw an error without a recognized assertion failure.",
      );
    return {
      status: failed ? "FAIL" : "PASS",
      durationMs: result.durationMs,
      output: result.output.slice(0, 18000),
      assertions: assertions.map((a) => ({
        name: a.fullName,
        status: a.status === "passed" ? "PASS" : "FAIL",
        ...(a.failureMessages?.length
          ? { failure: a.failureMessages.join("\n").slice(0, 4000) }
          : {}),
      })),
    };
  } catch {
    return inconclusive("No valid, completed assertion report was available.");
  }
}
