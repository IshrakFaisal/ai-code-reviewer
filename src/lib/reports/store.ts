import {
  mkdir,
  open,
  writeFile,
  rename,
  readdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AnalysisReport } from "@/lib/types";
import { reportIdPattern, validateReport } from "./schema";

export const MAX_REPORT_BYTES = 64 * 1024 * 1024;
export type ReportIssue = {
  id: string;
  reason: "INVALID" | "TOO_LARGE" | "UNREADABLE";
};
export type ReportListing = {
  reports: AnalysisReport[];
  issues: ReportIssue[];
  unavailable: boolean;
};
export type StoredReport = {
  report: AnalysisReport | null;
  issue?: ReportIssue;
};

/** A separate directory can be supplied for isolated tests and storage tooling. */
export function reportStore(
  directory = path.join(process.cwd(), ".data", "reports"),
) {
  async function load(id: string): Promise<StoredReport> {
    if (!reportIdPattern.test(id)) return { report: null };
    const failed = (reason: ReportIssue["reason"]): StoredReport => ({
      report: null,
      issue: { id, reason },
    });
    try {
      const handle = await open(path.join(directory, `${id}.json`), "r");
      let raw: string;
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) return failed("UNREADABLE");
        if (stat.size > MAX_REPORT_BYTES) return failed("TOO_LARGE");
        // Limit the actual read as well: a file could grow after stat().
        const chunks: Buffer[] = [];
        let size = 0;
        while (true) {
          const buffer = Buffer.alloc(
            Math.min(65536, MAX_REPORT_BYTES + 1 - size),
          );
          const { bytesRead } = await handle.read(
            buffer,
            0,
            buffer.length,
            null,
          );
          if (!bytesRead) break;
          size += bytesRead;
          if (size > MAX_REPORT_BYTES) return failed("TOO_LARGE");
          chunks.push(buffer.subarray(0, bytesRead));
        }
        raw = Buffer.concat(chunks).toString("utf8");
      } finally {
        await handle.close();
      }
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        return failed("INVALID");
      }
      const report = validateReport(value, id);
      return report ? { report } : failed("INVALID");
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT"
        ? { report: null }
        : failed("UNREADABLE");
    }
  }

  async function list(): Promise<ReportListing> {
    let names: string[];
    try {
      names = (await readdir(directory)).filter(
        (name) =>
          name.endsWith(".json") && reportIdPattern.test(name.slice(0, -5)),
      );
    } catch (error) {
      return {
        reports: [],
        issues: [],
        unavailable: (error as NodeJS.ErrnoException).code !== "ENOENT",
      };
    }
    const reports: AnalysisReport[] = [],
      issues: ReportIssue[] = [];
    // Bound simultaneous parsing of large reports instead of loading all files at once.
    for (const name of names.sort()) {
      const result = await load(name.slice(0, -5));
      if (result.report) reports.push(result.report);
      if (result.issue) issues.push(result.issue);
    }
    reports.sort(
      (a, b) =>
        Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
        a.id.localeCompare(b.id),
    );
    return { reports, issues, unavailable: false };
  }

  return {
    load,
    list,
    async get(id: string) {
      return (await load(id)).report;
    },
    async save(input: AnalysisReport) {
      const report = validateReport(input);
      if (!report)
        throw new Error(
          "Report failed validation; no saved report was changed.",
        );
      const raw = JSON.stringify({ ...report, schemaVersion: 1 });
      if (Buffer.byteLength(raw, "utf8") > MAX_REPORT_BYTES)
        throw new Error("Report exceeds the 64 MiB storage limit.");
      await mkdir(directory, { recursive: true });
      const filename = path.join(directory, `${report.id}.json`);
      const temporary = path.join(
        directory,
        `${report.id}-${randomUUID()}.tmp`,
      );
      try {
        await writeFile(temporary, raw, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        await rename(temporary, filename);
      } finally {
        await unlink(temporary).catch(() => {});
      }
      const { reports } = await list();
      for (const old of reports.slice(100))
        await unlink(path.join(directory, `${old.id}.json`)).catch(() => {});
    },
  };
}
const store = reportStore();
export const saveReport = store.save;
export const getReport = store.get;
export const loadReport = store.load;
export const listReportsWithIssues = store.list;
export async function listReports(): Promise<AnalysisReport[]> {
  return (await store.list()).reports;
}
