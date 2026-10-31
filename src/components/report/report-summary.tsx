"use client";

import { ArrowRight } from "lucide-react";
import type { AnalysisReport } from "@/lib/types";
import {
  reportEvidence,
  verificationGaps,
} from "@/lib/reports/verification-gaps";
import { reportSections, reportSectionHref } from "@/lib/reports/sections";
import { DraftProtectedLink as Link } from "./draft-navigation";

export function ReportSummary({ report }: { report: AnalysisReport }) {
  const evidence = reportEvidence(report);
  const executed = evidence.filter(
    (item) => item.provenance !== "STATIC" && item.status !== "NOT_RUN",
  );
  const failed = executed.filter((item) => item.status === "FAIL").length;
  const gaps = verificationGaps(report);
  const priority = [...report.findings]
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 3);
  const warningCount = new Set([...report.warnings, ...report.pr.warnings])
    .size;
  return (
    <section
      id="summary"
      className="report-summary"
      aria-labelledby="report-summary-heading"
    >
      <div className="section-heading">
        <div>
          <h2 id="report-summary-heading">Review summary</h2>
          <p>{report.summary}</p>
        </div>
      </div>
      <div className="report-summary-stats">
        <Link href={reportSectionHref(report.id, "findings")}>
          <strong>{report.findings.length}</strong>
          <span>Findings to review</span>
        </Link>
        <Link href={reportSectionHref(report.id, "verification")}>
          <strong>{executed.length}</strong>
          <span>
            {report.mode === "DEMO"
              ? "Fixture checks executed"
              : "Checks executed"}
          </span>
          <small>{failed} failed</small>
        </Link>
        <Link href={reportSectionHref(report.id, "gaps")}>
          <strong>{gaps.highRiskGaps}</strong>
          <span>High-risk evidence gaps</span>
        </Link>
        <Link
          href={`${reportSectionHref(report.id, "gaps")}#report-limitations`}
        >
          <strong>{warningCount}</strong>
          <span>Analysis limitations</span>
        </Link>
      </div>
      <p className="small-note">
        Risk signals guide review; passing checks only support the assertions
        tested.
      </p>
      <div className="report-summary-priority">
        <div className="section-heading compact">
          <h2>Start here</h2>
          <Link
            className="text-link"
            href={reportSectionHref(report.id, "next-steps")}
          >
            All next steps <ArrowRight size={14} />
          </Link>
        </div>
        {priority.length ? (
          priority.map((finding) => (
            <Link
              className="report-priority-row"
              key={finding.id}
              href={`${reportSectionHref(report.id, "findings")}#${encodeURIComponent(finding.id)}`}
            >
              <span className={`risk-badge ${finding.severity.toLowerCase()}`}>
                {finding.severity}
              </span>
              <span>
                <strong>{finding.title}</strong>
                <small>
                  {finding.status === "UNVERIFIED_RISK"
                    ? "Unverified risk"
                    : finding.status === "INCONCLUSIVE"
                      ? "Inconclusive evidence"
                      : finding.status === "VERIFIED_ISSUE"
                        ? "Verified issue in demo fixture"
                        : "Verified for this test"}
                </small>
              </span>
              <ArrowRight size={16} />
            </Link>
          ))
        ) : (
          <p>
            No findings recorded. Review verification results and evidence gaps
            before making a decision.
          </p>
        )}
      </div>
      <div className="report-directory" aria-label="Explore report details">
        {reportSections
          .filter(([section]) => section !== "summary")
          .map(([section, label, description]) => (
            <Link key={section} href={reportSectionHref(report.id, section)}>
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
              <ArrowRight size={16} />
            </Link>
          ))}
      </div>
    </section>
  );
}
