import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { EvalError } from "./eval-sample";

export const labelColumns = [
  "finding_key",
  "pr_url",
  "evidence_label",
  "severity",
  "title",
  "location",
  "verdict",
  "invented_reference",
  "notes",
];
export const anchorColumns = [
  "finding_key",
  "anchor_status",
  "shown_in_comment",
  "comment_rank",
  "reason",
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
const countSchema = z.number().int().nonnegative();
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
      findings: countSchema,
      verified: countSchema,
      pathOnly: countSchema,
      unanchored: countSchema,
      omittedFromComment: countSchema,
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
function keyRows(
  rows: Record<string, string>[],
  file: string,
  errors: string[],
) {
  const keys = new Map<string, number>();
  for (const [i, { finding_key: key }] of rows.entries()) {
    if (!key) errors.push(`${file} row ${i + 2}: missing finding_key`);
    else if (keys.has(key))
      errors.push(
        `${file} row ${i + 2}: duplicate finding_key (first at row ${keys.get(key)! + 2})`,
      );
    else keys.set(key, i);
  }
  return keys;
}
export function score(
  labelsCsv: string,
  prsCsv: string,
  summary: Summary,
  anchorsCsv: string,
) {
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
  const anchors = table(
    anchorsCsv,
    anchorColumns,
    "anchors.csv",
    {
      anchor_status: ["verified", "path-only", "unanchored", "not-checked"],
      shown_in_comment: ["y", "n"],
    },
    errors,
  );
  keyRows(labels, "labels.csv", errors);
  const anchorKeys = keyRows(anchors, "anchors.csv", errors);
  for (const [i, row] of anchors.entries()) {
    const shown = row.shown_in_comment === "y";
    if (shown ? !/^[1-5]$/.test(row.comment_rank) : row.comment_rank !== "")
      errors.push(`anchors.csv row ${i + 2}: comment_rank`);
    if (shown && row.anchor_status === "unanchored")
      errors.push(
        `anchors.csv row ${i + 2}: unanchored finding shown_in_comment`,
      );
  }
  for (const [i, row] of labels.entries()) {
    if (
      !row.finding_key.startsWith(row.pr_url + "#") ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(
        row.finding_key.slice(row.pr_url.length + 1),
      )
    )
      errors.push(
        `labels.csv row ${i + 2}: finding_key does not match pr_url and finding id`,
      );
    if (!anchorKeys.has(row.finding_key))
      errors.push(
        `labels.csv row ${i + 2}: no matching finding_key in anchors.csv`,
      );
  }
  if (errors.length) throw new EvalError(errors.join("\n"));
  const joined = labels.map((row) => ({
    ...row,
    ...anchors[anchorKeys.get(row.finding_key)!],
  }));
  const flagged = joined.filter(
    (row) =>
      row.anchor_status === "path-only" || row.anchor_status === "unanchored",
  );
  const count = (rows: typeof labels, key: string, value: string) =>
    rows.filter((row) => row[key] === value).length;
  function precision(rows: typeof labels) {
    const useful = count(rows, "verdict", "useful");
    return rate(useful, useful + count(rows, "verdict", "false_positive"));
  }
  const unlabeled = count(labels, "verdict", "");
  const invented = count(labels, "invented_reference", "y");
  const flaggedInvented = count(flagged, "invented_reference", "y");
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
    "- Shown-only precision: " +
      precision(joined.filter((row) => row.shown_in_comment === "y")),
    "- Guard recall: " + rate(flaggedInvented, invented),
    "- Guard precision: " +
      rate(
        flaggedInvented,
        flaggedInvented + count(flagged, "invented_reference", "n"),
      ),
    "- Blind spots: " +
      joined.filter(
        (row) =>
          row.invented_reference === "y" && row.anchor_status === "verified",
      ).length,
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
  const [labels, prs, raw, anchors] = await Promise.all([
    readFile(file, "utf8"),
    readFile(path.join(dir, "prs.csv"), "utf8"),
    readFile(path.join(dir, "summary.json"), "utf8"),
    readFile(path.join(dir, "anchors.csv"), "utf8").catch((error) => {
      if (error.code === "ENOENT")
        throw new EvalError("Missing anchors.csv beside labels.csv.");
      throw error;
    }),
  ]);
  const result = score(
    labels,
    prs,
    summarySchema.parse(JSON.parse(raw)),
    anchors,
  );
  await writeFile(path.join(dir, "scores.md"), result, "utf8");
  return result;
}
