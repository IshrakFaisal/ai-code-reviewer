import type {
  RegressionRun,
  RegressionVerdict,
  RevisionResult,
  RegressionResult,
} from "./types";
export function stableRevision(result: RevisionResult) {
  if (
    result.error ||
    !result.environmentHash ||
    result.runs.length !== 2 ||
    result.runs.some((r) => r.status === "INCONCLUSIVE" || !r.assertions.length)
  )
    return false;
  const signature = (r: RegressionRun) =>
    JSON.stringify(
      r.assertions
        .map((a) => [a.name, a.status])
        .sort((a, b) => a[0].localeCompare(b[0])),
    );
  return signature(result.runs[0]) === signature(result.runs[1]);
}
export const assertionNames = (result: RevisionResult) =>
  JSON.stringify((result.runs[0]?.assertions || []).map((a) => a.name).sort());
export function compareRevisions(
  base: RevisionResult,
  head: RevisionResult,
): RegressionVerdict {
  if (
    base.revision === head.revision ||
    !stableRevision(base) ||
    !stableRevision(head) ||
    base.environmentHash !== head.environmentHash
  )
    return "INCONCLUSIVE";
  const left = base.runs[0],
    right = head.runs[0];
  if (assertionNames(base) !== assertionNames(head)) return "INCONCLUSIVE";
  if (left.status === "PASS" && right.status === "FAIL")
    return "REGRESSION_REPRODUCED";
  if (left.status === "PASS" && right.status === "PASS")
    return "NO_REGRESSION_OBSERVED";
  if (left.status === "FAIL" && right.status === "PASS")
    return "IMPROVEMENT_OBSERVED";
  const failed = (r: RegressionRun) =>
    JSON.stringify(
      r.assertions
        .filter((a) => a.status === "FAIL")
        .map((a) => a.name)
        .sort(),
    );
  return failed(left) === failed(right)
    ? "PRE_EXISTING_FAILURE"
    : "INCONCLUSIVE";
}
export type AssertionOutcome =
  "PASS" | "FAIL" | "UNSTABLE" | "INCONCLUSIVE" | "NOT_RECORDED";
function outcome(
  result: RevisionResult | undefined,
  name: string,
): AssertionOutcome {
  if (
    !result ||
    !result.runs.some((r) => r.assertions.some((a) => a.name === name))
  )
    return "NOT_RECORDED";
  if (
    result.error ||
    result.runs.length !== 2 ||
    result.runs.some((r) => r.status === "INCONCLUSIVE")
  )
    return "INCONCLUSIVE";
  const assertions = result.runs.map((r) =>
    r.assertions.find((a) => a.name === name),
  );
  if (assertions.some((a) => !a)) return "INCONCLUSIVE";
  return assertions[0]!.status === assertions[1]!.status
    ? assertions[0]!.status
    : "UNSTABLE";
}
export function assertionRows(result: RegressionResult) {
  const names = new Set(
    [result.base, result.head, result.repair?.result].flatMap(
      (r) => r?.runs.flatMap((run) => run.assertions.map((a) => a.name)) || [],
    ),
  );
  return [...names]
    .sort()
    .map((name) => ({
      name,
      base: outcome(result.base, name),
      head: outcome(result.head, name),
      repair: outcome(result.repair?.result, name),
    }));
}
export function comparisonExplanation(result: RegressionResult) {
  switch (result.verdict) {
    case "REGRESSION_REPRODUCED":
      return {
        reason:
          "The same named assertions passed at base and failed at head in both repeats.",
        next: "Review the expected behavior and failing assertion, then recheck a proposed repair.",
      };
    case "NO_REGRESSION_OBSERVED":
      return {
        reason:
          "The recorded assertions passed at both revisions in both repeats.",
        next: "This result supports these assertions only. Review remaining findings and verification gaps.",
      };
    case "PRE_EXISTING_FAILURE":
      return {
        reason: "The same named assertions failed at both revisions.",
        next: "Investigate the existing failure or the test assumptions before attributing it to this PR.",
      };
    case "IMPROVEMENT_OBSERVED":
      return {
        reason:
          "The recorded assertions failed at base and passed at head in both repeats.",
        next: "Inspect the behavior and scope before concluding that the original issue was fixed.",
      };
  }
  const failedSetup = [result.base, result.head].find(
    (revision) => revision.error,
  );
  if (failedSetup)
    return {
      reason: failedSetup.error!,
      next: "Resolve the execution issue shown below, then run a new comparison.",
    };
  if (!result.base.environmentHash || !result.head.environmentHash)
    return {
      reason: "An execution environment could not be identified.",
      next: "Check sandbox availability and dependency installation before retrying.",
    };
  if (result.base.environmentHash !== result.head.environmentHash)
    return {
      reason:
        "The dependency, runtime, or image fingerprints differ between revisions.",
      next: "Use matching execution environments. A dependency-changing PR cannot be classified by this paired workflow.",
    };
  if (!stableRevision(result.base) || !stableRevision(result.head))
    return {
      reason: "The repeats were incomplete, invalid, or did not agree.",
      next: "Inspect assertion output and test setup. Stable completed repeats are required.",
    };
  if (assertionNames(result.base) !== assertionNames(result.head))
    return {
      reason: "The revisions did not execute the same named assertions.",
      next: "Review conditional test definitions and runner setup before comparing results.",
    };
  return {
    reason: "Different assertions failed at the two revisions.",
    next: "Inspect the assertion-by-assertion comparison and outputs; this is not a confirmed regression.",
  };
}
