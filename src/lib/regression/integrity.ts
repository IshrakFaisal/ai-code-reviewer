import { compareRevisions, sha256, stableRevision } from "./evidence";
import { validateRepairPath } from "./repair";
import { assertionNames } from "./comparison";
import { regressionResultSchema } from "./schema";
import type { RegressionResult } from "./types";

/** Storage and transport values must agree with the recorded test and assertions. */
export function validateRegression(value: unknown): RegressionResult | null {
  const parsed = regressionResultSchema.safeParse(value);
  if (!parsed.success) return null;
  const result = parsed.data;
  if (
    sha256(result.test.code) !== result.test.sha256 ||
    result.base.revision !== result.baseSha ||
    result.head.revision !== result.headSha ||
    result.baseSha === result.headSha
  )
    return null;
  if (
    result.verdict !== "INCONCLUSIVE" &&
    compareRevisions(result.base, result.head) !== result.verdict
  )
    return null;
  if (
    result.mode === "LIVE" &&
    (result.fixtureSources || result.test.framework !== "vitest")
  )
    return null;
  const repair = result.repair;
  if (repair?.result && repair.result.revision !== result.headSha) return null;
  if (repair?.proposal) {
    const names = new Set<string>();
    for (const file of repair.proposal.files) {
      try {
        validateRepairPath(file.path);
      } catch {
        return null;
      }
      if (
        names.has(file.path) ||
        sha256(file.before) !== file.originalHash ||
        file.before === file.after
      )
        return null;
      names.add(file.path);
    }
  }
  if (repair?.status === "VALIDATED_FOR_TEST") {
    const after = repair.result;
    if (
      result.verdict !== "REGRESSION_REPRODUCED" ||
      repair.error ||
      !repair.proposal ||
      !after ||
      !stableRevision(after) ||
      after.runs.some((run) => run.status !== "PASS") ||
      after.environmentHash !== result.head.environmentHash
    )
      return null;
    if (assertionNames(after) !== assertionNames(result.head)) return null;
    if (result.mode === "LIVE") {
      const checks = after.checks.filter((check) =>
        check.name.startsWith("After repair · "),
      );
      if (
        checks.length !== 3 ||
        !["Build", "TypeScript", "Existing tests"].every((name) =>
          checks.some(
            (check) =>
              check.name === `After repair · ${name}` &&
              check.status === "PASS",
          ),
        )
      )
        return null;
    }
  }
  return result;
}
