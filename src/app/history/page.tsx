import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { History, Plus } from "lucide-react";
import { listReportsWithIssues } from "@/lib/reports/store";
import { ReportStorageNotice } from "@/components/report/report-storage-notice";
import { HistoryBrowser } from "@/components/report/history-browser";
import { summarizeReport } from "@/lib/reports/history";
import { Button } from "@/components/ui/button";
import { analysisRuns } from "@/lib/agent/runs";
import { UnfinishedAnalyses } from "@/components/history/unfinished-analyses";

export const metadata: Metadata = {
  title: "Analysis history · AI Change Verifier",
};
export default async function HistoryPage() {
  const [{ reports, issues, unavailable }, unfinished] = await Promise.all([
    listReportsWithIssues(),
    analysisRuns.listUnfinishedRuns().catch(() => null),
  ]);
  return (
    <div className="page history-page">
      <div className="page-heading">
        <div>
          <div className="page-eyebrow">Workspace activity</div>
          <h1>Analysis history</h1>
          <p>Reopen unfinished analyses and review completed reports.</p>
        </div>
        <Button asChild>
          <Link href="/">
            <Plus size={16} />
            New analysis
          </Link>
        </Button>
      </div>
      {unfinished ? (
        <UnfinishedAnalyses
          key={JSON.stringify(unfinished)}
          initial={unfinished}
        />
      ) : (
        <p role="status">Unfinished analyses could not be loaded.</p>
      )}
      <ReportStorageNotice issues={issues} unavailable={unavailable} />
      {!reports.length ? (
        <div className="panel empty-state">
          <History size={28} />
          <h2>
            {issues.length || unavailable
              ? "No readable analyses"
              : "No completed analyses yet"}
          </h2>
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
