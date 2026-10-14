import Link from "next/link";
import { History, Plus } from "lucide-react";
import { listReports } from "@/lib/reports/store";
import { ReportList } from "@/components/report/report-list";
import { Button } from "@/components/ui/button";

export default async function HistoryPage() {
  const reports = await listReports();
  return (
    <div className="page history-page">
      <div className="page-heading">
        <div>
          <div className="page-eyebrow">Workspace activity</div>
          <h1>Analysis history</h1>
          <p>
            Completed investigations, with their evidence and saved review
            decisions.
          </p>
        </div>
        <Button asChild>
          <Link href="/#analyze">
            <Plus size={16} />
            New analysis
          </Link>
        </Button>
      </div>
      <div className="list-toolbar">
        <span>
          <strong>{reports.length}</strong>{" "}
          {reports.length === 1 ? "report" : "reports"}
        </span>
        <span>Most recent first · Up to 100 retained locally</span>
      </div>
      {!reports.length ? (
        <div className="panel empty-state">
          <History size={28} />
          <h2>No analyses yet</h2>
          <p>
            Your completed reports will appear here. Start with the demo to
            explore the review workflow.
          </p>
          <Button asChild variant="outline">
            <Link href="/analyze?demo=true">Run your first demo</Link>
          </Button>
        </div>
      ) : (
        <ReportList reports={reports} />
      )}
    </div>
  );
}
