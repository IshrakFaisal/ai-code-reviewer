import type { ChangedFile, Evidence, RiskLevel, Finding } from "@/lib/types";
import { DEFAULT_WEIGHTS, type RiskWeights } from "./signals";
export const riskLevel = (score: number): RiskLevel =>
  score >= 50 ? "HIGH" : score >= 25 ? "MEDIUM" : "LOW";
export function assessRisk(
  file: Pick<
    ChangedFile,
    "path" | "categories" | "lines" | "additions" | "deletions" | "status"
  >,
  evidence: Evidence[] = [],
  weights: RiskWeights = DEFAULT_WEIGHTS,
) {
  let score = 0;
  const reasons: string[] = [];
  const add = (key: keyof RiskWeights, reason: string) => {
    score += weights[key];
    reasons.push(reason);
  };
  const has = (c: ChangedFile["categories"][number]) =>
    file.categories.includes(c);
  if (has("AUTHENTICATION"))
    add("authentication", "Authentication logic changed");
  if (has("AUTHORIZATION")) add("authorization", "Authorization logic changed");
  if (has("DATABASE"))
    add("migration", "Database schema or persistence changed");
  if (has("DEPENDENCIES")) add("dependency", "Dependency manifest changed");
  if (has("SECURITY")) add("security", "Security-sensitive file changed");
  if (has("ENVIRONMENT"))
    add("environment", "Environment configuration changed");
  if (has("EMAIL"))
    add("emailIntegration", "External email delivery behavior changed");
  if (
    has("TESTS") &&
    (file.status === "removed" ||
      file.lines.some(
        (l) =>
          l.kind === "remove" && /\b(it|test|describe)\s*\(/.test(l.content),
      ))
  )
    add("testsRemoved", "Test definitions removed; inspect coverage");
  if (has("API")) add("publicApi", "Potential public API behavior change");
  if (has("CONFIGURATION") || has("INFRASTRUCTURE"))
    add("criticalConfig", "Runtime or infrastructure configuration changed");
  if (file.additions + file.deletions > 300)
    add("largeDiff", "Large diff exceeds 300 changed lines");
  if (
    !has("TESTS") &&
    file.lines.some(
      (l) =>
        l.kind === "remove" &&
        /\b(validate|verify|assert|authorize|sanitize|isValid|safeParse)\w*\s*\(/i.test(
          l.content,
        ),
    )
  )
    add(
      "deletedValidation",
      "Validation or permission check removed (heuristic)",
    );
  for (const [type, key, reason] of [
    ["Build", "buildFailed", "Build failed"],
    ["Existing tests", "existingTestsFailed", "Existing tests failed"],
    [
      "Generated test",
      "generatedTestFailed",
      "Generated assertion failed; inspect test validity",
    ],
  ] as const) {
    if (
      evidence.some(
        (e) =>
          e.type === type &&
          e.status === "FAIL" &&
          e.provenance !== "STATIC" &&
          (!e.filePaths || e.filePaths.includes(file.path)),
      )
    )
      add(key, reason);
  }
  return { score, level: riskLevel(score), reasons };
}
export function reviewSurface(
  files: ChangedFile[],
  findings: Finding[],
  totalLines: number,
) {
  const keys = new Set<string>();
  for (const file of files) {
    const refs = findings
      .filter((f) => f.severity === "HIGH")
      .flatMap((f) => f.affectedFiles)
      .filter((r) => r.path === file.path);
    const all = file.risk.level === "HIGH";
    for (const line of file.lines) {
      if (
        all ||
        refs.some(
          (r) =>
            (!r.side || r.side === line.side) &&
            (!r.startLine || line.line >= r.startLine) &&
            (!r.endLine || line.line <= r.endLine),
        )
      )
        keys.add(`${file.path}:${line.side}:${line.line}`);
    }
  }
  return {
    priorityLines: Math.min(keys.size, totalLines),
    totalLines,
    partial: files.some((f) => f.lines.length < f.additions + f.deletions),
  };
}
