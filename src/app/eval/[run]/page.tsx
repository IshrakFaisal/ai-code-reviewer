import Link from "next/link";
import { notFound } from "next/navigation";
import { evaluations, RunFileError } from "@/app/api/eval/_lib/store";
import { Labeler } from "@/components/eval/labeler";
export default async function LabelingPage({
  params,
}: {
  params: Promise<{ run: string }>;
}) {
  if (process.env.ENABLE_EVAL_UI !== "true") notFound();
  const { run } = await params;
  const data = await evaluations.load(run).catch((e) => {
    if (
      (e instanceof RunFileError && [400, 404].includes(e.status)) ||
      (e as NodeJS.ErrnoException)?.code === "ENOENT"
    )
      notFound();
    throw new Error("Could not load the evaluation labels.");
  });
  return (
    <div className="page">
      <Link href="/eval">← Evaluation runs</Link>
      <div className="page-heading">
        <div>
          <h1>Label findings</h1>
          <p>
            {run} · Edit here or in a spreadsheet, one at a time. Each change
            saves automatically.
          </p>
        </div>
      </div>
      <Labeler key={run} initial={data} />
    </div>
  );
}
