import { mkdir, open, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RegressionResult } from "./types";
import { validateRegression } from "./integrity";
export type StoredRegression = {
  result: RegressionResult | null;
  issue?: string;
};
export function regressionKey(reportId: string, findingId: string) {
  if (
    !/^(?:demo|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(
      reportId,
    ) ||
    !/^finding-[1-9][0-9]{0,2}$/.test(findingId)
  )
    throw new Error("Invalid reproduction identity.");
  return `${reportId}-${findingId}`;
}
export function regressionStore(
  directory = path.join(process.cwd(), ".data", "regressions"),
) {
  const load = async (
    reportId: string,
    findingId: string,
  ): Promise<StoredRegression> => {
    const key = regressionKey(reportId, findingId);
    try {
      const handle = await open(path.join(directory, `${key}.json`), "r");
      let raw: string;
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 1_500_000)
          return {
            result: null,
            issue:
              "Saved evidence is too large or unreadable. Run a new comparison to replace it.",
          };
        raw = await handle.readFile("utf8");
      } finally {
        await handle.close();
      }
      const value = validateRegression(JSON.parse(raw));
      return value?.reportId === reportId && value.findingId === findingId
        ? { result: value }
        : {
            result: null,
            issue:
              "Saved evidence failed its integrity checks. Run a new comparison to replace it.",
          };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { result: null };
      return {
        result: null,
        issue:
          "Saved evidence could not be read. Run a new comparison, or check the server’s storage permissions.",
      };
    }
  };
  return {
    load,
    async get(reportId: string, findingId: string) {
      return (await load(reportId, findingId)).result;
    },
    async save(result: RegressionResult) {
      const key = regressionKey(result.reportId, result.findingId);
      const checked = validateRegression(result);
      if (!checked)
        throw new Error(
          "Reproduction evidence failed integrity validation; the previous saved result was preserved.",
        );
      const raw = JSON.stringify(checked);
      if (Buffer.byteLength(raw) > 1_500_000)
        throw new Error("Reproduction evidence exceeds the storage limit.");
      await mkdir(directory, { recursive: true });
      const temporary = path.join(directory, `${key}-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, raw, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        await rename(temporary, path.join(directory, `${key}.json`));
      } finally {
        await unlink(temporary).catch(() => {});
      }
    },
  };
}
export const regressions = regressionStore();
