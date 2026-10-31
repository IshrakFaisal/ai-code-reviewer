import { z } from "zod";
import type { CategoryRefinement } from "@/lib/analysis/categorizer";
import type { TestContext } from "./test-context";
import {
  categories,
  type PullRequest,
  type Hypothesis,
  type Behavior,
  type GeneratedTest,
  type Evidence,
} from "@/lib/types";
const text = z.string().min(1).max(2400);
export const hypothesisSchema = z.object({
  title: text,
  category: z.enum(categories),
  description: text,
  behavioralChange: text,
  potentialImpact: text,
  affectedFiles: z
    .array(
      z.object({
        path: z.string().min(1).max(500),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
        side: z.enum(["LEFT", "RIGHT"]).optional(),
      }),
    )
    .min(1)
    .max(8),
  recommendation: text,
});
export const behaviorSchema = z.object({
  title: text,
  description: text,
  files: z.array(z.string().max(500)).max(15),
});
export const planSchema = z.object({
  strategy: text,
  filename: z.string().regex(/^[a-zA-Z0-9_-]+\.test\.ts$/),
  code: z.string().min(1).max(16000),
  framework: z.literal("vitest"),
});
export const categoryRefinementSchema = z.object({
  path: z.string().min(1).max(500),
  categories: z.array(z.enum(categories)).min(1).max(categories.length),
});
export interface AIProvider {
  name: string;
  analyzePullRequest(pr: PullRequest): Promise<string>;
  refineFileCategories(pr: PullRequest): Promise<CategoryRefinement[]>;
  identifyBehavioralChanges(pr: PullRequest): Promise<Behavior[]>;
  generateRiskHypotheses(pr: PullRequest, limit: number): Promise<Hypothesis[]>;
  generateVerificationPlan(
    pr: PullRequest,
    hypothesis: Hypothesis,
    context: TestContext,
  ): Promise<GeneratedTest>;
  analyzeExecutionEvidence(
    hypothesis: Hypothesis,
    evidence: Evidence[],
  ): Promise<string>;
  generateFinalReport(
    pr: PullRequest,
    hypotheses: Hypothesis[],
  ): Promise<string>;
}
/** Reject invented file paths and remove ungrounded line numbers before rendering links. */
export function groundHypotheses(
  hypotheses: Hypothesis[],
  pr: PullRequest,
): Hypothesis[] {
  return hypotheses
    .map((h) => ({
      ...h,
      affectedFiles: h.affectedFiles
        .filter((r) => pr.files.some((f) => f.path === r.path))
        .map((r) => {
          const file = pr.files.find((f) => f.path === r.path)!;
          const side = r.side || "RIGHT";
          if (
            !r.startLine ||
            !r.endLine ||
            r.endLine < r.startLine ||
            !file.lines.some(
              (l) =>
                l.side === side &&
                l.line >= r.startLine! &&
                l.line <= r.endLine!,
            )
          )
            return { path: r.path };
          const observed = file.lines.filter(
            (l) =>
              l.side === side && l.line >= r.startLine! && l.line <= r.endLine!,
          );
          return {
            ...r,
            side,
            startLine: Math.min(...observed.map((l) => l.line)),
            endLine: Math.max(...observed.map((l) => l.line)),
          };
        }),
    }))
    .filter((h) => h.affectedFiles.length > 0);
}
