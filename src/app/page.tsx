import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { getConfig } from "@/lib/config";
import { listReportsWithIssues } from "@/lib/reports/store";
import { ReportStorageNotice } from "@/components/report/report-storage-notice";
import { PRInput } from "@/components/github/pr-input";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { demo } = getConfig();
  const { reports, issues, unavailable } = await listReportsWithIssues();
  const query = await searchParams;
  const initialInput =
    typeof query.input === "string" ? query.input.slice(0, 300) : "";
  return (
    <div className="page home-page">
      <div className="page-heading">
        <div>
          <div className="page-eyebrow">Your workspace</div>
          <h1>Review workspace</h1>
          <p>Investigate changes. Inspect the evidence. Focus your review.</p>
        </div>
        <Link href="/history" className="text-link">
          View history
          <ArrowUpRight size={15} />
        </Link>
      </div>
      <ReportStorageNotice issues={issues} unavailable={unavailable} />
      <div className="workspace-stats" aria-label="Workspace activity">
        <span>
          <strong>{reports.length}</strong> saved analyses
        </span>
        <span>
          <strong>
            {
              new Set(
                reports
                  .filter((r) => r.mode === "LIVE")
                  .map((r) => r.pr.owner + "/" + r.pr.repo),
              ).size
            }
          </strong>{" "}
          repositories
        </span>
        <span>
          <strong>{reports.filter((r) => r.mode === "LIVE").length}</strong>{" "}
          live reports
        </span>
        <span className="stats-caption">Stored locally in your workspace</span>
      </div>
      <PRInput key={initialInput} demo={demo} initialInput={initialInput} />
      <section
        className="workflow-section"
        id="workflow"
        aria-labelledby="workflow-heading"
      >
        <div className="section-heading">
          <h2 id="workflow-heading">How verification works</h2>
          <Link href="/how-it-works" className="text-link">
            Read the complete guide
            <ArrowRight size={14} />
          </Link>
        </div>
        <div className="workflow-grid">
          {[
            [
              "01",
              "Understand",
              "Read the diff, identify behavioral changes, and map affected systems.",
            ],
            [
              "02",
              "Verify",
              "Investigate risks with targeted checks and inspect execution evidence.",
            ],
            [
              "03",
              "Review",
              "Prioritize findings, record your decisions, and export the review.",
            ],
          ].map(([number, title, text]) => (
            <div className="workflow-item" key={number}>
              <span className="workflow-number">{number}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
