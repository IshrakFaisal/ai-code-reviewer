import { notFound, redirect } from "next/navigation";
import { isReportSection, reportSectionHref } from "@/lib/reports/sections";
export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string; section: string }>;
}) {
  const { id, section } = await params;
  if (!isReportSection(section)) notFound();
  if (section === "summary") redirect(reportSectionHref(id, "summary"));
  return null;
}
