import {
  reviewStateSchema,
  type ReviewState,
  type ReviewStatus,
} from "./review";

export type ReviewDraft = { status: ReviewStatus; note: string };
export type PendingDecision = { findingId: string; draft: ReviewDraft };
export const reviewRequestTimeout = 15000;

export function sameDecision(a: ReviewDraft, b: ReviewDraft) {
  return a.status === b.status && a.note === b.note;
}

function validateState(
  value: unknown,
  subject: Pick<ReviewState, "reportId" | "headSha">,
) {
  const state = reviewStateSchema.parse(value);
  if (state.reportId !== subject.reportId || state.headSha !== subject.headSha)
    throw new Error(
      "Saved decisions do not match this report revision. Reload the report before saving.",
    );
  return state;
}

export class ReviewSaveConflict extends Error {
  constructor(public readonly current: ReviewState) {
    super(
      "Another tab saved a decision. Latest saved decisions are loaded; remaining drafts are kept. Compare them before saving again.",
    );
  }
}

export async function loadReview(
  subject: Pick<ReviewState, "reportId" | "headSha">,
  signal: AbortSignal,
) {
  const response = await fetch(
    `/api/reports/${encodeURIComponent(subject.reportId)}/review`,
    {
      cache: "no-store",
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(reviewRequestTimeout),
      ]),
    },
  );
  if (!response.ok) throw new Error("Saved decisions could not be loaded.");
  const state = validateState(await response.json(), subject);
  signal.throwIfAborted();
  return state;
}

/** Sequential compare-and-swap saves; stop on the first uncertain or conflicting response. */
export async function saveReviewDrafts({
  review,
  pending,
  signal,
  onStart,
  onSaved,
}: {
  review: ReviewState;
  pending: PendingDecision[];
  signal: AbortSignal;
  onStart: (findingId: string, index: number) => void;
  onSaved: (state: ReviewState, decision: PendingDecision) => void;
}) {
  let current = review;
  for (const [index, decision] of pending.entries()) {
    signal.throwIfAborted();
    if (!Object.hasOwn(current.findings, decision.findingId))
      throw new Error("This finding is not available in the saved review.");
    onStart(decision.findingId, index);
    const response = await fetch(
      `/api/reports/${encodeURIComponent(current.reportId)}/review`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          findingId: decision.findingId,
          status: decision.draft.status,
          note: decision.draft.note,
          revision: current.revision,
        }),
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(reviewRequestTimeout),
        ]),
      },
    );
    if (response.status === 409) {
      const body = await response.json();
      signal.throwIfAborted();
      throw new ReviewSaveConflict(validateState(body.current, current));
    }
    if (!response.ok)
      throw new Error("The server could not save this decision.");
    const next = validateState(await response.json(), current);
    signal.throwIfAborted();
    const saved = Object.hasOwn(next.findings, decision.findingId)
      ? next.findings[decision.findingId]
      : undefined;
    if (
      next.revision !== current.revision + 1 ||
      !saved ||
      !sameDecision(saved, decision.draft)
    )
      throw new Error("The server did not confirm the submitted decision.");
    current = next;
    onSaved(current, decision);
  }
  return current;
}

/** Only remove the acknowledged draft, never a newer edit made while saving. */
export function acknowledgeDraft(
  drafts: Record<string, ReviewDraft>,
  decision: PendingDecision,
) {
  if (
    !Object.hasOwn(drafts, decision.findingId) ||
    !sameDecision(drafts[decision.findingId], decision.draft)
  )
    return drafts;
  const remaining = { ...drafts };
  delete remaining[decision.findingId];
  return remaining;
}
