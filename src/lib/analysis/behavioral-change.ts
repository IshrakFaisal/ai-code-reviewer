import type { PullRequest, Hypothesis, Behavior } from "@/lib/types";
export function heuristicBehaviors(pr: PullRequest): Behavior[] {
  return pr.files
    .filter((f) => f.risk.score >= 20)
    .slice(0, 8)
    .map((f) => ({
      title: `${f.categories[0].toLowerCase()} area changed`,
      description: `${f.path} changed. Behavior has not been inferred by a model; inspect the diff to determine the effect.`,
      files: [f.path],
      source: "HEURISTIC",
    }));
}
export function heuristicHypotheses(
  pr: PullRequest,
  limit: number,
): Hypothesis[] {
  return [...pr.files]
    .filter((f) => f.risk.score >= 25)
    .sort((a, b) => b.risk.score - a.risk.score)
    .slice(0, limit)
    .map((f) => ({
      title: `Review ${f.categories[0].toLowerCase()} behavior`,
      category: f.categories[0],
      description:
        "Deterministic risk signals selected this file for human inspection. No specific defect has been established.",
      behavioralChange: `Possible behavior changes in ${f.path}; model analysis is unavailable.`,
      potentialImpact:
        "Dependent callers or existing invariants may be affected. Scope requires human review.",
      affectedFiles: [{ path: f.path }],
      recommendation:
        "Compare changed branches with existing invariants and add a regression test for the intended behavior.",
    }));
}
