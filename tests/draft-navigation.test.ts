import { describe, expect, it } from "vitest";
import {
  createDraftStorage,
  leavesReviewPage,
} from "@/lib/reports/draft-navigation";
import { emptyReviewState } from "@/lib/reports/review";
import {
  persistReviewDrafts,
  recoverReviewDrafts,
  reviewDraftKey,
} from "@/lib/reports/review-drafts";

const current = "http://localhost/report/demo#finding-1";
describe("review navigation destinations", () => {
  it("protects destinations that unmount the report", () => {
    for (const href of [
      "/history",
      "/",
      "/report/demo/compare",
      "/report/demo/reproduce/finding-1",
      "/report/another",
      "https://github.com/example/repo",
    ])
      expect(leavesReviewPage(href, current)).toBe(true);
  });
  it("allows same-report anchors and view parameters", () => {
    for (const href of [
      "#human-review",
      "#",
      "/report/demo",
      "/report/demo?file=auth#finding-2",
    ])
      expect(leavesReviewPage(href, current)).toBe(false);
  });
});

function state() {
  return emptyReviewState({
    id: "demo",
    headSha: "b".repeat(40),
    findingIds: ["finding-1", "finding-2"],
  });
}
function browserStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
const drafts = {
  "finding-1": { status: "NEEDS_FIX" as const, note: "Keep my decision" },
};
describe("draft memory fallback", () => {
  it("retains edits when accessing sessionStorage itself throws", () => {
    const storage = createDraftStorage(() => {
      throw new Error("Storage blocked");
    });
    const review = state();
    expect(persistReviewDrafts(storage, review, drafts)).toBe(false);
    expect(storage.isVolatile(reviewDraftKey(review))).toBe(true);
    expect(storage.hasVolatileDrafts()).toBe(true);
    expect(recoverReviewDrafts(storage, review).drafts).toEqual(drafts);
    expect(
      recoverReviewDrafts(storage, { ...review, headSha: "c".repeat(40) })
        .drafts,
    ).toEqual({});
  });
  it("recovers the newest edit after a storage write failure and detects changed saved decisions", () => {
    const browser = browserStorage(),
      review = state();
    persistReviewDrafts(browser, review, drafts);
    const storage = createDraftStorage(() => browser);
    recoverReviewDrafts(storage, review);
    browser.setItem = () => {
      throw new Error("Full storage");
    };
    const edited = {
      "finding-1": { ...drafts["finding-1"], note: "Newer decision" },
    };
    expect(persistReviewDrafts(storage, review, edited)).toBe(false);
    review.findings["finding-1"].note = "Another tab's change";
    expect(recoverReviewDrafts(storage, review)).toMatchObject({
      drafts: edited,
      conflicts: ["finding-1"],
    });
  });
  it("does not resurrect stale browser drafts after reset/discard when removal fails", () => {
    const browser = browserStorage(),
      review = state();
    persistReviewDrafts(browser, review, drafts);
    const storage = createDraftStorage(() => browser);
    recoverReviewDrafts(storage, review);
    browser.removeItem = () => {
      throw new Error("Blocked");
    };
    expect(persistReviewDrafts(storage, review, {})).toBe(false);
    expect(recoverReviewDrafts(storage, review).drafts).toEqual({});
    expect(storage.hasVolatileDrafts()).toBe(false);
  });
  it("clears acknowledged saves while preserving remaining drafts after a partial save", () => {
    const storage = createDraftStorage(() => {
        throw new Error("Blocked");
      }),
      review = state();
    const remaining = {
      "finding-2": { status: "OPEN" as const, note: "Keep second" },
    };
    persistReviewDrafts(storage, review, { ...drafts, ...remaining });
    review.findings["finding-1"] = {
      ...drafts["finding-1"],
      updatedAt: new Date().toISOString(),
    };
    persistReviewDrafts(storage, review, remaining);
    expect(recoverReviewDrafts(storage, review).drafts).toEqual(remaining);
    expect(storage.hasVolatileDrafts()).toBe(true);
    persistReviewDrafts(storage, review, {});
    expect(storage.hasVolatileDrafts()).toBe(false);
  });
  it("removes the volatile warning when persistence succeeds again and isolates tabs", () => {
    const browser = browserStorage();
    let blocked = true;
    const storage = createDraftStorage(() => {
      if (blocked) throw new Error("Blocked");
      return browser;
    });
    const review = state();
    persistReviewDrafts(storage, review, drafts);
    expect(
      recoverReviewDrafts(createDraftStorage(browserStorage), review).drafts,
    ).toEqual({});
    blocked = false;
    expect(persistReviewDrafts(storage, review, drafts)).toBe(true);
    expect(storage.hasVolatileDrafts()).toBe(false);
    expect(recoverReviewDrafts(browser, review).drafts).toEqual(drafts);
  });
});
