import { z } from "zod";
import { categories, STAGES, type AnalysisReport } from "@/lib/types";

export const reportIdPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const score = z.number().finite().nonnegative();
const text = z.string().max(20000);
const name = z.string().min(1).max(4096);
const identity = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const timestamp = z.iso.datetime({ offset: true });
const category = z.enum(categories);
const level = z.enum(["LOW", "MEDIUM", "HIGH"]);
const strings = z.array(text).max(1000);
const paths = z.array(name).max(500);
const evidence = z.object({
  id: identity,
  type: name,
  status: z.enum(["PASS", "FAIL", "WARNING", "NOT_RUN"]),
  // Static environment checks can enumerate references from every retrieved patch.
  description: z.string().max(12000000),
  provenance: z.enum(["STATIC", "EXECUTED", "DEMO_FIXTURE"]),
  // Sandbox providers read generated runner reports up to 256,000 bytes.
  output: z.string().max(256000).optional(),
  durationMs: score.optional(),
  filePaths: paths.optional(),
});
const lineRef = z
  .object({
    path: name,
    startLine: count.min(1).optional(),
    endLine: count.min(1).optional(),
    side: z.enum(["LEFT", "RIGHT"]).optional(),
  })
  .refine(
    (ref) =>
      ref.startLine === undefined ||
      ref.endLine === undefined ||
      ref.endLine >= ref.startLine,
  );

/** Versionless reports are the original format. New writes use schemaVersion 1. */
export const analysisReportSchema = z
  .object({
    schemaVersion: z.literal(1).optional(),
    id: z.string().regex(reportIdPattern),
    createdAt: timestamp,
    mode: z.enum(["DEMO", "LIVE"]),
    provider: name,
    pr: z
      .object({
        owner: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/),
        repo: z
          .string()
          .regex(/^[A-Za-z0-9_.-]{1,100}$/)
          .refine((value) => value !== "." && value !== ".."),
        number: count.min(1).max(2147483647),
        title: name,
        description: text,
        url: z.string().max(500),
        author: name,
        base: name,
        head: name,
        headSha: z.string().regex(/^[a-f0-9]{40}$/),
        baseSha: z.string().regex(/^[a-f0-9]{40}$/),
        additions: count,
        deletions: count,
        changedFiles: count,
        files: z
          .array(
            z.object({
              path: name,
              status: name,
              additions: count,
              deletions: count,
              patch: text.optional(),
              categories: z.array(category).min(1).max(categories.length),
              lines: z
                .array(
                  z.object({
                    line: count.min(1),
                    side: z.enum(["LEFT", "RIGHT"]),
                    content: text,
                    kind: z.enum(["add", "remove"]),
                  }),
                )
                .max(20000),
              risk: z.object({ score, level, reasons: strings }),
            }),
          )
          .max(500),
        warnings: strings,
      })
      .refine(
        (pr) =>
          pr.url.toLowerCase().replace(/\/$/, "") ===
          `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}`.toLowerCase(),
      ),
    summary: text,
    findings: z
      .array(
        z.object({
          id: identity,
          title: name,
          category,
          description: text,
          behavioralChange: text,
          potentialImpact: text,
          affectedFiles: z.array(lineRef).max(500),
          recommendation: text,
          severity: level,
          status: z.enum([
            "VERIFIED_ISSUE",
            "VERIFIED_FOR_TEST",
            "UNVERIFIED_RISK",
            "INCONCLUSIVE",
          ]),
          riskScore: score,
          evidence: z.array(evidence).max(1000),
          generatedTest: z
            .object({
              filename: z.string().regex(/^[a-zA-Z0-9_-]+\.test\.(?:ts|mjs)$/),
              code: z.string().min(1).max(16000),
              strategy: text,
              framework: z.enum(["vitest", "node:test"]),
              context: z
                .object({
                  headSha: z.string().regex(/^[a-f0-9]{40}$/),
                  files: z
                    .array(
                      z.object({
                        path: name,
                        sha: z.string().regex(/^[a-f0-9]{40}$/),
                        role: z.enum([
                          "source",
                          "test",
                          "configuration",
                          "dependency",
                        ]),
                        truncated: z.boolean(),
                      }),
                    )
                    .max(12),
                  limitations: z.array(text).max(40),
                })
                .optional(),
            })
            .optional(),
        }),
      )
      .max(100),
    checks: z.array(evidence).max(1000),
    behaviors: z
      .array(
        z.object({
          title: name,
          description: text,
          files: paths,
          source: z.enum(["AI_INFERENCE", "HEURISTIC", "DEMO"]),
        }),
      )
      .max(100),
    events: z
      .array(
        z.object({
          stage: count.max(STAGES.length - 1),
          status: z.enum(["RUNNING", "COMPLETE"]).optional(),
          label: name,
          detail: text,
          at: timestamp,
          phase: name.optional(),
        }),
      )
      .max(1000),
    warnings: strings,
    riskMap: z
      .array(
        z.object({
          category,
          level,
          score,
          fileCount: count,
          reasons: strings.optional(),
          connected: z.array(category).max(categories.length),
        }),
      )
      .max(categories.length),
    reviewSurface: z
      .object({
        priorityLines: count,
        totalLines: count,
        partial: z.boolean(),
      })
      .refine((surface) => surface.priorityLines <= surface.totalLines),
  })
  .refine(
    (report) =>
      new Set(report.findings.map((finding) => finding.id)).size ===
        report.findings.length &&
      new Set(report.pr.files.map((file) => file.path)).size ===
        report.pr.files.length,
  );

export function validateReport(
  value: unknown,
  expectedId?: string,
): AnalysisReport | null {
  const parsed = analysisReportSchema.safeParse(value);
  if (
    !parsed.success ||
    (expectedId !== undefined && parsed.data.id !== expectedId)
  )
    return null;
  // Storage format metadata is not part of the immutable analysis payload.
  const { schemaVersion: _version, ...report } = parsed.data;
  void _version;
  return report;
}
