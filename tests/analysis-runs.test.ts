import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { AnalysisRuns } from "@/lib/agent/runs";
import { analysisRunStore } from "@/lib/agent/run-store";
import { checkpointSteps } from "@/lib/agent/checkpoint";
import type { InvestigationCheckpoint } from "@/lib/agent/checkpoint";
import type { RunRecord } from "@/lib/agent/run-schema";
import type { investigate } from "@/lib/agent/investigator";
import type { AnalysisReport } from "@/lib/types";

function memoryStore() {
  const records = new Map<string, RunRecord>();
  return {
    records,
    get: vi.fn(async (id: string) => structuredClone(records.get(id) ?? null)),
    save: vi.fn(async (record: RunRecord) => {
      records.set(record.id, structuredClone(record));
    }),
  };
}
function engine() {
  const release = new Map<string, () => void>();
  const execute = vi.fn<typeof investigate>(
    async (_input, _events, signal, session) => {
      await session!.persist(
        session!.checkpoint?.values.intent
          ? session!.checkpoint
          : { values: { intent: "retained preparation" }, events: [] },
      );
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(signal!.reason);
        release.set(session!.id, () => {
          signal!.removeEventListener("abort", abort);
          resolve();
        });
        signal!.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
      return { id: session!.id } as AnalysisReport;
    },
  );
  return { release, execute };
}
const input = { input: "acme/platform", demo: true };
describe("durable analysis lifecycle", () => {
  it("deduplicates simultaneous starts and reconnects completed runs without re-execution", async () => {
    const store = memoryStore(),
      { execute, release } = engine(),
      save = vi.fn();
    const runs = new AnalysisRuns(store, execute, save),
      id = randomUUID();
    const [first, second] = await Promise.all([
      runs.start(input, id),
      runs.start(input, id),
    ]);
    expect(execute).toHaveBeenCalledOnce();
    expect(first.snapshot.id).toBe(second.snapshot.id);
    await vi.waitFor(() => expect(release.has(id)).toBe(true));
    release.get(id)!();
    await first.done;
    expect(await runs.get(id)).toMatchObject({
      status: "COMPLETE",
      reportId: id,
    });
    await runs.resume(id);
    expect(execute).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
    await expect(runs.start({ input: "other/repo" }, id)).rejects.toMatchObject(
      { status: 409 },
    );
  });
  it("pauses cooperatively and resumes with saved preparation and the same ID", async () => {
    const store = memoryStore(),
      { execute, release } = engine(),
      runs = new AnalysisRuns(store, execute, vi.fn());
    const first = await runs.start(input);
    await vi.waitFor(() => expect(release.has(first.snapshot.id)).toBe(true));
    await runs.pause(first.snapshot.id);
    await first.done;
    expect(await runs.get(first.snapshot.id)).toMatchObject({
      status: "PAUSED",
      attempt: 1,
    });
    const resumed = await runs.resume(first.snapshot.id);
    expect(execute.mock.calls[1][3]?.checkpoint?.values.intent).toBe(
      "retained preparation",
    );
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    await runs.pause(first.snapshot.id);
    await resumed.done;
    expect(await runs.get(first.snapshot.id)).toMatchObject({
      status: "PAUSED",
      attempt: 2,
    });
  });
  it("recognizes a server restart and requires explicit resume", async () => {
    const store = memoryStore(),
      id = randomUUID(),
      now = new Date().toISOString();
    store.records.set(id, {
      version: 1,
      id,
      input,
      status: "RUNNING",
      attempt: 1,
      createdAt: now,
      updatedAt: now,
      error: "",
      events: [],
      checkpoint: { values: { intent: "retained preparation" }, events: [] },
    });
    const { execute, release } = engine(),
      runs = new AnalysisRuns(store, execute, vi.fn());
    expect((await runs.start(input, id)).snapshot.status).toBe("INTERRUPTED");
    expect(execute).not.toHaveBeenCalled();
    const resumed = await runs.resume(id);
    await vi.waitFor(() => expect(release.has(id)).toBe(true));
    release.get(id)!();
    await resumed.done;
    expect((await runs.get(id)).status).toBe("COMPLETE");
  });
  it("holds two execution slots, then releases them after cancellation", async () => {
    const store = memoryStore(),
      { execute, release } = engine(),
      runs = new AnalysisRuns(store, execute, vi.fn());
    const one = await runs.start(input),
      two = await runs.start(input);
    await expect(runs.start(input)).rejects.toMatchObject({ status: 429 });
    await vi.waitFor(() => expect(release.size).toBe(2));
    await runs.pause(one.snapshot.id);
    await one.done;
    const three = await runs.start(input);
    await runs.pause(two.snapshot.id);
    await runs.pause(three.snapshot.id);
    await Promise.all([two.done, three.done]);
  });
  it("never marks a run complete if report persistence fails", async () => {
    const store = memoryStore(),
      save = vi.fn().mockRejectedValue(new Error("Disk full"));
    const execute: typeof investigate = async (
      _input,
      _events,
      _signal,
      session,
    ) => ({ id: session!.id }) as AnalysisReport;
    const runs = new AnalysisRuns(store, execute, save);
    const job = await runs.start(input);
    await job.done;
    expect(await runs.get(job.snapshot.id)).toMatchObject({
      status: "INTERRUPTED",
      error: "Disk full",
    });
  });
});
describe("step checkpoints", () => {
  it("reuses validated outputs without leaking subsequent mutations into saved state", async () => {
    let saved: InvestigationCheckpoint | undefined;
    const session = {
      id: randomUUID(),
      persist: async (value: InvestigationCheckpoint) => {
        saved = value;
      },
    };
    const first = checkpointSteps(session),
      schema = z.object({ value: z.string() });
    const value = await first.step("intent", schema, async () => ({
      value: "original",
    }));
    value.value = "mutated";
    const work = vi.fn();
    expect(
      await checkpointSteps({ ...session, checkpoint: saved }).step(
        "intent",
        schema,
        work,
      ),
    ).toEqual({ value: "original" });
    expect(work).not.toHaveBeenCalled();
    await expect(
      first.step("behaviors", schema, async () => {
        throw new Error("interrupted");
      }),
    ).rejects.toThrow("interrupted");
    expect(saved!.values).not.toHaveProperty("behaviors");
  });
});
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((folder) => rm(folder, { recursive: true, force: true })),
  );
});
describe("checkpoint storage validation", () => {
  it("round trips atomically and rejects mismatched or corrupt records without overwriting them", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "analysis-runs-"));
    temporary.push(directory);
    const store = analysisRunStore(directory),
      id = randomUUID(),
      now = new Date().toISOString();
    const record: RunRecord = {
      version: 1,
      id,
      input,
      status: "RUNNING",
      attempt: 1,
      createdAt: now,
      updatedAt: now,
      error: "",
      events: [],
      checkpoint: { values: {}, events: [] },
    };
    await store.save(record);
    expect(await store.get(id)).toEqual(record);
    await writeFile(path.join(directory, `${id}.json`), "{broken");
    await expect(store.get(id)).rejects.toThrow("preserved");
    expect(await readFile(path.join(directory, `${id}.json`), "utf8")).toBe(
      "{broken",
    );
    await expect(store.get("../../secret")).rejects.toThrow();
    await writeFile(
      path.join(directory, `${id}.json`),
      JSON.stringify({ ...record, id: randomUUID() }),
    );
    await expect(store.get(id)).rejects.toThrow("preserved");
  });
});
