export type RegressionVerdict =
  | "REGRESSION_REPRODUCED"
  | "NO_REGRESSION_OBSERVED"
  | "PRE_EXISTING_FAILURE"
  | "IMPROVEMENT_OBSERVED"
  | "INCONCLUSIVE";
export interface AssertionResult {
  name: string;
  status: "PASS" | "FAIL";
  failure?: string;
}
export interface RegressionRun {
  status: "PASS" | "FAIL" | "INCONCLUSIVE";
  assertions: AssertionResult[];
  durationMs: number;
  output: string;
}
export interface RevisionResult {
  revision: string;
  environmentHash?: string;
  runs: RegressionRun[];
  checks: {
    name: string;
    status: "PASS" | "FAIL" | "NOT_RUN";
    output: string;
  }[];
  error?: string;
}
export interface RepairProposal {
  explanation: string;
  files: {
    path: string;
    originalHash: string;
    before: string;
    after: string;
  }[];
}
export interface RegressionResult {
  version: 1;
  id: string;
  reportId: string;
  findingId: string;
  mode: "LIVE" | "DEMO";
  provider: string;
  createdAt: string;
  baseSha: string;
  headSha: string;
  test: {
    filename: string;
    code: string;
    sha256: string;
    framework: "vitest" | "node:test";
  };
  base: RevisionResult;
  head: RevisionResult;
  verdict: RegressionVerdict;
  limitations: string[];
  events: { label: string; at: string }[];
  fixtureSources?: { base: string; head: string; repaired: string };
  repair?: {
    proposal?: RepairProposal;
    result?: RevisionResult;
    status: "VALIDATED_FOR_TEST" | "CHECKS_FAILED" | "INCONCLUSIVE";
    provider: string;
    error?: string;
  };
}
export const verdictLabels: Record<RegressionVerdict, string> = {
  REGRESSION_REPRODUCED: "Regression reproduced",
  NO_REGRESSION_OBSERVED: "No regression observed for this test",
  PRE_EXISTING_FAILURE: "Failure also present at base",
  IMPROVEMENT_OBSERVED: "Improvement observed for this test",
  INCONCLUSIVE: "Inconclusive",
};
