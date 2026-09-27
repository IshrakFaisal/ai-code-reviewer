import { notFound } from "next/navigation";
import { getReport } from "@/lib/reports/store";
import { investigate } from "@/lib/agent/investigator";
import { ReportView } from "@/components/report/report-view";
export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const report =
    id === "demo"
      ? await investigate({ input: "acme/platform", demo: true })
      : await getReport(id);
  if (!report) notFound();
  return <ReportView report={report} />;
}
