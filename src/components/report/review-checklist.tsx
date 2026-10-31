"use client";
import { ReportTargetLink } from "./report-target-link";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Check,
  ClipboardList,
  Copy,
  Download,
  LoaderCircle,
  Save,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AnalysisReport, Finding } from "@/lib/types";
import {
  reviewStatuses,
  type ReviewState,
  type ReviewStatus,
} from "@/lib/reports/review";
import { reviewMarkdown } from "@/lib/reports/markdown";
import {
  acknowledgeDraft,
  loadReview,
  ReviewSaveConflict,
  saveReviewDrafts,
  type ReviewDraft as Draft,
} from "@/lib/reports/review-client";
import {
  persistReviewDrafts,
  recoverReviewDrafts,
  reviewDraftKey,
} from "@/lib/reports/review-drafts";
import { useDraftNavigation } from "./draft-navigation";
import { openReportTarget } from "./open-report-target";

export const reviewLabels: Record<ReviewStatus, string> = {
  OPEN: "Needs review",
  NEEDS_FIX: "Needs fix",
  REVIEWED: "Reviewed",
  DISMISSED: "Dismissed",
};

export function useReviewChecklist(report: AnalysisReport) {
  const { storage, register } = useDraftNavigation();
  const [review, setReview] = useState<ReviewState | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saveMessage, setSaveMessage] = useState("");
  const [failedId, setFailedId] = useState<string | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState("");
  const [recoveryConflicts, setRecoveryConflicts] = useState<string[]>([]);
  const [storageWarning, setStorageWarning] = useState("");
  const draftsRef = useRef<Record<string, Draft>>({});
  const saving = useRef(false);
  const saveController = useRef<AbortController | null>(null);
  useEffect(() => () => saveController.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    loadReview(
      { reportId: report.id, headSha: report.pr.headSha },
      controller.signal,
    )
      .then((state) => {
        if (!controller.signal.aborted) {
          try {
            const recovered = recoverReviewDrafts(storage, state);
            draftsRef.current = recovered.drafts;
            setDrafts(recovered.drafts);
            setRecoveryNotice(recovered.notice);
            setRecoveryConflicts(recovered.conflicts);
            if (storage.isVolatile(reviewDraftKey(state)))
              setStorageWarning(
                "Drafts are kept in memory while this app stays open. Save before refreshing or closing this tab.",
              );
          } catch {
            setStorageWarning(
              "Draft recovery is unavailable in this browser. Save before leaving this page.",
            );
          }
          setReview(state);
          setError("");
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error && failure.name === "TimeoutError"
              ? "Loading saved decisions timed out. Retry when the server is available."
              : "Saved review decisions could not be loaded. Retry to enable editing.",
          );
      });
    return () => controller.abort();
  }, [report.id, report.pr.headSha, attempt, storage]);

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
  const firstDirtyId = report.findings.find((finding) =>
    isDirty(finding.id),
  )?.id;

  function replaceDrafts(next: Record<string, Draft>, saved = review) {
    draftsRef.current = next;
    setDrafts(next);
    if (!saved) return;
    try {
      if (!persistReviewDrafts(storage, saved, next))
        throw new Error("Storage unavailable");
      setStorageWarning("");
    } catch {
      setStorageWarning(
        "Draft recovery could not be updated. Keep this page open and save your decisions before leaving.",
      );
    }
  }

  function updateDraft(id: string, changes: Partial<Draft>) {
    if (saving.current) return;
    setSaveMessage("");
    const current = draftsRef.current[id] ?? draftFor(id);
    replaceDrafts({
      ...draftsRef.current,
      [id]: { ...current, ...changes },
    });
  }

  function resetDraft(id: string) {
    if (saving.current) return;
    const remaining = { ...draftsRef.current };
    delete remaining[id];
    replaceDrafts(remaining);
    setRecoveryConflicts((current) => current.filter((entry) => entry !== id));
    setRecoveryNotice("");
    setSaveMessage("Draft reset to the latest loaded saved decision.");
    if (failedId === id) {
      setFailedId(null);
      setError("");
    }
  }

  async function save(ids: string[]) {
    if (!review || saving.current) return false;
    const pending = ids
      .filter(isDirty)
      .map((findingId) => ({ findingId, draft: { ...draftFor(findingId) } }));
    if (!pending.length) return true;
    saving.current = true;
    setError("");
    setFailedId(null);
    setRecoveryNotice("");
    const controller = new AbortController();
    saveController.current = controller;
    let savedCount = 0;
    let currentId = pending[0].findingId;
    try {
      await saveReviewDrafts({
        review,
        pending,
        signal: controller.signal,
        onStart: (id, index) => {
          currentId = id;
          setSavingId(id);
          setSaveMessage(`Saving draft ${index + 1} of ${pending.length}…`);
        },
        onSaved: (state, decision) => {
          savedCount++;
          setReview(state);
          replaceDrafts(acknowledgeDraft(draftsRef.current, decision), state);
          setRecoveryConflicts((current) =>
            current.filter((id) => id !== decision.findingId),
          );
        },
      });
      setSaveMessage(
        `${savedCount} ${savedCount === 1 ? "draft saved" : "drafts saved"}. Your action plan and exports are updated.`,
      );
      return true;
    } catch (failure) {
      if (controller.signal.aborted) return false;
      setFailedId(currentId);
      setSaveMessage(
        `${savedCount} of ${pending.length} drafts confirmed saved before saving stopped.`,
      );
      if (failure instanceof ReviewSaveConflict) {
        setReview(failure.current);
        replaceDrafts(draftsRef.current, failure.current);
        setError(failure.message);
      } else {
        setError(
          "Saving could not be confirmed. Remaining drafts are kept. Retry to check for a conflicting save before making further changes.",
        );
      }
      return false;
    } finally {
      saving.current = false;
      if (!controller.signal.aborted) setSavingId(null);
    }
  }

  useLayoutEffect(() =>
    register({
      dirtyCount,
      busy: !!savingId,
      storageWarning,
      save: () => save(report.findings.map((finding) => finding.id)),
      discard: () => {
        if (saving.current) return;
        replaceDrafts({});
        setRecoveryConflicts([]);
        setRecoveryNotice("");
      },
    }),
  );

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
    saveMessage,
    failedId,
    firstDirtyId,
    recoveryNotice,
    recoveryConflicts,
    storageWarning,
    draftFor,
    isDirty,
    updateDraft,
    save: (id: string) => save([id]),
    saveAll: () => save(report.findings.map((finding) => finding.id)),
    resetDraft,
    retry: () => setAttempt((current) => current + 1),
  };
}

export type ReviewChecklist = ReturnType<typeof useReviewChecklist>;

export function ReviewDraftActions({
  checklist,
  onOpenFinding,
}: {
  checklist: ReviewChecklist;
  onOpenFinding: () => void;
}) {
  return (
    <div className="review-draft-actions">
      {checklist.dirtyCount > 0 && (
        <Button
          variant="outline"
          size="small"
          disabled={!checklist.review || !!checklist.savingId}
          onClick={checklist.saveAll}
        >
          {checklist.savingId ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Save size={14} />
          )}
          Save all drafts ({checklist.dirtyCount})
        </Button>
      )}
      {checklist.firstDirtyId && (
        <ReportTargetLink
          className="text-link"
          href={`#${checklist.firstDirtyId}`}
          onClick={() => {
            onOpenFinding();
            openReportTarget(`#${checklist.firstDirtyId}`);
          }}
        >
          Review unsaved drafts
        </ReportTargetLink>
      )}
      <span role="status">
        {checklist.saveMessage ||
          (checklist.dirtyCount
            ? `${checklist.dirtyCount} unsaved ${checklist.dirtyCount === 1 ? "draft" : "drafts"}. Save to update the plan and exports.`
            : "")}
      </span>
      {checklist.recoveryNotice && (
        <p className="review-recovery-notice" role="status">
          {checklist.recoveryNotice}
        </p>
      )}
      {checklist.storageWarning && (
        <p className="review-recovery-notice" role="alert">
          {checklist.storageWarning}
        </p>
      )}
    </div>
  );
}

export function ReviewOverview({
  report,
  checklist,
  onOpenFinding,
}: {
  report: AnalysisReport;
  checklist: ReviewChecklist;
  onOpenFinding: () => void;
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
          <ReviewDraftActions
            checklist={checklist}
            onOpenFinding={onOpenFinding}
          />
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
  const disabled = !checklist.review || !!checklist.savingId;
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
        <div className="finding-review-actions">
          {dirty && (
            <Button
              size="small"
              variant="ghost"
              disabled={disabled}
              onClick={() => checklist.resetDraft(finding.id)}
            >
              <Undo2 size={14} /> Reset draft
            </Button>
          )}
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
      {((checklist.failedId === finding.id && checklist.error) ||
        checklist.recoveryConflicts.includes(finding.id)) && (
        <div className="review-save-conflict" role="alert">
          <p>
            {checklist.failedId === finding.id && checklist.error
              ? checklist.error
              : "This draft was recovered, but the saved decision changed while you were away. Compare both versions before saving."}
          </p>
          {saved && (
            <details>
              <summary>Compare with latest loaded saved decision</summary>
              <p>
                <strong>{reviewLabels[saved.status]}</strong>
              </p>
              <p className="review-saved-note">
                {saved.note || "No saved note."}
              </p>
              <p>
                Your draft is still in the fields above. Reset draft uses this
                saved version.
              </p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
