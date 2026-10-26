import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, FolderGit2, Settings2 } from "lucide-react";
import { listReports } from "@/lib/reports/store";
import { summarizeReport } from "@/lib/reports/history";
import { workspaceSummary } from "@/lib/workspace/summary";
import { ReportList } from "@/components/report/report-list";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Local workspace · AI Change Verifier",
};
const date = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Asia/Dhaka",
});

export default async function WorkspacePage() {
  const reports = (await listReports()).map(summarizeReport);
  const summary = workspaceSummary(reports);
  return (
    <div className="page workspace-page">
      <div className="page-heading">
        <div>
          <div className="page-eyebrow">Workspace overview</div>
          <h1>Local workspace</h1>
          <p>
            Your repositories, saved analyses, and review activity in one place.
          </p>
        </div>
        <Button asChild>
          <Link href="/#analyze">
            New analysis
            <ArrowRight size={15} />
          </Link>
        </Button>
      </div>
      <div className="workspace-overview-metrics">
        <div>
          <span>Saved analyses</span>
          <strong>{summary.total}</strong>
          <small>Retained on this server</small>
        </div>
        <div>
          <span>GitHub repositories</span>
          <strong>{summary.repositories.length}</strong>
          <small>From real PR analyses</small>
        </div>
        <div>
          <span>GitHub reports</span>
          <strong>{summary.live}</strong>
          <small>
            {summary.demo} demo {summary.demo === 1 ? "report" : "reports"}{" "}
            stored separately
          </small>
        </div>
      </div>
      <section aria-labelledby="repositories-heading">
        <div className="section-heading">
          <div>
            <h2 id="repositories-heading">Repositories</h2>
            <p>Open a repository to browse its saved analyses.</p>
          </div>
          <Link href="/history" className="text-link">
            All history
            <ArrowRight size={14} />
          </Link>
        </div>
        {summary.repositories.length ? (
          <div className="workspace-repositories">
            {summary.repositories.map((repository) => (
              <Link
                className="workspace-repository"
                key={`${repository.owner}/${repository.repo}`}
                href={`/history?q=${encodeURIComponent(`${repository.owner}/${repository.repo}`)}`}
              >
                <FolderGit2 size={20} />
                <div>
                  <strong>
                    {repository.owner}/{repository.repo}
                  </strong>
                  <span>
                    {repository.count} saved{" "}
                    {repository.count === 1 ? "analysis" : "analyses"}
                  </span>
                </div>
                <time dateTime={repository.latest.createdAt}>
                  {date.format(new Date(repository.latest.createdAt))}
                </time>
                <ArrowUpRight size={16} />
              </Link>
            ))}
          </div>
        ) : (
          <div className="workspace-empty">
            <FolderGit2 size={23} />
            <div>
              <h3>No GitHub repositories analyzed yet</h3>
              <p>
                Run a real PR analysis to add a repository. Demo reports remain
                available in history.
              </p>
              <Link href="/settings" className="text-link">
                Review analysis settings
                <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        )}
      </section>
      <section aria-labelledby="workspace-recent-heading">
        <div className="section-heading">
          <div>
            <h2 id="workspace-recent-heading">Recent activity</h2>
            <p>Resume an investigation or continue reviewing its findings.</p>
          </div>
        </div>
        {reports.length ? (
          <ReportList reports={reports.slice(0, 5)} />
        ) : (
          <div className="workspace-empty">
            <p>No saved analyses yet.</p>
            <Link href="/analyze?demo=true" className="text-link">
              Run the demo
              <ArrowRight size={14} />
            </Link>
          </div>
        )}
      </section>
      <aside className="workspace-storage">
        <div>
          <h2>Stored with your workspace</h2>
          <p>
            The newest 100 reports are retained locally. Reports and saved
            review decisions survive server restarts on the same filesystem.
            Review notes stay attached to their report and commit.
          </p>
        </div>
        <Link href="/settings" className="text-link">
          <Settings2 size={15} />
          Settings & integrations
        </Link>
      </aside>
    </div>
  );
}
