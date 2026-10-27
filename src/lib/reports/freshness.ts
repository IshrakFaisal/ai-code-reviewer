import { z } from "zod";
import { reviewReportIdSchema } from "./review";
import type { AnalysisReport } from "@/lib/types";

const sha = z.string().regex(/^[a-f0-9]{40}$/);
export const revisionCheckSchema = z
  .object({
    reportId: reviewReportIdSchema,
    recordedBase: sha,
    recordedHead: sha,
    currentBase: sha,
    currentHead: sha,
    checkedAt: z.string().datetime(),
    state: z.enum(["OPEN", "CLOSED", "MERGED"]),
    draft: z.boolean(),
  })
  .strict();
export type RevisionCheck = z.infer<typeof revisionCheckSchema>;
export const revisionCheckMaxAge = 5 * 60 * 1000;
export const revisionCheckCooldown = 15 * 1000;

/** Honor both HTTP Retry-After formats, with a bounded fallback for malformed values. */
export function revisionRetryDelay(value: string | null, now = Date.now()) {
  if (!value?.trim()) return revisionCheckCooldown;
  const trimmed = value.trim();
  const delay = /^\d+$/.test(trimmed)
    ? Number(trimmed) * 1000
    : /^[A-Za-z]{3},/.test(trimmed)
      ? Date.parse(trimmed) - now
      : Number.NaN;
  return Number.isFinite(delay) && delay >= 0
    ? Math.min(Math.max(1000, delay), 60 * 60 * 1000)
    : revisionCheckCooldown;
}

export function revisionMatchesReport(
  check: RevisionCheck,
  report: AnalysisReport,
) {
  return (
    check.reportId === report.id &&
    check.recordedBase === report.pr.baseSha &&
    check.recordedHead === report.pr.headSha
  );
}

export function revisionChanges(check: RevisionCheck) {
  return {
    base: check.recordedBase !== check.currentBase,
    head: check.recordedHead !== check.currentHead,
  };
}

export function revisionCheckExpired(check: RevisionCheck, now = Date.now()) {
  const age = now - Date.parse(check.checkedAt);
  return !Number.isFinite(age) || age < -60000 || age >= revisionCheckMaxAge;
}
