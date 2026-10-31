import { notFound } from "next/navigation";
import { loadReport } from "@/lib/reports/store";
import { ReportStorageNotice } from "@/components/report/report-storage-notice";
import { investigate } from "@/lib/agent/investigator";
import { ReportView } from "@/components/report/report-view";
export default async function ReportLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  const stored = id === "demo" ? null : await loadReport(id);
  if (stored?.issue)
    return (
      <div className="page">
        <h1>Report unavailable</h1>
        <ReportStorageNotice issues={[stored.issue]} />
      </div>
    );
  const report =
    id === "demo"
      ? await investigate({ input: "acme/platform", demo: true })
      : stored?.report;
  if (!report) notFound();
  // The sample permalink needs a stable identity for its separate reviewer notes.
  if (id === "demo") report.id = "demo";
  return (
    <>
      <ReportView key={report.id} report={report} />
      {children}
    </>
  );
}
