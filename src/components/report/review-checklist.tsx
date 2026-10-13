"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ClipboardList,
  Copy,
  Download,
  LoaderCircle,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AnalysisReport, Finding } from "@/lib/types";
import {
  reviewStateSchema,
  reviewStatuses,
  type ReviewState,
  type ReviewStatus,
} from "@/lib/reports/review";
import { reviewMarkdown } from "@/lib/reports/markdown";

export const reviewLabels: Record<ReviewStatus, string> = {
  OPEN: "Needs review",
  NEEDS_FIX: "Needs fix",
  REVIEWED: "Reviewed",
  DISMISSED: "Dismissed",
};
type Draft = { status: ReviewStatus; note: string };

export function useReviewChecklist(report: AnalysisReport) {
  const [review, setReview] = useState<ReviewState | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const saving = useRef(false);
  const endpoint = `/api/reports/${encodeURIComponent(report.id)}/review`;

  function validateState(value: unknown) {
    const state = reviewStateSchema.parse(value);
    if (state.reportId !== report.id || state.headSha !== report.pr.headSha)
      throw new Error(
        "Review decisions belong to a different report revision. Reload this report.",
      );
    return state;
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "Saved review decisions could not be loaded. Retry to enable editing.",
          );
        const state = reviewStateSchema.parse(await response.json());
        if (state.reportId !== report.id || state.headSha !== report.pr.headSha)
          throw new Error(
            "Saved decisions do not match this report. Reload the page.",
          );
        if (!controller.signal.aborted) {
          setReview(state);
          setError("");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "Saved review decisions could not be loaded. Retry to enable editing.",
          );
      });
    return () => controller.abort();
  }, [endpoint, report.id, report.pr.headSha, attempt]);

  const draftFor = (id: string): Draft =>
    drafts[id] ?? review?.findings[id] ?? { status: "OPEN", note: "" };
  const isDirty = (id: string) => {
    const draft = draftFor(id);
    const saved = review?.findings[id];
    return (
      draft.status !== (saved?.status ?? "OPEN") ||
      draft.note !== (saved?.note ?? "")
    );
  };
  const dirtyCount = report.findings.filter((finding) =>
    isDirty(finding.id),
  ).length;

  function updateDraft(id: string, changes: Partial<Draft>) {
    const current = draftFor(id);
    setDrafts((previous) => ({
      ...previous,
      [id]: { ...current, ...changes },
    }));
  }

  async function save(id: string) {
    if (!review || saving.current) return;
    saving.current = true;
    setSavingId(id);
    setError("");
    try {
      const draft = draftFor(id);
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          findingId: id,
          status: draft.status,
          note: draft.note,
          revision: review.revision,
        }),
      });
      const body = await response.json();
      if (response.status === 409) {
        setReview(validateState(body.current));
        setError(
          "Another tab saved a decision. The latest saved review is loaded; your draft is kept. Check it before saving again.",
        );
        return;
      }
      if (!response.ok)
        throw new Error(
          "Your decision could not be saved. Your draft is kept; try again.",
        );
      setReview(validateState(body));
      setDrafts((previous) => {
        const remaining = { ...previous };
        delete remaining[id];
        return remaining;
      });
    } catch {
      setError(
        "Your decision could not be saved. Your draft is kept; try again.",
      );
    } finally {
      saving.current = false;
      setSavingId(null);
    }
  }

  // Native navigation gets the browser's standard unsaved-work protection.
  useEffect(() => {
    if (!dirtyCount) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyCount]);

  return {
    review,
    error,
    savingId,
    dirtyCount,
    draftFor,
    isDirty,
    updateDraft,
    save,
    retry: () => setAttempt((current) => current + 1),
  };
}

export type ReviewChecklist = ReturnType<typeof useReviewChecklist>;

export function ReviewOverview({
  report,
  checklist,
}: {
  report: AnalysisReport;
  checklist: ReviewChecklist;
}) {
  const { review, error, dirtyCount, savingId } = checklist;
  const [copyMessage, setCopyMessage] = useState("");
  const recorded = report.findings.filter(
    (finding) => (review?.findings[finding.id]?.status ?? "OPEN") !== "OPEN",
  ).length;
  const canExport = !!review && dirtyCount === 0 && !savingId;

  function downloadMarkdown() {
    if (!review) return;
    const url = URL.createObjectURL(
      new Blob([reviewMarkdown(report, review)], {
        type: "text/markdown;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `change-verifier-pr-${report.pr.number}-review.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyMarkdown() {
    if (!review) return;
    try {
      await navigator.clipboard.writeText(reviewMarkdown(report, review));
      setCopyMessage(
        "Review summary copied. Paste it into your PR when ready.",
      );
    } catch {
      setCopyMessage(
        "Clipboard is unavailable. Use Download Markdown to get the same summary.",
      );
    }
  }

  return (
    <section
      id="human-review"
      className="panel review-checklist"
      aria-labelledby="review-checklist-title"
    >
      <div className="review-checklist-heading">
        <div className="review-checklist-title">
          <span className="review-checklist-icon">
            <ClipboardList size={20} />
          </span>
          <div>
            <h2 id="review-checklist-title">Your review checklist</h2>
            <p>
              Turn findings into decisions. Notes are saved with this report.
            </p>
          </div>
        </div>
        <span className="mini-badge">HUMAN REVIEW</span>
      </div>
      {review ? (
        <>
          <div className="review-decision-counts">
            {reviewStatuses.map((status) => (
              <div
                key={status}
                className={`review-count review-${status.toLowerCase()}`}
              >
                <strong>
                  {
                    report.findings.filter(
                      (finding) =>
                        (review.findings[finding.id]?.status ?? "OPEN") ===
                        status,
                    ).length
                  }
                </strong>
                <span>{reviewLabels[status]}</span>
              </div>
            ))}
          </div>
          <div className="review-checklist-footer">
            <div>
              <strong>
                {recorded} of {report.findings.length} decisions recorded
              </strong>
              <p>Reviewer decisions do not change verification evidence.</p>
            </div>
            <div className="review-export-actions">
              <Button
                variant="outline"
                size="small"
                onClick={copyMarkdown}
                disabled={!canExport}
              >
                <Copy size={14} />
                Copy Markdown
              </Button>
              <Button
                variant="outline"
                size="small"
                onClick={downloadMarkdown}
                disabled={!canExport}
              >
                <Download size={14} />
                Download Markdown
              </Button>
            </div>
          </div>
          {dirtyCount > 0 && (
            <p className="review-unsaved" role="status">
              {dirtyCount} unsaved {dirtyCount === 1 ? "decision" : "decisions"}
              . Save each draft below to include it in your export.
            </p>
          )}
          {copyMessage && (
            <p className="review-copy-message" role="status">
              {copyMessage}
            </p>
          )}
        </>
      ) : !error ? (
        <p className="review-loading" role="status">
          <LoaderCircle size={15} className="spin" />
          Loading saved decisions…
        </p>
      ) : null}
      {error && (
        <div className="review-error" role="alert">
          <p>{error}</p>
          {!review && (
            <Button variant="outline" size="small" onClick={checklist.retry}>
              Retry loading review
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

export function FindingReview({
  finding,
  checklist,
}: {
  finding: Finding;
  checklist: ReviewChecklist;
}) {
  const draft = checklist.draftFor(finding.id);
  const dirty = checklist.isDirty(finding.id);
  const busy = checklist.savingId === finding.id;
  const disabled = !checklist.review || busy;
  const saved = checklist.review?.findings[finding.id];
  const statusId = `review-status-${finding.id}`;
  const noteId = `review-note-${finding.id}`;
  return (
    <div
      className="finding-review"
      aria-label={`Review decision for ${finding.title}`}
    >
      <div className="finding-review-header">
        <h4>
          <ClipboardList size={14} />
          YOUR DECISION
        </h4>
        <span className="review-save-status" aria-live="polite">
          {busy ? (
            "Saving…"
          ) : dirty ? (
            "Unsaved draft"
          ) : saved?.updatedAt ? (
            <>
              <Check size={12} />
              Saved
            </>
          ) : (
            "Not reviewed yet"
          )}
        </span>
      </div>
      <div className="finding-review-fields">
        <div>
          <label htmlFor={statusId}>Decision</label>
          <select
            id={statusId}
            value={draft.status}
            disabled={disabled}
            onChange={(event) =>
              checklist.updateDraft(finding.id, {
                status: event.target.value as ReviewStatus,
              })
            }
          >
            {reviewStatuses.map((status) => (
              <option value={status} key={status}>
                {reviewLabels[status]}
              </option>
            ))}
          </select>
        </div>
        <div className="review-note-field">
          <label htmlFor={noteId}>
            Reviewer note <span>optional</span>
          </label>
          <textarea
            id={noteId}
            maxLength={2000}
            rows={2}
            value={draft.note}
            disabled={disabled}
            placeholder="What did you check? What should happen next?"
            onChange={(event) =>
              checklist.updateDraft(finding.id, { note: event.target.value })
            }
          />
          <small>{draft.note.length}/2000</small>
        </div>
      </div>
      <div className="finding-review-footer">
        <p>
          {draft.status === "DISMISSED"
            ? "A note helps explain why this finding does not need action."
            : "Saved for this report and commit only."}
        </p>
        <Button
          size="small"
          variant="outline"
          disabled={!dirty || !checklist.review || !!checklist.savingId}
          onClick={() => checklist.save(finding.id)}
        >
          {busy ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Save size={14} />
          )}
          Save decision
        </Button>
      </div>
    </div>
  );
}
