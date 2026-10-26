import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, GitCompareArrows } from "lucide-react";
import { getReport, listReports } from "@/lib/reports/store";
import { earlierReports, compareReports } from "@/lib/reports/comparison";
import { reanalysisHref } from "@/lib/reports/history";
import { ComparisonView, runDate } from "@/components/report/comparison-view";
import { Button } from "@/components/ui/button";

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const report = await getReport(id);
  if (!report) notFound();
  const query = await searchParams;
  const earlier = earlierReports(report, await listReports());
  const selected =
    query.baseline === undefined
      ? earlier[0]
      : earlier.find((candidate) => candidate.id === query.baseline);
  return (
    <div className="page comparison-page">
      <Link className="text-link" href={`/report/${report.id}`}>
        <ArrowLeft size={14} />
        Back to report
      </Link>
      <div className="page-heading">
        <div>
          <div className="page-eyebrow">
            Follow-up review ·{" "}
            {report.mode === "DEMO" ? "Demo fixture" : "Live analyses"}
          </div>
          <h1>Compare analyses</h1>
          <p>
            {report.pr.owner}/{report.pr.repo} #{report.pr.number} ·{" "}
            {report.pr.title}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={reanalysisHref(report)}>
            {report.mode === "DEMO" ? "Run demo again" : "Analyze again"}
          </Link>
        </Button>
      </div>
      {!earlier.length ? (
        <div className="panel empty-state">
          <GitCompareArrows size={28} />
          <h2>No earlier run for this PR</h2>
          <p>
            Analyze this pull request again, then open Compare runs on the new
            report. Comparisons use earlier reports for the same repository, PR
            number, and mode retained in local history.
          </p>
          <Button asChild variant="outline">
            <Link href="/history">Browse history</Link>
          </Button>
        </div>
      ) : (
        <>
          <form
            className="comparison-picker"
            action={`/report/${report.id}/compare`}
            method="get"
          >
            <label htmlFor="comparison-baseline">
              Earlier analysis
              <select
                name="baseline"
                id="comparison-baseline"
                defaultValue={selected?.id ?? ""}
                required
              >
                <option value="" disabled>
                  Select an earlier analysis
                </option>
                {earlier.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {runDate(candidate.createdAt)} ·{" "}
                    {candidate.pr.headSha.slice(0, 7)} · {candidate.provider}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" size="small">
              Compare
            </Button>
          </form>
          {selected ? (
            <ComparisonView
              before={selected}
              after={report}
              comparison={compareReports(selected, report)}
            />
          ) : (
            <div className="notice" role="alert">
              That baseline is unavailable or does not belong to an earlier run
              of this PR in the same mode. Choose an analysis above.
            </div>
          )}
        </>
      )}
    </div>
  );
}
