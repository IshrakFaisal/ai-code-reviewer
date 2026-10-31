import { mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runIdSchema, runRecordSchema, type RunRecord } from "./run-schema";

export function analysisRunStore(
  directory = path.join(process.cwd(), ".data", "runs"),
) {
  const limit = 64 * 1024 * 1024;
  return {
    async get(id: string): Promise<RunRecord | null> {
      runIdSchema.parse(id);
      try {
        const file = await open(path.join(directory, `${id}.json`), "r");
        const chunks: Buffer[] = [];
        try {
          if (!(await file.stat()).isFile())
            throw new Error("Invalid run file");
          let bytes = 0;
          while (true) {
            const buffer = Buffer.alloc(Math.min(65536, limit + 1 - bytes));
            const { bytesRead } = await file.read(
              buffer,
              0,
              buffer.length,
              null,
            );
            if (!bytesRead) break;
            bytes += bytesRead;
            if (bytes > limit) throw new Error("Oversized checkpoint");
            chunks.push(buffer.subarray(0, bytesRead));
          }
        } finally {
          await file.close();
        }
        const run = runRecordSchema.parse(
          JSON.parse(Buffer.concat(chunks).toString("utf8")),
        );
        if (run.id !== id) throw new Error("Run identity mismatch");
        return run;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw new Error(
          "Saved analysis checkpoint is unreadable or invalid. Existing data was preserved; start a new analysis.",
        );
      }
    },
    async save(value: RunRecord) {
      const run = runRecordSchema.parse(value);
      const raw = JSON.stringify(run);
      if (Buffer.byteLength(raw) > limit)
        throw new Error("Analysis checkpoint exceeds its storage limit.");
      await mkdir(directory, { recursive: true });
      const temporary = path.join(directory, `${run.id}-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, raw, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        await rename(temporary, path.join(directory, `${run.id}.json`));
      } finally {
        await unlink(temporary).catch(() => {});
      }
    },
  };
}
