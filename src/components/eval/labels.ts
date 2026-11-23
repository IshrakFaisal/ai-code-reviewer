export const verdicts = ["useful", "false_positive", "unclear"] as const;
export const references = ["y", "n"] as const;
export const caught = ["yes", "no", "n/a"] as const;
export const noiseLevels = ["low", "medium", "high"] as const;

export type FindingLabel = {
  finding_key: string;
  pr_url: string;
  evidence_label: string;
  severity: string;
  title: string;
  description: string;
  location: string;
  verdict: "" | (typeof verdicts)[number];
  invented_reference: "" | (typeof references)[number];
  notes: string;
};
export type PrLabel = {
  pr_url: string;
  reverted_by: string;
  caught_known_issue: "" | (typeof caught)[number];
  noise: "" | (typeof noiseLevels)[number];
  notes: string;
};
export type BlindRun = {
  run: string;
  prs: PrLabel[];
  findings: FindingLabel[];
};
type Judgments = Pick<FindingLabel, "verdict" | "invented_reference">;
export function labeled(f: Judgments) {
  return Boolean(f.verdict && f.invented_reference);
}
export function completion(findings: Judgments[]) {
  const count = findings.filter(labeled).length;
  return {
    labeled: count,
    percent: findings.length ? Math.round((100 * count) / findings.length) : 0,
  };
}
