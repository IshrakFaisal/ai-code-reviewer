import type { AnalysisReport } from "@/lib/types";

/** Only metadata needed for browsing; patches and test output stay on the server. */
export type ReportSummary = Pick<
  AnalysisReport,
  "id" | "createdAt" | "mode"
> & {
  pr: Pick<
    AnalysisReport["pr"],
    "owner" | "repo" | "number" | "title" | "headSha"
  >;
  highFindings: number;
};

export function summarizeReport(report: AnalysisReport): ReportSummary {
  const { owner, repo, number, title, headSha } = report.pr;
  return {
    id: report.id,
    createdAt: report.createdAt,
    mode: report.mode,
    pr: { owner, repo, number, title, headSha },
    highFindings: report.findings.filter(
      (finding) => finding.severity === "HIGH",
    ).length,
  };
}

export type HistoryFilters = {
  query: string;
  mode: "ALL" | AnalysisReport["mode"];
  priority: "ALL" | "HIGH" | "NO_HIGH";
};
export const defaultHistoryFilters: HistoryFilters = {
  query: "",
  mode: "ALL",
  priority: "ALL",
};
export function historyFiltersFromParams(
  params: Pick<URLSearchParams, "getAll">,
): HistoryFilters {
  const one = (name: string) => {
    const values = params.getAll(name);
    return values.length === 1 ? values[0] : "";
  };
  const mode = one("mode"),
    priority = one("priority");
  return {
    query: one("q").slice(0, 300),
    mode: mode === "LIVE" || mode === "DEMO" ? mode : "ALL",
    priority: priority === "HIGH" || priority === "NO_HIGH" ? priority : "ALL",
  };
}
export function historyFilterHref(filters: HistoryFilters, existing = "") {
  const params = new URLSearchParams(existing);
  for (const key of ["q", "mode", "priority"]) params.delete(key);
  if (filters.query) params.set("q", filters.query.slice(0, 300));
  if (filters.mode !== "ALL") params.set("mode", filters.mode);
  if (filters.priority !== "ALL") params.set("priority", filters.priority);
  const query = params.toString();
  return `/history${query ? `?${query}` : ""}`;
}

export function filterReports(
  reports: ReportSummary[],
  filters: HistoryFilters,
) {
  const terms = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return reports.filter((report) => {
    if (filters.mode !== "ALL" && report.mode !== filters.mode) return false;
    if (filters.priority === "HIGH" && !report.highFindings) return false;
    if (filters.priority === "NO_HIGH" && report.highFindings) return false;
    const searchable =
      `${report.pr.title} ${report.pr.owner}/${report.pr.repo} #${report.pr.number} ${report.pr.headSha}`.toLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}

/** Live reruns return to a prefilled form; visiting this link makes no API call. */
export function reanalysisHref(report: Pick<AnalysisReport, "mode" | "pr">) {
  if (report.mode === "DEMO") return "/analyze?demo=true";
  const input = `https://github.com/${report.pr.owner}/${report.pr.repo}/pull/${report.pr.number}`;
  return `/?input=${encodeURIComponent(input)}#analyze`;
}
