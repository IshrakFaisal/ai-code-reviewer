import Link from "next/link";
import { ArrowUpRight, GitPullRequest, History } from "lucide-react";
import { listReports } from "@/lib/reports/store";
import { Button } from "@/components/ui/button";
export default async function HistoryPage() {
  const reports = await listReports();
  return (
    <div className="page">
      <div className="page-eyebrow">YOUR WORKSPACE</div>
      <div className="section-heading">
        <div>
          <h1>Analysis history</h1>
          <p>
            Recent reports stored locally on this server. Up to 100 reports
            retained.
          </p>
        </div>
        <Button asChild>
          <Link href="/">New analysis</Link>
        </Button>
      </div>
      {!reports.length ? (
        <div className="panel empty-state">
          <History size={32} />
          <h2>A clean slate.</h2>
          <p>Your completed investigations will appear here.</p>
          <Button asChild variant="outline">
            <Link href="/analyze?demo=true">Run your first demo</Link>
          </Button>
        </div>
      ) : (
        <div className="history-list">
          {reports.map((r) => (
            <Link key={r.id} href={`/report/${r.id}`} className="history-row">
              <GitPullRequest size={22} />
              <div>
                <strong>{r.pr.title}</strong>
                <p>
                  {r.pr.owner}/{r.pr.repo} #{r.pr.number} ·{" "}
                  {new Date(r.createdAt).toLocaleDateString("en-US")} · {r.mode}
                </p>
              </div>
              <span className="risk-badge high">
                {r.findings.filter((f) => f.severity === "HIGH").length} high
                priority
              </span>
              <ArrowUpRight size={18} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
