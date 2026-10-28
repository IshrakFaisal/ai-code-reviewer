import { z } from "zod";
import {
  reviewReportIdSchema,
  reviewStatusSchema,
  type ReviewState,
} from "./review";
import { sameDecision, type ReviewDraft } from "./review-client";

const decision = z
  .object({ status: reviewStatusSchema, note: z.string().max(2000) })
  .strict();
const envelope = z
  .object({
    version: z.literal(1),
    reportId: reviewReportIdSchema,
    headSha: z.string().regex(/^[a-f0-9]{40}$/),
    updatedAt: z.number().finite(),
    entries: z
      .array(
        z
          .object({
            findingId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/),
            draft: decision,
            baseline: decision,
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export const draftRecoveryMaxAge = 24 * 60 * 60 * 1000;
const maxLength = 1000000;
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
type Subject = Pick<ReviewState, "reportId" | "headSha">;
export function reviewDraftKey(subject: Subject) {
  return `change-verifier:review-drafts:${subject.reportId}:${subject.headSha}`;
}
export type DraftRecovery = {
  drafts: Record<string, ReviewDraft>;
  conflicts: string[];
  notice: string;
};

/** Browser-local drafts never count as saved decisions or verification evidence. */
export function recoverReviewDrafts(
  storage: Storage,
  review: ReviewState,
  now = Date.now(),
): DraftRecovery {
  const empty: DraftRecovery = { drafts: {}, conflicts: [], notice: "" };
  const key = reviewDraftKey(review);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return {
      ...empty,
      notice:
        "Draft recovery is unavailable in this browser. Save before leaving this page.",
    };
  }
  if (!raw) return empty;
  try {
    if (raw.length > maxLength) throw new Error("Oversized draft");
    const value = envelope.parse(JSON.parse(raw));
    const age = now - value.updatedAt;
    if (
      value.reportId !== review.reportId ||
      value.headSha !== review.headSha ||
      age < -60000 ||
      age >= draftRecoveryMaxAge
    )
      throw new Error("Expired or mismatched draft");
    const seen = new Set<string>();
    const drafts: Record<string, ReviewDraft> = Object.create(null);
    const conflicts: string[] = [];
    for (const entry of value.entries) {
      if (seen.has(entry.findingId)) throw new Error("Duplicate draft");
      seen.add(entry.findingId);
      if (!Object.hasOwn(review.findings, entry.findingId)) continue;
      const saved = review.findings[entry.findingId];
      if (sameDecision(entry.draft, saved)) continue;
      drafts[entry.findingId] = entry.draft;
      if (!sameDecision(entry.baseline, saved)) conflicts.push(entry.findingId);
    }
    const count = Object.keys(drafts).length;
    let cleanupWarning = "";
    if (count !== value.entries.length) {
      try {
        if (!count) storage.removeItem(key);
        else
          storage.setItem(
            key,
            JSON.stringify({
              ...value,
              entries: value.entries.filter((entry) =>
                Object.hasOwn(drafts, entry.findingId),
              ),
            }),
          );
      } catch {
        cleanupWarning =
          " Local draft cleanup is unavailable; save before leaving this page.";
      }
    }
    return {
      drafts,
      conflicts,
      notice: count
        ? `Recovered ${count} unsaved ${count === 1 ? "draft" : "drafts"} from this browser tab.${conflicts.length ? " Saved decisions changed while you were away. Compare the saved versions before saving." : " Review and save when ready."}${cleanupWarning}`
        : cleanupWarning.trim(),
    };
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      /* Saving remains available even if storage is blocked. */
    }
    return {
      ...empty,
      notice:
        "An expired or unreadable local draft could not be restored. Saved decisions are unchanged.",
    };
  }
}

/** Write synchronously from edit/save/reset events so navigation cannot outrun an effect. */
export function persistReviewDrafts(
  storage: Storage,
  review: ReviewState,
  drafts: Record<string, ReviewDraft>,
  now = Date.now(),
) {
  try {
    const key = reviewDraftKey(review);
    let previous: z.infer<typeof envelope>["entries"] = [];
    const rawPrevious = storage.getItem(key);
    if (rawPrevious && rawPrevious.length <= maxLength) {
      try {
        const parsed = envelope.parse(JSON.parse(rawPrevious));
        if (
          parsed.reportId === review.reportId &&
          parsed.headSha === review.headSha &&
          now - parsed.updatedAt < draftRecoveryMaxAge &&
          now - parsed.updatedAt >= -60000
        )
          previous = parsed.entries;
      } catch {
        /* Replace invalid local data with the current edits. */
      }
    }
    const entries = Object.entries(drafts)
      .filter(
        ([id, draft]) =>
          Object.hasOwn(review.findings, id) &&
          !sameDecision(draft, review.findings[id]),
      )
      .map(([findingId, draft]) => ({
        findingId,
        draft: { status: draft.status, note: draft.note },
        baseline: previous.find((entry) => entry.findingId === findingId)
          ?.baseline ?? {
          status: review.findings[findingId].status,
          note: review.findings[findingId].note,
        },
      }));
    if (!entries.length) {
      storage.removeItem(key);
      return true;
    }
    const value = envelope.parse({
      version: 1,
      reportId: review.reportId,
      headSha: review.headSha,
      updatedAt: now,
      entries,
    });
    const raw = JSON.stringify(value);
    if (raw.length > maxLength) return false;
    storage.setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}
