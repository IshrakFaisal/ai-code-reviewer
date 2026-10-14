import Link from "next/link";
import { ArrowRight, ArrowUpRight, GitPullRequest } from "lucide-react";
import { getConfig } from "@/lib/config";
import { listReports } from "@/lib/reports/store";
import { PRInput } from "@/components/github/pr-input";
import { ReportList } from "@/components/report/report-list";

export default async function Home() {
  const { demo } = getConfig();
  const reports = await listReports();
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
      <PRInput demo={demo} />
      <section className="recent-section" aria-labelledby="recent-heading">
        <div className="section-heading">
          <div>
            <h2 id="recent-heading">Recent analyses</h2>
            <p>Pick up where you left off.</p>
          </div>
          <Link href="/history" className="text-link">
            View all
            <ArrowRight size={14} />
          </Link>
        </div>
        {reports.length ? (
          <ReportList reports={reports.slice(0, 4)} />
        ) : (
          <div className="recent-empty">
            <GitPullRequest size={20} />
            <div>
              <strong>Your first report starts here</strong>
              <p>Analyze a pull request above, or explore the sample below.</p>
            </div>
          </div>
        )}
      </section>
      <section className="sample-preview" aria-labelledby="sample-heading">
        <div className="sample-finding">
          <div className="overline">
            Sample investigation <span className="mini-badge">Demo</span>
          </div>
          <h2 id="sample-heading">
            A passing build can still hide a broken flow.
          </h2>
          <p>
            Follow a password reset change from a risk hypothesis to an executed
            assertion. See why reusing the same token needs attention.
          </p>
          <Link href="/report/demo" className="text-link">
            Explore sample report
            <ArrowUpRight size={15} />
          </Link>
          <div className="sample-caption">
            acme/platform · PR #127 · Synthetic repository
          </div>
        </div>
        <div className="sample-proof">
          <div className="sample-proof-heading">
            <span>Password reset · token reuse</span>
            <span className="risk-badge high">Assertion failed</span>
          </div>
          <div className="sample-code">
            <span>01</span>
            <code>resetPassword(token, firstPassword)</code>
            <b className="green">200</b>
            <span>02</span>
            <code>resetPassword(token, secondPassword)</code>
            <b className="red">200</b>
          </div>
          <div className="sample-note">
            <span>Second request: expected 400, received 200</span>
          </div>
          <p>Real execution against the bundled demo fixture.</p>
        </div>
      </section>
      <section
        className="workflow-section"
        id="workflow"
        aria-labelledby="workflow-heading"
      >
        <div className="section-heading">
          <h2 id="workflow-heading">How verification works</h2>
          <span className="subtle">From change to review</span>
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
