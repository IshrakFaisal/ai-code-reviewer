import { describe, expect, it } from "vitest";
import { emptyReviewState } from "@/lib/reports/review";
import {
  draftRecoveryMaxAge,
  persistReviewDrafts,
  recoverReviewDrafts,
  reviewDraftKey,
} from "@/lib/reports/review-drafts";
import type { ReviewDraft } from "@/lib/reports/review-client";

const now = Date.parse("2026-10-27T12:00:00Z");
const draft: ReviewDraft = {
  status: "NEEDS_FIX",
  note: "Inspect token reuse\nKeep this note",
};
function state() {
  return emptyReviewState({
    id: "demo",
    headSha: "b".repeat(40),
    findingIds: ["finding-1", "finding-2"],
  });
}
function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

describe("browser-tab draft recovery", () => {
  it("stores edits derived from saved decisions without server metadata", () => {
    const storage = memory(),
      review = state();
    const edited = { ...review.findings["finding-1"], note: "Browser edit" };
    expect(
      persistReviewDrafts(storage, review, { "finding-1": edited }, now),
    ).toBe(true);
    expect(
      recoverReviewDrafts(storage, review, now).drafts["finding-1"],
    ).toEqual({ status: "OPEN", note: "Browser edit" });
  });
  it("recovers multiline drafts without changing saved decisions", () => {
    const storage = memory(),
      review = state();
    expect(
      persistReviewDrafts(storage, review, { "finding-1": draft }, now),
    ).toBe(true);
    expect(recoverReviewDrafts(storage, review, now + 1000)).toMatchObject({
      drafts: { "finding-1": draft },
      conflicts: [],
    });
    expect(review.findings["finding-1"].status).toBe("OPEN");
    expect(recoverReviewDrafts(storage, review, now).notice).toContain(
      "Recovered 1 unsaved draft",
    );
  });
  it("isolates reports, commits, and separate browser-tab storage", () => {
    const storage = memory(),
      review = state();
    persistReviewDrafts(storage, review, { "finding-1": draft }, now);
    for (const other of [
      { ...review, reportId: "11111111-1111-4111-8111-111111111111" },
      { ...review, headSha: "c".repeat(40) },
    ])
      expect(recoverReviewDrafts(storage, other, now).drafts).toEqual({});
    expect(recoverReviewDrafts(memory(), review, now).drafts).toEqual({});
  });
  it("detects changes to the saved note or status while keeping the recovered draft", () => {
    const storage = memory(),
      review = state();
    persistReviewDrafts(storage, review, { "finding-1": draft }, now);
    review.findings["finding-1"].note = "Another tab checked this";
    const result = recoverReviewDrafts(storage, review, now);
    expect(result.conflicts).toEqual(["finding-1"]);
    expect(result.drafts["finding-1"]).toEqual(draft);
    expect(result.notice).toContain("Compare the saved versions");
  });
  it("retains the original baseline when editing another draft or saving part of the queue", () => {
    const storage = memory(),
      review = state();
    persistReviewDrafts(storage, review, { "finding-1": draft }, now);
    review.findings["finding-1"].status = "DISMISSED";
    const drafts = {
      "finding-1": draft,
      "finding-2": { status: "REVIEWED" as const, note: "second" },
    };
    persistReviewDrafts(storage, review, drafts, now + 1000);
    expect(recoverReviewDrafts(storage, review, now + 1000).conflicts).toEqual([
      "finding-1",
    ]);
    review.findings["finding-2"] = { ...drafts["finding-2"], updatedAt: null };
    persistReviewDrafts(storage, review, drafts, now + 2000);
    expect(recoverReviewDrafts(storage, review, now + 2000)).toMatchObject({
      drafts: { "finding-1": draft },
      conflicts: ["finding-1"],
    });
  });
  it("clears confirmed saves and reset drafts so they cannot return on reload", () => {
    const storage = memory(),
      review = state();
    persistReviewDrafts(storage, review, { "finding-1": draft }, now);
    review.findings["finding-1"] = { ...draft, updatedAt: null };
    expect(recoverReviewDrafts(storage, review, now).drafts).toEqual({});
    expect(storage.getItem(reviewDraftKey(review))).toBeNull();
    persistReviewDrafts(storage, review, { "finding-2": draft }, now);
    persistReviewDrafts(storage, review, {}, now);
    expect(storage.getItem(reviewDraftKey(review))).toBeNull();
  });
  it("uses a fresh baseline when a confirmed finding is edited again", () => {
    const storage = memory(),
      review = state();
    persistReviewDrafts(storage, review, { "finding-1": draft }, now);
    review.findings["finding-1"] = { ...draft, updatedAt: null };
    recoverReviewDrafts(storage, review, now);
    persistReviewDrafts(
      storage,
      review,
      { "finding-1": { ...draft, note: "Follow-up" } },
      now + 1000,
    );
    expect(recoverReviewDrafts(storage, review, now + 1000).conflicts).toEqual(
      [],
    );
  });
  it("expires drafts after 24 hours and rejects future clock skew", () => {
    for (const at of [now + draftRecoveryMaxAge, now - 60001]) {
      const storage = memory(),
        review = state();
      persistReviewDrafts(storage, review, { "finding-1": draft }, now);
      expect(recoverReviewDrafts(storage, review, at).notice).toContain(
        "expired or unreadable",
      );
      expect(storage.getItem(reviewDraftKey(review))).toBeNull();
    }
  });
  it("drops findings no longer included in the loaded report", () => {
    const storage = memory(),
      review = state();
    persistReviewDrafts(
      storage,
      review,
      { "finding-1": draft, "finding-2": draft },
      now,
    );
    delete review.findings["finding-1"];
    expect(recoverReviewDrafts(storage, review, now).drafts).toEqual({
      "finding-2": draft,
    });
    expect(storage.getItem(reviewDraftKey(review))).not.toContain("finding-1");
  });
  it.each([
    "json",
    "oversized",
    "version",
    "scope",
    "duplicate",
    "status",
    "long-note",
  ])("rejects %s recovery data without applying it", (kind) => {
    const storage = memory(),
      review = state();
    persistReviewDrafts(storage, review, { "finding-1": draft }, now);
    const key = reviewDraftKey(review);
    const value = JSON.parse(storage.getItem(key)!);
    if (kind === "version") value.version = 99;
    if (kind === "scope") value.headSha = "d".repeat(40);
    if (kind === "duplicate") value.entries.push(value.entries[0]);
    if (kind === "status") value.entries[0].draft.status = "APPROVED";
    if (kind === "long-note") value.entries[0].draft.note = "x".repeat(2001);
    storage.setItem(
      key,
      kind === "json"
        ? "{"
        : kind === "oversized"
          ? "x".repeat(1000001)
          : JSON.stringify(value),
    );
    expect(recoverReviewDrafts(storage, review, now).drafts).toEqual({});
    expect(storage.getItem(key)).toBeNull();
  });
  it("gracefully handles denied access, quota failures, and failed cleanup", () => {
    const denied = {
      getItem: () => {
        throw new Error("Denied");
      },
      setItem: () => {
        throw new Error("Quota");
      },
      removeItem: () => {
        throw new Error("Denied");
      },
    };
    expect(recoverReviewDrafts(denied, state(), now).notice).toContain(
      "unavailable",
    );
    expect(
      persistReviewDrafts(denied, state(), { "finding-1": draft }, now),
    ).toBe(false);
    const storage = memory(),
      review = state();
    persistReviewDrafts(storage, review, { "finding-1": draft }, now);
    review.findings["finding-1"] = { ...draft, updatedAt: null };
    expect(
      recoverReviewDrafts(
        { ...storage, removeItem: denied.removeItem },
        review,
        now,
      ).notice,
    ).toContain("cleanup is unavailable");
  });
});
