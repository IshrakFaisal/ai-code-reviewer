export const reportSections = [
  ["summary", "Summary", "The outcome, key risks, and where to go next."],
  [
    "findings",
    "Findings",
    "Investigated risks, evidence, and reviewer decisions.",
  ],
  [
    "verification",
    "Verification",
    "Recorded checks and their execution output.",
  ],
  ["workbench", "Workbench", "Inspect changed code alongside its evidence."],
  ["review", "Your review", "Saved decisions and review exports."],
  [
    "next-steps",
    "Next steps",
    "Prioritized actions based on the current evidence.",
  ],
  ["gaps", "Evidence gaps", "Missing execution evidence and analysis limits."],
  [
    "changes",
    "Change impact",
    "Behavioral changes, risk map, and changed files.",
  ],
  ["activity", "Activity", "Actions recorded during the investigation."],
] as const;

export type ReportSection = (typeof reportSections)[number][0];

export function isReportSection(value: string): value is ReportSection {
  return reportSections.some(([section]) => section === value);
}

export function reportSectionHref(id: string, section: ReportSection) {
  const base = `/report/${encodeURIComponent(id)}`;
  return section === "summary" ? base : `${base}/${section}`;
}

/** Keep old evidence fragments usable while giving each detail a real route. */
export function reportTargetHref(id: string, href: string) {
  if (!href.startsWith("#")) return href;
  const target = href.slice(1);
  let section: ReportSection = "findings";
  if (target === "summary" || target === "revision-status") section = "summary";
  else if (target === "workbench") section = "workbench";
  else if (target === "human-review") section = "review";
  else if (target === "review-plan") section = "next-steps";
  else if (target === "verification" || target.startsWith("report-check-"))
    section = "verification";
  else if (target === "evidence-gaps" || target === "report-limitations")
    section = "gaps";
  else if (
    target === "files" ||
    target.startsWith("changed-file-") ||
    target === "changes"
  )
    section = "changes";
  else if (target === "agent-log") section = "activity";
  return `${reportSectionHref(id, section)}${href}`;
}

export function reportSectionLocation(pathname: string) {
  const match = /^\/report\/([^/]+)(?:\/([^/]+))?\/?$/.exec(pathname);
  if (!match || (match[2] && !isReportSection(match[2]))) return null;
  return { id: match[1], section: (match[2] || "summary") as ReportSection };
}
