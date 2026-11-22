import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { EvalError } from "./eval-sample";

export const labelColumns = [
  "pr_url",
  "evidence_label",
  "severity",
  "title",
  "location",
  "verdict",
  "invented_reference",
  "notes",
];
export const prColumns = [
  "pr_url",
  "reverted_by",
  "caught_known_issue",
  "noise",
  "notes",
];
export const evidenceLabels = [
  "AI inference",
  "Executed",
  "Static analysis",
  "Heuristic",
  "Demo hypothesis",
] as const;
export const summarySchema = z.object({
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  ai: z.boolean(),
  model: z.string(),
  selected: z.number().int().nonnegative(),
  attempts: z.array(
    z.object({
      url: z.url(),
      durationMs: z.number().nonnegative(),
      exitCode: z.number().int(),
      findings: z.number().int().nonnegative(),
    }),
  ),
});
export type Summary = z.infer<typeof summarySchema>;
export function csv(rows: string[][]) {
  return (
    rows
      .map((row) =>
        row
          .map((s) =>
            /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s,
          )
          .join(","),
      )
      .join("\r\n") + "\r\n"
  );
}
export function parseCsv(input: string) {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  function invalid(): never {
    throw new EvalError(`Invalid CSV at row ${rows.length + 1}.`);
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') {
        field += c;
        continue;
      }
      if (text[i + 1] === '"') {
        field += '"';
        i++;
        continue;
      }
      quoted = false;
      closed = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
      closed = false;
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      rows.push([...row, field]);
      row = [];
      field = "";
      closed = false;
    } else if (closed) invalid();
    else if (c === '"') {
      if (field) invalid();
      quoted = true;
    } else field += c;
  }
  if (quoted) invalid();
  if (row.length || field || closed) rows.push([...row, field]);
  return rows;
}
function table(
  input: string,
  columns: string[],
  file: string,
  allowed: Record<string, readonly string[]>,
  errors: string[],
) {
  const [header, ...rows] = parseCsv(input);
  if (JSON.stringify(header) !== JSON.stringify(columns))
    throw new EvalError("Unexpected columns in " + file + ".");
  return rows.map((row, i) => {
    if (row.length !== columns.length)
      errors.push(`${file} row ${i + 2}: column count`);
    const item = Object.fromEntries(
      columns.map((col, j) => [col, row[j] ?? ""]),
    );
    for (const [key, values] of Object.entries(allowed))
      if (!values.includes(item[key]))
        errors.push(`${file} row ${i + 2}: ${key}`);
    return item;
  });
}
function rate(yes: number, n: number) {
  return `${n ? (yes / n).toFixed(3) : "n/a"} (${yes}/${n}, n=${n})`;
}
export function score(labelsCsv: string, prsCsv: string, summary: Summary) {
  const errors: string[] = [];
  const labels = table(
    labelsCsv,
    labelColumns,
    "labels.csv",
    {
      evidence_label: evidenceLabels,
      severity: ["LOW", "MEDIUM", "HIGH"],
      verdict: ["", "useful", "false_positive", "unclear"],
      invented_reference: ["", "y", "n"],
    },
    errors,
  );
  const prs = table(
    prsCsv,
    prColumns,
    "prs.csv",
    {
      caught_known_issue: ["", "yes", "no", "n/a"],
      noise: ["", "low", "medium", "high"],
    },
    errors,
  );
  if (errors.length) throw new EvalError(errors.join("\n"));
  const count = (rows: typeof labels, key: string, value: string) =>
    rows.filter((row) => row[key] === value).length;
  function precision(rows: typeof labels) {
    const useful = count(rows, "verdict", "useful");
    return rate(useful, useful + count(rows, "verdict", "false_positive"));
  }
  const unlabeled = count(labels, "verdict", "");
  const invented = count(labels, "invented_reference", "y");
  const reverted = prs.filter((row) => row.reverted_by);
  const caught = count(reverted, "caught_known_issue", "yes");
  const times = summary.attempts.map((a) => a.durationMs).sort((a, b) => a - b);
  const middle = Math.floor(times.length / 2);
  const median = times.length
    ? (times[middle] + times[Math.floor((times.length - 1) / 2)]) / 2
    : null;
  return [
    "# Evaluation scores",
    "",
    ...(labels.length - unlabeled < 20
      ? ["indicative only, n too small for conclusions", ""]
      : []),
    "- Overall precision: " + precision(labels),
    ...evidenceLabels
      .filter((label) => labels.some((row) => row.evidence_label === label))
      .map(
        (label) =>
          "- " +
          label +
          " precision: " +
          precision(labels.filter((row) => row.evidence_label === label)),
      ),
    "- Unclear verdicts: " +
      count(labels, "verdict", "unclear") +
      "; unlabeled verdicts: " +
      unlabeled,
    "- Hallucination rate: " +
      rate(invented, invented + count(labels, "invented_reference", "n")) +
      "; unlabeled: " +
      count(labels, "invented_reference", ""),
    "- Reverted PR catch rate: " +
      rate(caught, caught + count(reverted, "caught_known_issue", "no")) +
      "; unlabeled: " +
      count(reverted, "caught_known_issue", "") +
      "; n/a: " +
      count(reverted, "caught_known_issue", "n/a"),
    "- Unlabeled PR noise: " + count(prs, "noise", ""),
    `- Review duration (ms): median ${median ?? "n/a"}, p90 ${times[Math.ceil(times.length * 0.9) - 1] ?? "n/a"} (n=${times.length})`,
    "- Failed reviews: " +
      summary.attempts.filter((a) => a.exitCode !== 0 && a.exitCode !== 3)
        .length,
    "",
  ].join("\n");
}
export async function scoreFile(file: string) {
  const dir = path.dirname(file);
  const [labels, prs, raw] = await Promise.all(
    [file, "prs.csv", "summary.json"].map((name, i) =>
      readFile(i ? path.join(dir, name) : name, "utf8"),
    ),
  );
  const result = score(labels, prs, summarySchema.parse(JSON.parse(raw)));
  await writeFile(path.join(dir, "scores.md"), result, "utf8");
  return result;
}
