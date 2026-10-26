import { assertionRows } from "@/lib/regression/comparison";
import type { AssertionOutcome } from "@/lib/regression/comparison";
import type { RegressionResult } from "@/lib/regression/types";
const labels: Record<AssertionOutcome, string> = {
  PASS: "Pass · 2/2",
  FAIL: "Fail · 2/2",
  UNSTABLE: "Varies between runs",
  INCONCLUSIVE: "Inconclusive",
  NOT_RECORDED: "Not recorded",
};
export function AssertionComparison({ result }: { result: RegressionResult }) {
  const rows = assertionRows(result);
  if (!rows.length) return null;
  const patched = !!result.repair?.result;
  return (
    <div className="assertion-comparison">
      <h3>Assertion outcomes</h3>
      <p>
        Compare the same named assertion across both repeats. Missing or
        inconsistent results remain visible.
      </p>
      <table>
        <caption className="sr-only">
          Assertion results at base, head
          {patched ? ", and proposed repair" : ""}
        </caption>
        <thead>
          <tr>
            <th scope="col">Assertion</th>
            <th scope="col">Base</th>
            <th scope="col">Head</th>
            {patched && <th scope="col">After repair</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <th scope="row">{row.name}</th>
              {(
                ["base", "head", ...(patched ? ["repair"] : [])] as (
                  "base" | "head" | "repair"
                )[]
              ).map((column) => (
                <td
                  key={column}
                  data-label={
                    column === "repair"
                      ? "After repair"
                      : column === "base"
                        ? "Base"
                        : "Head"
                  }
                >
                  <span
                    className={`assertion-state ${row[column].toLowerCase()}`}
                  >
                    {labels[row[column]]}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
