import { riskLevel } from "@/lib/risk/engine";
import type { AnalysisReport, Evidence } from "@/lib/types";
import type { ReviewState } from "./review";
import { compareFindingPriority } from "./finding-priority";
import {
  evidenceIdentity,
  reportEvidence,
  verificationGaps,
} from "./verification-gaps";

const labelDefinitions = {
  Executed: "a check or test ran for this finding",
  "Static analysis": "rules applied to the diff",
  "AI inference": "an unverified model judgment",
  Heuristic: "deterministic risk signals selected this file for review",
  "Demo hypothesis": "an illustrative finding written for the bundled demo",
};

function skippedCheckName(type: string) {
  const name = type.slice(0, 61).toLowerCase();
  if (name === "typescript") return "typecheck";
  if (name === "generated test") return "generated tests";
  return field(name, 60);
}

// Cap the encoded field, keeping each Markdown escape and HTML entity intact.
function field(value: string, limit: number, code = false) {
  const plain = value
    .slice(0, limit + 1)
    .replace(/[\p{Cc}\p{Cf}\s]+/gu, " ")
    .trim()
    .replace(/@/g, "＠")
    .replace(/`/g, "ˋ")
    .replace(/([a-z][a-z\d+.-]*):(?=\/\/)|\b(mailto):/gi, "$1$2：")
    .replace(/\bwww\./gi, "www．")
    .replace(/#(?=\d)/g, "＃")
    .replace(/\bGH-(?=\d)/gi, "GH‑")
    // GitHub also turns bare commit hashes into links outside code spans.
    .replace(/\b[\da-f]{7,40}\b/gi, (hash) =>
      code ? hash : hash.match(/.{1,6}/g)!.join("·"),
    );
  let result = "";
  for (const char of plain) {
    const escaped =
      char === "&"
        ? "&amp;"
        : char === "<"
          ? "&lt;"
          : char === ">"
            ? "&gt;"
            : !code &&
                (/[\\*_{}[\]()!|~$^#]/.test(char) ||
                  (!result && /[-+=:]/.test(char)) ||
                  (char === "." && /^\d+$/.test(result)))
              ? "\\" + char
              : char;
    if (result.length + escaped.length > limit - 1) return result + "…";
    result += escaped;
  }
  return result;
}

export function reportPriorityScore(report: AnalysisReport) {
  return Math.max(
    0,
    ...report.pr.files.map((f) => f.risk.score),
    ...report.findings.map((f) => f.riskScore),
  );
}

export function buildPrComment(
  report: AnalysisReport,
  reviews: ReviewState | null | undefined,
  options: { maxFindings?: number } = {},
): string {
  const demo = report.mode === "DEMO";
  const mode = demo
    ? "Demo"
    : report.provider === "Deterministic analysis"
      ? "Live heuristics"
      : "Live AI";
  const isRun = (e: Evidence) =>
    e.status !== "NOT_RUN" &&
    (e.provenance === "EXECUTED" || (demo && e.provenance === "DEMO_FIXTURE"));
  // A generated check belongs to its finding. Two findings can have identical
  // results, while the demo also mirrors its results in the global checks.
  const attached = report.findings.flatMap((f) =>
    f.evidence.filter((e) => e.type === "Generated test"),
  );
  const mirrored = new Map<string, number>();
  for (const e of attached) {
    const id = evidenceIdentity(e);
    mirrored.set(id, (mirrored.get(id) ?? 0) + 1);
  }
  const evidence = [
    ...reportEvidence(report).filter((e) => e.type !== "Generated test"),
    ...attached,
    ...report.checks.filter((e) => {
      if (e.type !== "Generated test") return false;
      const id = evidenceIdentity(e);
      const copies = mirrored.get(id) ?? 0;
      if (!copies) return true;
      mirrored.set(id, copies - 1);
      return false;
    }),
  ];
  const executed = evidence.filter(isRun);
  const generated = executed.filter((e) => e.type === "Generated test");
  const skipped = evidence.filter(
    (e) => e.status === "NOT_RUN" && e.provenance !== "STATIC",
  );
  const findings = [...report.findings].sort(compareFindingPriority);
  const top = findings.slice(
    0,
    Math.max(1, Math.min(5, options.maxFindings || 5)),
  );
  const score = reportPriorityScore(report);
  const sha = field(report.pr.headSha, 65, true);
  const sections = [
    `### AI Change Verifier — PR #${report.pr.number} @ \`${sha.slice(0, 7)}\``,
    `**Review priority: ${riskLevel(score)}** (score ${score}; priority, not defect probability) · ${mode} · Execution: ${executed.length ? executed.length + (demo && generated.length === executed.length ? " fixture assertions" : " checks") : "Not run"}` +
      (demo ? " (bundled fixture only)" : ""),
  ];
  const changes = report.behaviors
    .slice(0, 3)
    .map((b) => "- " + field(b.description || b.title, 200));
  if (changes.length)
    sections.push(["**What changed**", ...changes].join("\n"));
  if (top.length) {
    const labels = new Set<keyof typeof labelDefinitions>();
    const rows = top.map((f, i) => {
      const label = f.evidence.some(isRun)
        ? "Executed"
        : f.evidence.some(
              (e) => e.provenance === "STATIC" && e.status !== "NOT_RUN",
            )
          ? "Static analysis"
          : demo
            ? "Demo hypothesis"
            : mode === "Live heuristics"
              ? "Heuristic"
              : "AI inference";
      labels.add(label);
      const ref =
        f.locations?.find((ref) => ref.anchor.status === f.anchor?.status) ??
        f.affectedFiles[0];
      const where = ref
        ? ` (\`${field(ref.path, 125, true)}${ref.startLine ? ":" + ref.startLine : ""}\`)`
        : "";
      const marker =
        f.anchor?.status === "unanchored"
          ? " — location not found in this PR"
          : "";
      return `${i + 1}. **${f.severity} · ${label}**: ${field(f.title, 115)}${where}${marker}. ${field(f.potentialImpact, 200)}`;
    });
    if (top.length < findings.length)
      rows.push(
        "",
        `…and ${findings.length - top.length} more in the full report`,
      );
    rows.push(
      "",
      [...labels]
        .map((label) => `${label} = ${labelDefinitions[label]}`)
        .join(" · ") + ".",
    );
    sections.push(
      [`**Top findings** (${top.length} of ${findings.length})`, ...rows].join(
        "\n",
      ),
    );
  }
  if (executed.length || skipped.length) {
    const rows: string[] = [];
    function summarize(unit: string, items: Evidence[]) {
      if (!items.length) return;
      const count = (status: Evidence["status"]) =>
        items.filter((e) => e.status === status).length;
      rows.push(
        `- ${unit}: ${count("PASS")}/${items.length} passed, ${count("FAIL")} failed${count("WARNING") ? ", " + count("WARNING") + " warnings" : ""}.`,
      );
    }
    summarize(
      "Repository checks",
      executed.filter((e) => e.type !== "Generated test"),
    );
    summarize(
      demo ? "Bundled fixture assertions" : "Generated test runs",
      generated,
    );
    if (generated.some((e) => e.status === "FAIL"))
      rows.push(
        demo
          ? "- A failing assertion is a lead to inspect, not proof of a defect."
          : "- A failing generated test is a lead to inspect, not proof of a defect.",
      );
    if (skipped.length) {
      const names = skipped.slice(0, 4).map((e) => skippedCheckName(e.type));
      if (skipped.length > 4) names.push("+" + (skipped.length - 4) + " more");
      rows.push("- Checks not run: " + names.join(", ") + ".");
    }
    sections.push(["**Verification**", ...rows].join("\n"));
  }
  const gaps = verificationGaps(report);
  const warnings = [...report.pr.warnings, ...report.warnings];
  const coverageWarning = warnings.find((warning) =>
    /line coverage is partial\b|\(500-file cap\)/i.test(warning),
  );
  const unanchored = findings.filter(
    (f) => f.anchor?.status === "unanchored",
  ).length;
  const limitations = [
    ...new Set([
      ...(unanchored
        ? [
            `${unanchored} AI ${unanchored === 1 ? "finding cites" : "findings cite"} locations that do not exist in this PR.`,
          ]
        : []),
      ...(gaps.highRiskGaps
        ? [
            `${gaps.highRiskGaps} high-priority files lack linked repository execution.`,
          ]
        : []),
      ...(report.reviewSurface.partial
        ? [coverageWarning ?? "The analyzed diff is partial."]
        : []),
      ...warnings,
    ]),
  ]
    .filter(Boolean)
    .slice(0, 3);
  if (limitations.length)
    sections.push(
      [
        "**Evidence gaps**",
        ...limitations.map((s) => "- " + field(s, 180)),
      ].join("\n"),
    );
  if (
    findings.length &&
    reviews?.reportId === report.id &&
    reviews.headSha === report.pr.headSha
  ) {
    const counts = { NEEDS_FIX: 0, REVIEWED: 0, DISMISSED: 0, OPEN: 0 };
    for (const f of findings)
      counts[
        Object.hasOwn(reviews.findings, f.id)
          ? reviews.findings[f.id].status
          : "OPEN"
      ]++;
    if (counts.OPEN !== findings.length)
      sections.push(
        `**Reviewer status**: ${counts.NEEDS_FIX} needs fix · ${counts.REVIEWED} reviewed · ${counts.DISMISSED} dismissed · ${counts.OPEN} open`,
      );
  }
  sections.push(
    `<sub>Analysis of head \`${sha.slice(0, 7)}\`, generated ${field(report.createdAt.slice(0, 10), 11)}. Re-run if the PR has new commits. Nothing here was posted automatically.</sub>`,
  );
  return sections.join("\n\n");
}
