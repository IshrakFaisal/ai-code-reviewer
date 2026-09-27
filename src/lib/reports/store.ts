import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import type { AnalysisReport } from "@/lib/types";
const directory = path.join(process.cwd(), ".data", "reports");
const validId =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export async function saveReport(report: AnalysisReport) {
  if (!validId.test(report.id)) throw new Error("Invalid report ID.");
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, `${report.id}.json`);
  await writeFile(`${filename}.tmp`, JSON.stringify(report), "utf8");
  await rename(`${filename}.tmp`, filename);
  const existing = await listReports();
  for (const old of existing.slice(100))
    await unlink(path.join(directory, `${old.id}.json`)).catch(() => {});
}
export async function getReport(id: string): Promise<AnalysisReport | null> {
  if (!validId.test(id)) return null;
  try {
    return JSON.parse(
      await readFile(path.join(directory, `${id}.json`), "utf8"),
    );
  } catch {
    return null;
  }
}
export async function listReports(): Promise<AnalysisReport[]> {
  try {
    const names = (await readdir(directory)).filter(
      (n) => validId.test(n.replace(/\.json$/, "")) && n.endsWith(".json"),
    );
    const reports = await Promise.all(
      names.map((n) => getReport(n.slice(0, -5))),
    );
    return reports
      .filter((r): r is AnalysisReport => !!r)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}
