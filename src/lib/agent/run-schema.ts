import { z } from "zod";
import { requestSchema } from "@/lib/github/input";
import { analysisReportSchema } from "@/lib/reports/schema";
import { reportIdPattern } from "@/lib/reports/schema";

export const runIdSchema = z.string().uuid().regex(reportIdPattern);
export const runStatusSchema = z.enum([
  "RUNNING",
  "PAUSED",
  "INTERRUPTED",
  "COMPLETE",
]);
export const runSnapshotSchema = z
  .object({
    id: runIdSchema,
    input: requestSchema,
    status: runStatusSchema,
    attempt: z.number().int().min(1).max(1000),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    events: analysisReportSchema.shape.events,
    error: z.string().max(5000),
    reportId: runIdSchema.optional(),
  })
  .refine((run) => run.status !== "COMPLETE" || run.reportId === run.id);
export type RunSnapshot = z.infer<typeof runSnapshotSchema>;
export const runRecordSchema = runSnapshotSchema.safeExtend({
  version: z.literal(1),
  checkpoint: z.object({
    values: z.record(
      z
        .string()
        .regex(
          /^(?:settings|pullRequest|intent|categories|behaviors|hypotheses|verification|verificationProgress|test:finding-\d+)$/,
        ),
      z.unknown(),
    ),
    events: analysisReportSchema.shape.events,
  }),
});
export type RunRecord = z.infer<typeof runRecordSchema>;
