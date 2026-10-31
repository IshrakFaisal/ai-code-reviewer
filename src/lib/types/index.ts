export const categories = [
  "AUTHENTICATION",
  "AUTHORIZATION",
  "DATABASE",
  "API",
  "PAYMENTS",
  "DEPENDENCIES",
  "INFRASTRUCTURE",
  "CONFIGURATION",
  "ENVIRONMENT",
  "UI",
  "TESTS",
  "EMAIL",
  "BACKGROUND JOBS",
  "SECURITY",
  "LOGGING",
  "UNKNOWN",
] as const;
export type Category = (typeof categories)[number];
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type EvidenceStatus = "PASS" | "FAIL" | "WARNING" | "NOT_RUN";
export type FindingStatus =
  "VERIFIED_ISSUE" | "VERIFIED_FOR_TEST" | "UNVERIFIED_RISK" | "INCONCLUSIVE";
export type LineRef = {
  path: string;
  startLine?: number;
  endLine?: number;
  side?: "LEFT" | "RIGHT";
};
export type DiffLine = {
  line: number;
  side: "LEFT" | "RIGHT";
  content: string;
  kind: "add" | "remove";
};
export interface ChangedFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  categories: Category[];
  lines: DiffLine[];
  risk: { score: number; level: RiskLevel; reasons: string[] };
}
export interface PullRequest {
  owner: string;
  repo: string;
  number: number;
  title: string;
  description: string;
  url: string;
  author: string;
  base: string;
  head: string;
  headSha: string;
  baseSha: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: ChangedFile[];
  warnings: string[];
}
export interface Evidence {
  id: string;
  type: string;
  status: EvidenceStatus;
  description: string;
  provenance: "STATIC" | "EXECUTED" | "DEMO_FIXTURE";
  output?: string;
  durationMs?: number;
  filePaths?: string[];
}
export interface GeneratedTest {
  filename: string;
  code: string;
  strategy: string;
  framework: "vitest" | "node:test";
  context?: {
    headSha: string;
    files: { path: string; sha: string; role: string; truncated: boolean }[];
    limitations: string[];
  };
}
export interface Hypothesis {
  title: string;
  category: Category;
  description: string;
  behavioralChange: string;
  potentialImpact: string;
  affectedFiles: LineRef[];
  recommendation: string;
}
export interface Finding extends Hypothesis {
  id: string;
  severity: RiskLevel;
  status: FindingStatus;
  riskScore: number;
  evidence: Evidence[];
  generatedTest?: GeneratedTest;
}
export interface Behavior {
  title: string;
  description: string;
  files: string[];
  source: "AI_INFERENCE" | "HEURISTIC" | "DEMO";
}
export interface AgentEvent {
  stage: number;
  status?: "RUNNING" | "COMPLETE";
  label: string;
  detail: string;
  at: string;
  phase?: string;
}
export interface AnalysisReport {
  id: string;
  createdAt: string;
  mode: "DEMO" | "LIVE";
  provider: string;
  pr: PullRequest;
  summary: string;
  findings: Finding[];
  checks: Evidence[];
  behaviors: Behavior[];
  events: AgentEvent[];
  warnings: string[];
  riskMap: {
    category: Category;
    level: RiskLevel;
    score: number;
    fileCount: number;
    reasons?: string[];
    connected: Category[];
  }[];
  reviewSurface: {
    priorityLines: number;
    totalLines: number;
    partial: boolean;
  };
}
export const STAGES = [
  "Fetch repository metadata",
  "Fetch pull request",
  "Read changed files and diff",
  "Understand pull request intent",
  "Categorize changed files",
  "Detect behavioral changes",
  "Map affected systems",
  "Calculate risk signals",
  "Generate risk hypotheses",
  "Plan investigations",
  "Generate targeted tests",
  "Run verification checks",
  "Evaluate execution evidence",
  "Build review report",
];
