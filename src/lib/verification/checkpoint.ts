import { z } from "zod";
import { analysisReportSchema } from "@/lib/reports/schema";
const evidence = analysisReportSchema.shape.checks.element;
export const verificationCheckpointSchema = z.object({
  headSha: z.string().regex(/^[a-f0-9]{40}$/),
  baseSha: z.string().regex(/^[a-f0-9]{40}$/),
  preparation: z.array(evidence).max(3),
  commands: z.object({
    build: evidence.optional(),
    typecheck: evidence.optional(),
    tests: evidence.optional(),
  }),
  findings: z.record(
    z.string().regex(/^finding-\d+$/),
    z.object({ testHash: z.string(), evidence }),
  ),
});
export type VerificationCheckpoint = z.infer<
  typeof verificationCheckpointSchema
>;
