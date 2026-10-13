import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ReviewConflictError,
  ReviewStore,
  ReviewStoreError,
} from "@/lib/reports/review-store";
import { reviewStateSchema, type ReviewSubject } from "@/lib/reports/review";
import { getReport } from "@/lib/reports/store";

vi.mock("@/lib/reports/store", () => ({ getReport: vi.fn() }));

const reportId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const subject: ReviewSubject = {
  id: reportId,
  headSha: "b".repeat(40),
  findingIds: ["finding-1", "finding-2"],
};
const base = path.resolve(".sandbox");
let directory: string;
let store: ReviewStore;
let findSubject: ReturnType<
  typeof vi.fn<(id: string) => Promise<ReviewSubject | null>>
>;

beforeEach(async () => {
  await mkdir(base, { recursive: true });
  directory = await mkdtemp(path.join(base, "review-store-test-"));
  findSubject = vi.fn(async (id) =>
    id === reportId ? structuredClone(subject) : null,
  );
  store = new ReviewStore(directory, findSubject);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  // Only delete the uniquely created test directory, never report storage.
  if (
    path.dirname(directory) !== base ||
    !path.basename(directory).startsWith("review-store-test-")
  )
    throw new Error("Invalid test cleanup path.");
  await rm(directory, { recursive: true, force: true });
});

describe("persistent human review decisions", () => {
  it("starts every real finding open without modifying the analysis", async () => {
    const state = await store.get(reportId);
    expect(state).toEqual({
      reportId,
      headSha: subject.headSha,
      revision: 0,
      updatedAt: null,
      findings: {
        "finding-1": { status: "OPEN", note: "", updatedAt: null },
        "finding-2": { status: "OPEN", note: "", updatedAt: null },
      },
    });
    expect(await readdir(directory)).toEqual([]);
  });

  it("preserves notes as plain text and reloads separate decisions after restart", async () => {
    const note =
      '<script>alert("test")</script>\nUse the original token twice.';
    const first = await store.update(reportId, {
      findingId: "finding-1",
      status: "NEEDS_FIX",
      note,
      revision: 0,
    });
    expect(first.revision).toBe(1);
    expect(first.findings["finding-1"].note).toBe(note);
    expect(first.findings["finding-1"].updatedAt).toBe(first.updatedAt);
    const restarted = new ReviewStore(directory, findSubject);
    expect(await restarted.get(reportId)).toEqual(first);
    const second = await restarted.update(reportId, {
      findingId: "finding-2",
      status: "DISMISSED",
      note: "Expected behavior",
      revision: 1,
    });
    expect(second.revision).toBe(2);
    expect(second.findings["finding-1"]).toEqual(first.findings["finding-1"]);
    expect(subject.findingIds).toEqual(["finding-1", "finding-2"]);
    expect(
      reviewStateSchema.parse(
        JSON.parse(
          await readFile(path.join(directory, reportId, "2.json"), "utf8"),
        ),
      ),
    ).toEqual(second);
  });

  it("lets exactly one concurrent writer publish a revision across store instances", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        new ReviewStore(directory, findSubject).update(reportId, {
          findingId: "finding-1",
          status: "REVIEWED",
          note: `Reviewer tab ${i}`,
          revision: 0,
        }),
      ),
    );
    const successes = results.filter((result) => result.status === "fulfilled");
    expect(successes).toHaveLength(1);
    const winner = await store.get(reportId);
    expect(winner.revision).toBe(1);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(ReviewConflictError);
        expect(result.reason.current).toEqual(winner);
      }
    }
    expect(await readdir(path.join(directory, reportId))).toEqual(["1.json"]);
  });

  it("returns the current state for a stale save without overwriting it", async () => {
    const current = await store.update(reportId, {
      findingId: "finding-1",
      status: "NEEDS_FIX",
      note: "Preserve this",
      revision: 0,
    });
    await expect(
      store.update(reportId, {
        findingId: "finding-2",
        status: "REVIEWED",
        note: "Stale tab",
        revision: 0,
      }),
    ).rejects.toMatchObject({ status: 409, current });
    expect(await store.get(reportId)).toEqual(current);
  });

  it("scopes decisions to report IDs even when findings and commits match", async () => {
    findSubject.mockImplementation(async (id) =>
      [reportId, otherId].includes(id) ? { ...subject, id } : null,
    );
    await store.update(reportId, {
      findingId: "finding-1",
      status: "DISMISSED",
      note: "One analysis only",
      revision: 0,
    });
    expect((await store.get(otherId)).findings["finding-1"].status).toBe(
      "OPEN",
    );
  });

  it("rejects traversal, missing reports, and findings from outside the report", async () => {
    await expect(store.get("../reports/secret")).rejects.toMatchObject({
      status: 400,
    });
    expect(findSubject).not.toHaveBeenCalled();
    await expect(store.get(otherId)).rejects.toMatchObject({ status: 404 });
    await expect(
      store.update(reportId, {
        findingId: "finding-3",
        status: "REVIEWED",
        note: "",
        revision: 0,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await readdir(directory)).toEqual([]);
  });

  it("rejects overlong notes and unknown decision properties", async () => {
    await expect(
      store.update(reportId, {
        findingId: "finding-1",
        status: "OPEN",
        note: "x".repeat(2001),
        revision: 0,
      }),
    ).rejects.toBeInstanceOf(ReviewStoreError);
    const extra = {
      findingId: "finding-1",
      status: "OPEN" as const,
      note: "",
      revision: 0,
      reportId: otherId,
    };
    await expect(store.update(reportId, extra)).rejects.toMatchObject({
      status: 400,
    });
    expect(await readdir(directory)).toEqual([]);
  });

  it("does not apply decisions to a changed commit", async () => {
    await store.update(reportId, {
      findingId: "finding-1",
      status: "REVIEWED",
      note: "",
      revision: 0,
    });
    findSubject.mockResolvedValue({ ...subject, headSha: "c".repeat(40) });
    await expect(store.get(reportId)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("different commit"),
    });
  });

  it("fails closed on a corrupt saved revision and ignores unpublished temporary files", async () => {
    const reportDirectory = path.join(directory, reportId);
    await mkdir(reportDirectory);
    await writeFile(
      path.join(reportDirectory, ".interrupted.tmp"),
      "half-written JSON",
    );
    expect((await store.get(reportId)).revision).toBe(0);
    await writeFile(path.join(reportDirectory, "1.json"), "half-written JSON");
    await expect(store.get(reportId)).rejects.toMatchObject({ status: 500 });
    await expect(
      store.update(reportId, {
        findingId: "finding-1",
        status: "OPEN",
        note: "",
        revision: 0,
      }),
    ).rejects.toMatchObject({ status: 500 });
  });

  it("supports the canonical demo without running inference or requiring a saved analysis", async () => {
    vi.stubEnv("MAX_INVESTIGATIONS", "2");
    const demoStore = new ReviewStore(directory);
    const state = await demoStore.get("demo");
    expect(state.reportId).toBe("demo");
    expect(state.headSha).toBe("b".repeat(40));
    expect(Object.keys(state.findings)).toEqual(["finding-1", "finding-2"]);
    expect(getReport).not.toHaveBeenCalled();
    await demoStore.update("demo", {
      findingId: "finding-2",
      status: "REVIEWED",
      note: "Demo note",
      revision: 0,
    });
    expect((await demoStore.get("demo")).revision).toBe(1);
  });
});
