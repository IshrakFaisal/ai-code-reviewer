import Link from "next/link";
import { notFound } from "next/navigation";
import { evaluations } from "@/app/api/eval/_lib/store";
import styles from "@/components/eval/labeler.module.css";
export default async function EvaluationPage() {
  if (process.env.ENABLE_EVAL_UI !== "true") notFound();
  const runs = await evaluations.list();
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>Evaluation runs</h1>
          <p>
            Choose a run to label findings against the original pull requests.
          </p>
        </div>
      </div>
      {runs.length ? (
        <div className={"panel " + styles.tableWrap}>
          <table>
            <thead>
              <tr>
                {["Run (UTC)", "PRs", "Findings", "Labeled", "Complete"].map(
                  (t) => (
                    <th scope="col" key={t}>
                      {t}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.run}>
                  <td>
                    <Link href={"/eval/" + r.run}>{r.run}</Link>
                  </td>
                  <td>{r.prs}</td>
                  <td>{r.findings}</td>
                  <td>{r.labeled}</td>
                  <td>{r.percent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No evaluation runs with label sheets yet.</p>
      )}
    </div>
  );
}
