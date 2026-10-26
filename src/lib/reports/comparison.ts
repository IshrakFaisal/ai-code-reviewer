import type { AnalysisReport, Evidence, Finding } from "@/lib/types";

function sameSubject(a: AnalysisReport, b: AnalysisReport) {
  return (
    a.mode === b.mode &&
    a.pr.number === b.pr.number &&
    a.pr.owner.toLowerCase() === b.pr.owner.toLowerCase() &&
    a.pr.repo.toLowerCase() === b.pr.repo.toLowerCase()
  );
}

export function earlierReports(
  current: AnalysisReport,
  reports: AnalysisReport[],
) {
  const time = Date.parse(current.createdAt);
  return reports
    .filter(
      (report) =>
        report.id !== current.id &&
        sameSubject(current, report) &&
        Date.parse(report.createdAt) < time,
    )
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
    );
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort();
}

// Run-local IDs and line numbers are deliberately excluded: both can move on reruns.
function findingKey(finding: Finding): string | null {
  if (!finding.affectedFiles.length) return null;
  const title = finding.title.trim().toLowerCase().replace(/\s+/g, " ");
  if (!title) return null;
  return JSON.stringify([
    title,
    finding.category,
    uniqueSorted(
      finding.affectedFiles.map((file) =>
        JSON.stringify([file.path, file.side ?? "RIGHT"]),
      ),
    ),
  ]);
}

type Pair<T> = { before?: T; after?: T };
function pairUnique<T>(
  before: T[],
  after: T[],
  key: (value: T) => string | null,
) {
  const group = (values: T[]) => {
    const groups = new Map<string, T[]>();
    for (const value of values) {
      const identity = key(value);
      if (identity !== null)
        groups.set(identity, [...(groups.get(identity) ?? []), value]);
    }
    return groups;
  };
  const previous = group(before),
    current = group(after);
  const pairs: Pair<T>[] = [];
  const matched = new Set<T>();
  for (const value of after) {
    const identity = key(value);
    const candidates = identity === null ? [] : (previous.get(identity) ?? []);
    if (
      identity !== null &&
      candidates.length === 1 &&
      current.get(identity)?.length === 1
    ) {
      pairs.push({ before: candidates[0], after: value });
      matched.add(candidates[0]);
    } else pairs.push({ after: value });
  }
  for (const value of before)
    if (!matched.has(value)) pairs.push({ before: value });
  const ambiguous = [...new Set([...previous.keys(), ...current.keys()])].some(
    (identity) =>
      (previous.get(identity)?.length ?? 0) > 1 ||
      (current.get(identity)?.length ?? 0) > 1,
  );
  return { pairs, ambiguous };
}

function evidenceSignature(evidence: Evidence[]) {
  return JSON.stringify(
    evidence
      .map((item) =>
        JSON.stringify([
          item.type,
          item.status,
          item.provenance,
          uniqueSorted(item.filePaths ?? []),
        ]),
      )
      .sort(),
  );
}

function testSignature(finding: Finding) {
  const test = finding.generatedTest;
  return test
    ? JSON.stringify([test.code, test.framework, test.filename, test.strategy])
    : null;
}

export type FindingChange = Pair<Finding> & {
  kind: "NEW" | "REPEATED" | "NOT_OBSERVED";
  changes: string[];
};
export type CheckChange = Pair<Evidence> & { changed: boolean };

export function compareReports(before: AnalysisReport, after: AnalysisReport) {
  if (!earlierReports(after, [before]).length) {
    throw new Error(
      "Choose an earlier report for the same pull request and analysis mode.",
    );
  }
  const matched = pairUnique(before.findings, after.findings, findingKey);
  const findings: FindingChange[] = matched.pairs.map((pair) => {
    const changes: string[] = [];
    if (pair.before && pair.after) {
      if (
        pair.before.severity !== pair.after.severity ||
        pair.before.riskScore !== pair.after.riskScore
      )
        changes.push("Review priority changed");
      if (pair.before.status !== pair.after.status)
        changes.push("Evidence conclusion changed");
      if (
        evidenceSignature(pair.before.evidence) !==
        evidenceSignature(pair.after.evidence)
      )
        changes.push("Evidence results or provenance changed");
      if (testSignature(pair.before) !== testSignature(pair.after))
        changes.push("Generated test changed");
    }
    return {
      ...pair,
      kind: !pair.before ? "NEW" : !pair.after ? "NOT_OBSERVED" : "REPEATED",
      changes,
    };
  });
  const checkIdentity = (check: Evidence) =>
    JSON.stringify([check.type, uniqueSorted(check.filePaths ?? [])]);
  const repeatedChecks = new Set<string>();
  for (const report of [before, after]) {
    const seen = new Set<string>();
    for (const check of report.checks) {
      const identity = checkIdentity(check);
      if (seen.has(identity)) repeatedChecks.add(identity);
      seen.add(identity);
    }
  }
  const checks = pairUnique(before.checks, after.checks, (check) => {
    const identity = checkIdentity(check);
    return JSON.stringify([
      identity,
      repeatedChecks.has(identity) ? check.description : null,
    ]);
  });
  const checkChanges: CheckChange[] = checks.pairs.map((pair) => ({
    ...pair,
    changed:
      !pair.before ||
      !pair.after ||
      evidenceSignature([pair.before]) !== evidenceSignature([pair.after]),
  }));
  const warnings = [
    "Finding matching requires the same normalized title, category, and file paths/sides. Reworded or moved findings may appear separately. Line-number shifts and run-local IDs are ignored.",
    "A finding not observed in the later run is not proof of a fix. Investigation limits, model output, and available evidence can differ. Reviewer decisions are not carried forward.",
  ];
  if (before.pr.headSha === after.pr.headSha)
    warnings.push(
      "Both runs analyzed the same head commit. There is no new head revision between these observations; check the base commit and run settings as well.",
    );
  if (before.pr.baseSha !== after.pr.baseSha)
    warnings.push(
      "The PR base commit changed between runs, so the compared diff scope also changed.",
    );
  if (before.provider !== after.provider)
    warnings.push(
      "The analysis provider differs between runs; findings may differ because of the provider.",
    );
  if (before.reviewSurface.partial || after.reviewSurface.partial)
    warnings.push(
      "At least one run has partial diff coverage. Priority-line counts are lower bounds.",
    );
  if (matched.ambiguous || checks.ambiguous)
    warnings.push(
      "Duplicate identities are ambiguous and were left unmatched rather than paired by position.",
    );
  return {
    findings,
    checks: checkChanges,
    counts: {
      new: findings.filter((finding) => finding.kind === "NEW").length,
      repeated: findings.filter((finding) => finding.kind === "REPEATED")
        .length,
      notObserved: findings.filter((finding) => finding.kind === "NOT_OBSERVED")
        .length,
    },
    riskChanges: [
      ...new Set(
        [...before.riskMap, ...after.riskMap].map((area) => area.category),
      ),
    ]
      .map((category) => ({
        before: before.riskMap.find((area) => area.category === category),
        after: after.riskMap.find((area) => area.category === category),
      }))
      .filter(
        (pair) =>
          pair.before?.score !== pair.after?.score ||
          pair.before?.fileCount !== pair.after?.fileCount ||
          pair.before?.level !== pair.after?.level,
      ),
    warnings,
  };
}
