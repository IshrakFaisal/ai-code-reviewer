import { randomUUID } from "node:crypto";
import {
  lstat,
  open,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { canonicalUrl } from "../../../../../scripts/eval-sample";
import {
  csvRecords,
  csvRow,
  evidenceLabels,
  labelColumns,
  prColumns,
  score,
  summarySchema,
} from "../../../../../scripts/eval-score";
import {
  caught,
  completion,
  noiseLevels,
  references,
  verdicts,
  type BlindRun,
} from "@/components/eval/labels";

export class RunFileError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const invalid = () =>
  new RunFileError(422, "The evaluation files are incomplete or invalid.");
const missing = () => new RunFileError(404, "Evaluation run or row not found.");
const absent = (err: unknown) =>
  (err as NodeJS.ErrnoException)?.code === "ENOENT";
const runName = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/;
function validName(value: string) {
  if (!runName.test(value)) return false;
  const date = new Date(
    value.slice(0, 11) + value.slice(11).replaceAll("-", ":"),
  );
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().replaceAll(":", "-") === value
  );
}
function isPrUrl(value: string) {
  try {
    return canonicalUrl(value) === value;
  } catch {
    return false;
  }
}
const url = z.string().refine(isPrUrl);
const verdict = z.enum(["", ...verdicts]),
  reference = z.enum(["", ...references]);
const knownIssue = z.enum(["", ...caught]),
  noise = z.enum(["", ...noiseLevels]);
const finding = z
  .object({
    finding_key: z.string(),
    pr_url: url,
    evidence_label: z.enum(evidenceLabels),
    severity: z.enum(["LOW", "MEDIUM", "HIGH"]),
    title: z.string(),
    location: z.string(),
    verdict,
    invented_reference: reference,
    notes: z.string(),
  })
  .refine(
    (f) =>
      f.finding_key.startsWith(f.pr_url + "#") &&
      /^[\w-]{1,100}$/.test(f.finding_key.slice(f.pr_url.length + 1)),
  );
const pr = z.object({
  pr_url: url,
  reverted_by: z.union([z.literal(""), url]),
  caught_known_issue: knownIssue,
  noise,
  notes: z.string(),
});
const notes = z.string().max(20000);
const labelPatch = z
  .strictObject({
    finding_key: z.string().min(1).max(500),
    verdict: verdict.optional(),
    invented_reference: reference.optional(),
    notes: notes.optional(),
  })
  .refine((p) => Object.keys(p).length > 1);
const prPatch = z
  .strictObject({
    pr_url: url,
    caught_known_issue: knownIssue.optional(),
    noise: noise.optional(),
    notes: notes.optional(),
  })
  .refine((p) => Object.keys(p).length > 1);

function table<T>(raw: string, columns: string[], schema: z.ZodType<T>) {
  const [header, ...records] = csvRecords(raw);
  if (!header || JSON.stringify(header.cells) !== JSON.stringify(columns))
    throw invalid();
  const seen = new Set<string>();
  const rows = records.map(({ cells }) => {
    if (cells.length !== columns.length || seen.has(cells[0])) throw invalid();
    seen.add(cells[0]);
    return schema.parse(
      Object.fromEntries(columns.map((col, i) => [col, cells[i]])),
    );
  });
  return { rows, records };
}

async function directory(dir: string) {
  const stat = await lstat(dir).catch((e) => {
    if (absent(e)) throw missing();
    throw e;
  });
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new RunFileError(400, "Invalid evaluation directory.");
}
async function read(dir: string, name: string) {
  const file = path.join(dir, name);
  const stat = await lstat(file, { bigint: true });
  if (!stat.isFile() || stat.nlink !== 1n || stat.size > 32 * 1024 * 1024)
    throw invalid();
  const handle = await open(file, "r");
  try {
    const opened = await handle.stat({ bigint: true });
    if (
      opened.ino !== stat.ino ||
      // Windows path stats can lack the volume ID returned by handle.stat().
      (stat.dev !== 0n && opened.dev !== stat.dev) ||
      opened.nlink !== 1n
    )
      throw invalid();
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      await handle.readFile(),
    );
  } finally {
    await handle.close();
  }
}
export function evaluationStore(
  root = path.resolve("eval-output"),
  replace = rename,
) {
  async function resolveRun(name: string) {
    if (!validName(name))
      throw new RunFileError(400, "Invalid evaluation run name.");
    await directory(root);
    const dir = path.join(root, name);
    await directory(dir);
    return dir;
  }
  async function sheets(dir: string) {
    const [labels, prs] = await Promise.all([
      read(dir, "labels.csv"),
      read(dir, "prs.csv"),
    ]);
    const findings = table(labels, labelColumns, finding).rows;
    const pulls = table(prs, prColumns, pr).rows;
    const urls = new Set(pulls.map((row) => row.pr_url));
    if (findings.some((f) => !urls.has(f.pr_url))) throw invalid();
    return { findings, prs: pulls };
  }
  async function load(name: string): Promise<BlindRun> {
    const dir = await resolveRun(name);
    const data = await sheets(dir);
    const raw = await read(dir, "descriptions.json").catch((e) => {
      if (absent(e)) return "{}";
      throw e;
    });
    const descriptions = z
      .record(z.string(), z.string())
      .parse(JSON.parse(raw));
    return {
      run: name,
      prs: data.prs,
      findings: data.findings.map((f) => ({
        ...f,
        description: descriptions[f.finding_key] ?? "",
      })),
    };
  }
  async function list() {
    try {
      await directory(root);
    } catch (e) {
      if (e instanceof RunFileError && e.status === 404) return [];
      throw e;
    }
    const entries = await readdir(root, { withFileTypes: true });
    const runs = [];
    for (const name of entries
      .filter((e) => e.isDirectory() && validName(e.name))
      .map((e) => e.name)
      .sort()
      .reverse()) {
      try {
        const { findings, prs } = await sheets(await resolveRun(name));
        runs.push({
          run: name,
          prs: prs.length,
          findings: findings.length,
          ...completion(findings),
        });
      } catch (e) {
        if (!absent(e)) throw e;
      } // Sampling-only directories contain urls.txt.
    }
    return runs;
  }
  let pending = Promise.resolve();
  function patch(name: string, kind: "labels" | "prs", input: unknown) {
    const task = pending.then(async () => {
      const dir = await resolveRun(name);
      const label = kind === "labels";
      const parsed = (label ? labelPatch : prPatch).safeParse(input);
      if (!parsed.success) throw new RunFileError(400, "Invalid label update.");
      const update = parsed.data;
      const key = "finding_key" in update ? update.finding_key : update.pr_url;
      const columns = label ? labelColumns : prColumns;
      const filename = path.join(dir, kind + ".csv");
      const raw = await read(dir, kind + ".csv");
      const { records } = label
        ? table(raw, columns, finding)
        : table(raw, columns, pr);
      const row = records.find((r) => r.cells[0] === key);
      if (!row) throw missing();
      const fields: Record<string, string> = Object.fromEntries(
        Object.entries(update),
      );
      const changed = csvRow(columns.map((c, i) => fields[c] ?? row.cells[i]));
      const temp = path.join(dir, randomUUID() + ".tmp");
      try {
        await writeFile(
          temp,
          raw.slice(0, row.start) + changed + raw.slice(row.end),
          { flag: "wx", mode: 0o600 },
        );
        await replace(temp, filename);
      } finally {
        await unlink(temp).catch((e) => {
          if (!absent(e)) throw e;
        });
      }
    });
    pending = task.catch(() => {});
    return task;
  }
  async function scores(name: string) {
    const dir = await resolveRun(name);
    const [labels, prs, summary, anchors] = await Promise.all(
      ["labels.csv", "prs.csv", "summary.json", "anchors.csv"].map((f) =>
        read(dir, f),
      ),
    );
    return score(
      labels,
      prs,
      summarySchema.parse(JSON.parse(summary)),
      anchors,
    );
  }
  return { list, load, patch, scores };
}
export const evaluations = evaluationStore();
