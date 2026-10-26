import { z } from "zod";
import type { AnalysisReport, Finding } from "@/lib/types";
import type { RegressionResult } from "./types";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.string().regex(/^[a-f0-9]{40}$/);
const identity = z
  .string()
  .regex(
    /^(?:demo|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/,
  );
const findingId = z.string().regex(/^finding-[1-9][0-9]{0,2}$/);
const assertion = z.object({
  name: z.string().min(1).max(1000),
  status: z.enum(["PASS", "FAIL"]),
  failure: z.string().max(4000).optional(),
});
const run = z
  .object({
    status: z.enum(["PASS", "FAIL", "INCONCLUSIVE"]),
    assertions: z.array(assertion).max(100),
    durationMs: z.number().finite().nonnegative(),
    output: z.string().max(20000),
  })
  .refine((value) => {
    if (value.status === "INCONCLUSIVE") return true;
    return (
      value.assertions.length > 0 &&
      new Set(value.assertions.map((a) => a.name)).size ===
        value.assertions.length &&
      (value.status === "FAIL") ===
        value.assertions.some((a) => a.status === "FAIL")
    );
  });
const revisionResult = z.object({
  revision,
  environmentHash: hash.optional(),
  runs: z.array(run).max(2),
  checks: z
    .array(
      z.object({
        name: z.string().min(1).max(150),
        status: z.enum(["PASS", "FAIL", "NOT_RUN"]),
        output: z.string().max(18000),
      }),
    )
    .max(6),
  error: z.string().max(2000).optional(),
});
export const regressionResultSchema: z.ZodType<RegressionResult> = z.object({
  version: z.literal(1),
  id: identity,
  reportId: identity,
  findingId,
  mode: z.enum(["LIVE", "DEMO"]),
  provider: z.string().min(1).max(1000),
  createdAt: z.iso.datetime(),
  baseSha: revision,
  headSha: revision,
  test: z.object({
    filename: z.string().regex(/^[a-zA-Z0-9_-]+\.test\.(?:ts|mjs)$/),
    code: z.string().min(1).max(16000),
    sha256: hash,
    framework: z.enum(["vitest", "node:test"]),
  }),
  base: revisionResult,
  head: revisionResult,
  verdict: z.enum([
    "REGRESSION_REPRODUCED",
    "NO_REGRESSION_OBSERVED",
    "PRE_EXISTING_FAILURE",
    "IMPROVEMENT_OBSERVED",
    "INCONCLUSIVE",
  ]),
  limitations: z.array(z.string().max(3000)).max(30),
  events: z
    .array(
      z.object({ label: z.string().min(1).max(2000), at: z.iso.datetime() }),
    )
    .max(128),
  fixtureSources: z
    .object({
      base: z.string().max(24000),
      head: z.string().max(24000),
      repaired: z.string().max(24000),
    })
    .optional(),
  repair: z
    .object({
      status: z.enum(["VALIDATED_FOR_TEST", "CHECKS_FAILED", "INCONCLUSIVE"]),
      provider: z.string().min(1).max(1000),
      error: z.string().max(2000).optional(),
      result: revisionResult.optional(),
      proposal: z
        .object({
          explanation: z.string().min(1).max(2000),
          files: z
            .array(
              z.object({
                path: z.string().min(1).max(300),
                originalHash: hash,
                before: z.string().max(24000),
                after: z.string().min(1).max(24000),
              }),
            )
            .min(1)
            .max(3),
        })
        .optional(),
    })
    .optional(),
});
export function matchesRegressionScope(
  result: RegressionResult,
  report: AnalysisReport,
  finding: Finding,
) {
  return (
    result.reportId === report.id &&
    result.findingId === finding.id &&
    result.mode === report.mode &&
    result.baseSha === report.pr.baseSha &&
    result.headSha === report.pr.headSha &&
    (report.mode === "DEMO" || result.test.code === finding.generatedTest?.code)
  );
}
export const regressionMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heartbeat") }),
  z.object({
    type: z.literal("progress"),
    label: z.string().min(1).max(2000),
    at: z.iso.datetime(),
  }),
  z.object({ type: z.literal("error"), error: z.string().min(1).max(5000) }),
  z.object({ type: z.literal("complete"), result: regressionResultSchema }),
]);
