import { z } from "zod";

export const reviewStatuses = [
  "OPEN",
  "NEEDS_FIX",
  "REVIEWED",
  "DISMISSED",
] as const;
export const reviewStatusSchema = z.enum(reviewStatuses);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

export const reviewReportIdSchema = z
  .string()
  .regex(
    /^(?:demo|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/,
  );
const findingIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/);
const timestampSchema = z.string().datetime().nullable();
export const reviewDecisionSchema = z
  .object({
    status: reviewStatusSchema,
    note: z.string().max(2000),
    updatedAt: timestampSchema,
  })
  .strict();
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

export const reviewStateSchema = z
  .object({
    reportId: reviewReportIdSchema,
    headSha: z.string().regex(/^[a-f0-9]{40}$/),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    updatedAt: timestampSchema,
    findings: z.record(findingIdSchema, reviewDecisionSchema),
  })
  .strict();
export type ReviewState = z.infer<typeof reviewStateSchema>;

export const reviewUpdateSchema = z
  .object({
    findingId: findingIdSchema,
    status: reviewStatusSchema,
    note: z.string().max(2000),
    revision: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER - 1),
  })
  .strict();
export type ReviewUpdate = z.infer<typeof reviewUpdateSchema>;

export type ReviewSubject = {
  id: string;
  headSha: string;
  findingIds: string[];
};

export function emptyReviewState(subject: ReviewSubject): ReviewState {
  return {
    reportId: subject.id,
    headSha: subject.headSha,
    revision: 0,
    updatedAt: null,
    findings: Object.fromEntries(
      subject.findingIds.map((id) => [
        id,
        { status: "OPEN", note: "", updatedAt: null },
      ]),
    ),
  };
}
