import Link from "next/link";
import { ArrowUpRight, GitPullRequest } from "lucide-react";
import type { AnalysisReport } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Readable on mobile without hiding the repository or analysis mode. */
export function ReportList({ reports }: { reports: AnalysisReport[] }) {
  return (
    <div
      className="report-list"
      role="table"
      aria-label="Saved analysis reports"
    >
      <div className="report-list-head" role="row">
        <span role="columnheader">Pull request</span>
        <span role="columnheader">Priority</span>
        <span role="columnheader">Analyzed</span>
        <span className="sr-only" role="columnheader">
          Open report
        </span>
      </div>
      {reports.map((report) => {
        const high = report.findings.filter(
          (finding) => finding.severity === "HIGH",
        ).length;
        return (
          <div key={report.id} className="report-list-row" role="row">
            <div className="report-list-pr" role="cell">
              <GitPullRequest size={17} strokeWidth={1.7} />
              <div>
                <Link
                  href={`/report/${report.id}`}
                  className="report-title-link"
                >
                  <strong>{report.pr.title}</strong>
                </Link>
                <p>
                  <span>
                    {report.pr.owner}/{report.pr.repo}
                  </span>
                  <span>#{report.pr.number}</span>
                  <span className="report-mode">
                    {report.mode === "DEMO" ? "Demo" : "Live"}
                  </span>
                </p>
              </div>
            </div>
            <span className="report-list-priority" role="cell">
              <span className={cn("risk-badge", high ? "high" : "neutral")}>
                {high ? `${high} high priority` : "No high findings"}
              </span>
            </span>
            <time role="cell" dateTime={report.createdAt}>
              {new Intl.DateTimeFormat("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
                timeZone: "Asia/Dhaka",
              }).format(new Date(report.createdAt))}
            </time>
            <span role="cell" className="report-list-arrow">
              <Link
                href={`/report/${report.id}`}
                aria-label={`Open report for ${report.pr.title}`}
              >
                <ArrowUpRight size={15} />
              </Link>
            </span>
          </div>
        );
      })}
    </div>
  );
}
