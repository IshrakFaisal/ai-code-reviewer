import { randomUUID } from "node:crypto";
import { investigate } from "./investigator";
import {
  RepositoryAccessError,
  type PrivateRepositoryAccess,
} from "@/lib/github/access";
import { saveReport } from "@/lib/reports/store";
import { analysisRunStore } from "./run-store";
import { summarizeRun, type UnfinishedRuns } from "./run-summary";
import {
  runIdSchema,
  runSnapshotSchema,
  type RunRecord,
  type RunSnapshot,
} from "./run-schema";

export class RunError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
type Input = Parameters<typeof investigate>[0];
type Job = {
  record: RunRecord;
  controller: AbortController;
  done: Promise<void>;
};
export class AnalysisRuns {
  private active = new Map<string, Job>();
  private mutations: Promise<unknown> = Promise.resolve();
  constructor(
    private store = analysisRunStore(),
    private execute = investigate,
    private save = saveReport,
    private deadlineMs = 280000,
  ) {}
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(work);
    this.mutations = result.catch(() => {});
    return result;
  }
  private snapshot(record: RunRecord): RunSnapshot {
    return runSnapshotSchema.parse(record);
  }
  async listUnfinishedRuns(): Promise<UnfinishedRuns> {
    const result: UnfinishedRuns = { runs: [], unreadable: [] };
    const observedJobs = new Map(this.active);
    for (const { name, regular } of await this.store.filenames()) {
      const id = name.slice(0, -5);
      if (!regular || !runIdSchema.safeParse(id).success) {
        result.unreadable.push(name);
        continue;
      }
      let record;
      try {
        record = await this.store.get(id);
      } catch {
        result.unreadable.push(name);
        continue;
      }
      if (!record) continue;
      const job = this.active.get(id);
      if (job) observedJobs.set(id, job);
      if (observedJobs.has(id)) continue;
      const summary = summarizeRun(record, false);
      if (summary) result.runs.push(summary);
    }
    // Read each observed job's final in-memory state after the disk scan.
    for (const [id, job] of this.active) observedJobs.set(id, job);
    result.runs = result.runs.filter((run) => !observedJobs.has(run.runId));
    for (const [id, job] of observedJobs) {
      const summary = summarizeRun(job.record, this.active.has(id));
      if (summary) result.runs.push(summary);
    }
    result.runs.sort(
      (a, b) =>
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
        a.runId.localeCompare(b.runId),
    );
    result.runs = result.runs.slice(0, 100);
    result.unreadable.sort();
    return result;
  }
  discard(id: string) {
    return this.exclusive(async () => {
      if (!runIdSchema.safeParse(id).success)
        throw new RunError("Invalid analysis ID.", 400);
      if (this.active.has(id))
        throw new RunError(
          "Pause the running analysis before discarding it.",
          409,
        );
      if (!(await this.store.discard(id)))
        throw new RunError("Analysis not found.", 404);
    });
  }
  async get(id: string) {
    if (!runIdSchema.safeParse(id).success)
      throw new RunError("Invalid analysis ID.", 400);
    const active = this.active.get(id);
    const record = active?.record ?? (await this.store.get(id));
    if (!record) throw new RunError("Analysis not found.", 404);
    if (!active && record.status === "RUNNING")
      return this.snapshot({
        ...record,
        status: "INTERRUPTED",
        error:
          "The server stopped before this run completed. Resume from the last saved checkpoint.",
      });
    return this.snapshot(record);
  }
  start(
    input: Input,
    id: string = randomUUID(),
    options: { resume?: boolean; privateAccess?: PrivateRepositoryAccess } = {},
  ) {
    const { resume, privateAccess } = options;
    return this.exclusive(async () => {
      runIdSchema.parse(id);
      const running = this.active.get(id);
      let record = running?.record ?? (await this.store.get(id));
      if (resume && !record) throw new RunError("Analysis not found.", 404);
      if (
        record &&
        (record.input.input !== input.input ||
          record.input.prNumber !== input.prNumber ||
          !!record.input.demo !== !!input.demo)
      )
        throw new RunError(
          "This analysis ID belongs to a different request.",
          409,
        );
      if (running)
        return { snapshot: this.snapshot(running.record), done: running.done };
      if (record && (!resume || record.status === "COMPLETE"))
        return { snapshot: await this.get(id), done: Promise.resolve() };
      if (this.active.size >= 2)
        throw new RunError(
          "Two analyses are already running. Try again shortly.",
          429,
        );
      const now = new Date().toISOString();
      record = record
        ? {
            ...record,
            status: "RUNNING",
            attempt: record.attempt + 1,
            error: "",
            updatedAt: now,
          }
        : {
            version: 1,
            id,
            input,
            status: "RUNNING",
            attempt: 1,
            createdAt: now,
            updatedAt: now,
            events: [],
            error: "",
            checkpoint: { values: {}, events: [] },
          };
      await this.store.save(record);
      const job: Job = {
        record,
        controller: new AbortController(),
        done: Promise.resolve(),
      };
      this.active.set(id, job);
      job.done = this.work(job, privateAccess);
      return { snapshot: this.snapshot(record), done: job.done };
    });
  }
  async resume(id: string) {
    const record = await this.get(id);
    return this.start(record.input, id, { resume: true });
  }
  async pause(id: string) {
    await this.get(id);
    this.active
      .get(id)
      ?.controller.abort(new Error("Analysis paused by the reviewer."));
    return this.get(id);
  }
  private async work(job: Job, privateAccess?: PrivateRepositoryAccess) {
    const signal = AbortSignal.any([
      job.controller.signal,
      AbortSignal.timeout(this.deadlineMs),
    ]);
    const persist = async (next: RunRecord) => {
      await this.store.save(next);
      job.record = next;
    };
    try {
      const report = await this.execute(
        job.record.input,
        () => {},
        signal,
        {
          id: job.record.id,
          checkpoint: job.record.checkpoint,
          persist: async (checkpoint) => {
            signal.throwIfAborted();
            await persist({
              ...job.record,
              checkpoint,
              events: checkpoint.events,
              updatedAt: new Date().toISOString(),
            });
          },
        },
        privateAccess,
      );
      signal.throwIfAborted();
      if (report.id !== job.record.id)
        throw new Error("Analysis result identity does not match its run.");
      await this.save(report);
      await persist({
        ...job.record,
        status: "COMPLETE",
        reportId: report.id,
        updatedAt: new Date().toISOString(),
        error: "",
      });
    } catch (error) {
      const failed: RunRecord = {
        ...job.record,
        status: job.controller.signal.aborted ? "PAUSED" : "INTERRUPTED",
        updatedAt: new Date().toISOString(),
        error: job.controller.signal.aborted
          ? "Analysis paused. Resume to continue from the last saved checkpoint."
          : signal.aborted
            ? "This attempt reached its time limit. Resume from the last saved checkpoint."
            : privateAccess && !(error instanceof RepositoryAccessError)
              ? "Analysis failed."
              : (error instanceof Error
                  ? error.message
                  : "Analysis failed."
                ).slice(0, 5000),
      };
      job.record = failed;
      await this.store.save(failed).catch(() => {});
    } finally {
      this.active.delete(job.record.id);
    }
  }
}
// This app runs on one Node process with a persistent local disk. No distributed-worker claim.
const host = globalThis as typeof globalThis & { analysisRuns?: AnalysisRuns };
export const analysisRuns = (host.analysisRuns ??= new AnalysisRuns());
