import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AnalysisRuns, analysisRuns } from "@/lib/agent/runs";
import { analysisRunStore } from "@/lib/agent/run-store";
import type { RunRecord } from "@/lib/agent/run-schema";
import { GET } from "@/app/api/runs/route";
import { POST } from "@/app/api/runs/[id]/discard/route";

let directory: string;
let store: ReturnType<typeof analysisRunStore>;
let runs: AnalysisRuns;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "unfinished-runs-"));
  store = analysisRunStore(directory);
  runs = new AnalysisRuns(store, async (_input, _progress, signal) => {
    await new Promise<void>((_, reject) => {
      signal!.addEventListener("abort", () => reject(signal!.reason), {
        once: true,
      });
      signal!.throwIfAborted();
    });
    throw new Error("Unexpected completion");
  });
  vi.spyOn(analysisRuns, "listUnfinishedRuns").mockImplementation(() =>
    runs.listUnfinishedRuns(),
  );
  vi.spyOn(analysisRuns, "discard").mockImplementation((id) =>
    runs.discard(id),
  );
  vi.stubEnv("APP_ORIGIN", "");
  vi.stubEnv("APP_AUTH_USERNAME", "");
  vi.stubEnv("APP_AUTH_PASSWORD", "");
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
function record(changes: Partial<RunRecord> = {}): RunRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    version: 1,
    status: "PAUSED",
    attempt: 1,
    input: { input: "acme/platform", demo: true },
    events: [],
    error: "",
    createdAt: now,
    updatedAt: now,
    checkpoint: { values: {}, events: [] },
    ...changes,
  };
}
const list = () => GET(new Request("http://localhost/api/runs"));
const discard = (id: string, headers?: HeadersInit) =>
  POST(
    new Request(`http://localhost/api/runs/${id}/discard`, {
      method: "POST",
      headers,
    }),
    { params: Promise.resolve({ id }) },
  );

it("lists incomplete checkpoints, prefers saved PR metadata and summarizes errors", async () => {
  const paused = record({
    error: "private diagnostic\nwith raw provider output",
  });
  paused.checkpoint.values = {
    settings: { demo: true },
    pullRequest: {
      owner: "acme",
      repo: "platform",
      number: 127,
      title: "Password\nreset",
    },
  };
  paused.events.push({
    stage: 4,
    label: "Categorize",
    at: paused.createdAt,
    detail: "Running",
    status: "RUNNING",
  });
  const complete = record({ status: "COMPLETE" });
  complete.reportId = complete.id;
  await store.save(complete);
  await store.save(paused);
  const response = await list();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    runs: [
      {
        runId: paused.id,
        repository: "acme/platform",
        prNumber: 127,
        title: "Password reset",
        mode: "DEMO",
        stage: 5,
        totalStages: 14,
        status: "PAUSED",
        startedAt: paused.createdAt,
        updatedAt: paused.updatedAt,
        error: "Analysis paused.",
      },
    ],
    unreadable: [],
  });
});
it("marks an orphaned RUNNING file interrupted without changing it on disk", async () => {
  const stale = record({
    status: "RUNNING",
    input: { input: "https://github.com/team/project/pull/4" },
    checkpoint: { values: { settings: { demo: false } }, events: [] },
  });
  await store.save(stale);
  const summary = (await runs.listUnfinishedRuns()).runs[0];
  expect(summary).toMatchObject({
    status: "INTERRUPTED",
    repository: "team/project",
    prNumber: 4,
    title: null,
    mode: "LIVE",
    stage: 0,
  });
  expect((await store.get(stale.id))?.status).toBe("RUNNING");
});
it("returns 200 with filenames only for malformed JSON and invalid schemas", async () => {
  const names = [randomUUID() + ".json", randomUUID() + ".json"];
  await writeFile(path.join(directory, names[0]), "private file content");
  await writeFile(path.join(directory, names[1]), "{}");
  await store.save(record());
  const response = await list();
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.unreadable).toEqual(names.sort());
  expect(body.runs).toHaveLength(1);
});
it("caps the listing after sorting by most recent update", async () => {
  const records = Array.from({ length: 102 }, (_, i) =>
    record({ updatedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }),
  );
  for (const item of records) await store.save(item);
  expect(
    (await runs.listUnfinishedRuns()).runs.map((run) => run.runId),
  ).toEqual(
    records
      .slice(2)
      .reverse()
      .map((run) => run.id),
  );
});
it("discards only the requested paused checkpoint and returns 404 on retry", async () => {
  const paused = record(),
    keep = record();
  await store.save(paused);
  await store.save(keep);
  expect((await discard(paused.id)).status).toBe(204);
  expect(await store.get(paused.id)).toBeNull();
  expect(await store.get(keep.id)).toEqual(keep);
  expect((await discard(paused.id)).status).toBe(404);
  expect((await discard("../checkpoint")).status).toBe(400);
});
it("reports an executing run as RUNNING and preserves its checkpoint on conflict", async () => {
  const job = await runs.start({ input: "acme/platform", demo: true });
  try {
    const before = await store.get(job.snapshot.id);
    expect((await runs.listUnfinishedRuns()).runs[0].status).toBe("RUNNING");
    expect((await discard(job.snapshot.id)).status).toBe(409);
    expect(await store.get(job.snapshot.id)).toEqual(before);
  } finally {
    await runs.pause(job.snapshot.id);
    await job.done;
  }
});
it.each([401, 403, 503])(
  "mirrors existing route authorization (%i)",
  async (status) => {
    if (status === 403) vi.stubEnv("APP_ORIGIN", "https://review.example");
    else {
      vi.stubEnv("APP_AUTH_USERNAME", "reviewer");
      vi.stubEnv(
        "APP_AUTH_PASSWORD",
        status === 401 ? "long-enough-password-for-testing" : "short",
      );
    }
    for (const response of [await list(), await discard(randomUUID())]) {
      expect(response.status).toBe(status);
      if (status === 401)
        expect(response.headers.get("www-authenticate")).toContain("Basic");
    }
    expect(analysisRuns.discard).not.toHaveBeenCalled();
    expect(analysisRuns.listUnfinishedRuns).not.toHaveBeenCalled();
  },
);
it("rejects a cross-origin discard before storage access", async () => {
  expect(
    (await discard(randomUUID(), { origin: "https://other.example" })).status,
  ).toBe(403);
  expect(analysisRuns.discard).not.toHaveBeenCalled();
});
