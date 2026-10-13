import { randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  readFile,
  readdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/lib/config";
import {
  sampleHypotheses,
  samplePullRequest,
} from "@/lib/demo/sample-analysis";
import { getReport } from "@/lib/reports/store";
import {
  emptyReviewState,
  reviewReportIdSchema,
  reviewStateSchema,
  reviewUpdateSchema,
  type ReviewState,
  type ReviewSubject,
  type ReviewUpdate,
} from "@/lib/reports/review";

export class ReviewStoreError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export class ReviewConflictError extends ReviewStoreError {
  constructor(public readonly current: ReviewState) {
    super(
      "This review changed in another tab. Reload the saved decisions before retrying.",
      409,
    );
  }
}

function missing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function loadSubject(id: string): Promise<ReviewSubject | null> {
  if (id === "demo") {
    return {
      id,
      headSha: samplePullRequest().headSha,
      findingIds: sampleHypotheses
        .slice(0, getConfig().maxInvestigations)
        .map((_, index) => `finding-${index + 1}`),
    };
  }
  const report = await getReport(id);
  return (
    report && {
      id: report.id,
      headSha: report.pr.headSha,
      findingIds: report.findings.map((finding) => finding.id),
    }
  );
}

/** Local workspace persistence. Only the HTTP boundary exposes this server module. */
export class ReviewStore {
  constructor(
    private readonly directory = path.join(process.cwd(), ".data", "reviews"),
    private readonly findSubject: (
      id: string,
    ) => Promise<ReviewSubject | null> = loadSubject,
  ) {}

  private async subject(id: string) {
    if (!reviewReportIdSchema.safeParse(id).success)
      throw new ReviewStoreError("Invalid report ID.", 400);
    const subject = await this.findSubject(id);
    if (!subject) throw new ReviewStoreError("Report not found.", 404);
    if (
      subject.id !== id ||
      !reviewStateSchema.safeParse(emptyReviewState(subject)).success
    )
      throw new ReviewStoreError("This report cannot be reviewed.", 500);
    return subject;
  }

  private async read(subject: ReviewSubject): Promise<ReviewState> {
    const directory = path.join(this.directory, subject.id);
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if (missing(error)) return emptyReviewState(subject);
      throw error;
    }
    const revision = names.reduce((latest, name) => {
      if (!/^[1-9][0-9]*\.json$/.test(name)) return latest;
      const value = Number(name.slice(0, -5));
      return Number.isSafeInteger(value) ? Math.max(latest, value) : latest;
    }, 0);
    if (!revision) return emptyReviewState(subject);
    let state: ReviewState;
    try {
      state = reviewStateSchema.parse(
        JSON.parse(
          await readFile(path.join(directory, `${revision}.json`), "utf8"),
        ),
      );
    } catch {
      throw new ReviewStoreError(
        "Saved review could not be read. No changes were made.",
        500,
      );
    }
    if (state.reportId !== subject.id || state.revision !== revision)
      throw new ReviewStoreError(
        "Saved review has an invalid identity. No changes were made.",
        500,
      );
    if (state.headSha !== subject.headSha)
      throw new ReviewStoreError(
        "Saved review belongs to a different commit. Create a new analysis to review this revision.",
        409,
      );
    // The canonical demo can expose fewer findings after MAX_INVESTIGATIONS changes.
    // Never apply a decision to a finding that is absent from the current report.
    return {
      ...state,
      findings: Object.fromEntries(
        subject.findingIds.map((id) => [
          id,
          Object.hasOwn(state.findings, id)
            ? state.findings[id]
            : { status: "OPEN", note: "", updatedAt: null },
        ]),
      ),
    };
  }

  async get(id: string) {
    return this.read(await this.subject(id));
  }

  async update(id: string, input: ReviewUpdate): Promise<ReviewState> {
    const parsed = reviewUpdateSchema.safeParse(input);
    if (!parsed.success)
      throw new ReviewStoreError(
        "Invalid review decision. Notes must be at most 2,000 characters.",
        400,
      );
    const update = parsed.data;
    const subject = await this.subject(id);
    if (!subject.findingIds.includes(update.findingId))
      throw new ReviewStoreError(
        "Finding does not belong to this report.",
        400,
      );
    const current = await this.read(subject);
    if (current.revision !== update.revision)
      throw new ReviewConflictError(current);
    const updatedAt = new Date().toISOString();
    const next: ReviewState = {
      ...current,
      revision: current.revision + 1,
      updatedAt,
      findings: {
        ...current.findings,
        [update.findingId]: {
          status: update.status,
          note: update.note,
          updatedAt,
        },
      },
    };
    const directory = path.join(this.directory, id);
    await mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(next), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      // Publish a complete file without overwriting an existing revision. Linking
      // provides an atomic compare-and-swap across processes, including Windows.
      await link(temporary, path.join(directory, `${next.revision}.json`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new ReviewConflictError(await this.read(subject));
      throw error;
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return next;
  }
}

export const reviewStore = new ReviewStore();
