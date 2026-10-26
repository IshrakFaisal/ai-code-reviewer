import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { History, Plus } from "lucide-react";
import { listReports } from "@/lib/reports/store";
import { HistoryBrowser } from "@/components/report/history-browser";
import { summarizeReport } from "@/lib/reports/history";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Analysis history · AI Change Verifier",
};
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
        <Suspense fallback={<p role="status">Loading saved analyses…</p>}>
          <HistoryBrowser reports={reports.map(summarizeReport)} />
        </Suspense>
      )}
    </div>
  );
}
