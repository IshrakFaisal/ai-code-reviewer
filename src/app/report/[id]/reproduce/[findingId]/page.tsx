import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getReport } from "@/lib/reports/store";
import { investigate } from "@/lib/agent/investigator";
import { regressions } from "@/lib/regression/store";
import { sandboxAllowed, selectedSandboxProvider } from "@/lib/sandbox/factory";
import { ReproductionView } from "@/components/report/reproduction-view";
import { matchesRegressionScope } from "@/lib/regression/schema";
export const metadata: Metadata = {
  title: "Reproduce & repair · AI Change Verifier",
};
export default async function ReproductionPage({
  params,
}: {
  params: Promise<{ id: string; findingId: string }>;
}) {
  const { id, findingId } = await params;
  if (!/^finding-[1-9][0-9]{0,2}$/.test(findingId)) notFound();
  const report =
    id === "demo"
      ? await investigate({ input: "acme/platform", demo: true })
      : await getReport(id);
  if (!report) notFound();
  if (id === "demo") report.id = "demo";
  const finding = report.findings.find((f) => f.id === findingId);
  if (!finding) notFound();
  const supported =
    report.mode === "DEMO"
      ? finding.id === "finding-1"
      : finding.generatedTest?.framework === "vitest";
  const executionReady =
    report.mode === "DEMO" ||
    (["docker", "nebius"].includes(selectedSandboxProvider()) &&
      sandboxAllowed(`${report.pr.owner}/${report.pr.repo}`));
  const stored = await regressions.load(id, findingId);
  const current =
    stored.result && matchesRegressionScope(stored.result, report, finding);
  return (
    <ReproductionView
      key={`${id}-${findingId}`}
      report={report}
      finding={finding}
      initial={current ? stored.result : null}
      initialNotice={
        stored.issue ||
        (stored.result && !current
          ? "The saved comparison belongs to a different test or revision. Run a new comparison for this finding."
          : undefined)
      }
      supported={!!supported}
      executionReady={executionReady}
      aiReady={!!process.env.NEBIUS_API_KEY && !!process.env.NEBIUS_MODEL}
    />
  );
}
