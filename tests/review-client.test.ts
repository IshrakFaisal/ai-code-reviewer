import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emptyReviewState,
  reviewUpdateSchema,
  type ReviewState,
} from "@/lib/reports/review";
import {
  acknowledgeDraft,
  loadReview,
  ReviewSaveConflict,
  saveReviewDrafts,
  type PendingDecision,
} from "@/lib/reports/review-client";

function fixture() {
  return emptyReviewState({
    id: "demo",
    headSha: "b".repeat(40),
    findingIds: ["finding-1", "finding-2", "finding-3"],
  });
}
const pending: PendingDecision[] = [
  {
    findingId: "finding-1",
    draft: { status: "NEEDS_FIX", note: "Reproduce token reuse" },
  },
  {
    findingId: "finding-2",
    draft: { status: "REVIEWED", note: "Retention checked" },
  },
  {
    findingId: "finding-3",
    draft: { status: "DISMISSED", note: "Covered separately" },
  },
];
function saved(current: ReviewState, decision: PendingDecision): ReviewState {
  return {
    ...current,
    revision: current.revision + 1,
    findings: {
      ...current.findings,
      [decision.findingId]: {
        ...decision.draft,
        updatedAt: "2026-10-27T12:00:00.000Z",
      },
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("review draft saving", () => {
  it("sends schema-valid updates when edits inherit saved decision metadata", async () => {
    const review = fixture();
    const decision = {
      findingId: "finding-1",
      draft: { ...review.findings["finding-1"], note: "Edited saved note" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        expect(
          reviewUpdateSchema.parse(JSON.parse(init.body as string)),
        ).toEqual({
          findingId: "finding-1",
          status: "OPEN",
          note: "Edited saved note",
          revision: 0,
        });
        return Response.json(saved(review, decision));
      }),
    );
    const result = await saveReviewDrafts({
      review,
      pending: [decision],
      signal: new AbortController().signal,
      onStart: vi.fn(),
      onSaved: vi.fn(),
    });
    expect(result.revision).toBe(1);
  });
  it("saves sequentially with each acknowledged revision and reports each completion", async () => {
    let state = fixture();
    const requests: number[] = [];
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const update = JSON.parse(init.body as string);
      requests.push(update.revision);
      expect(update.revision).toBe(state.revision);
      state = saved(state, pending[requests.length - 1]);
      return Response.json(state);
    });
    vi.stubGlobal("fetch", fetcher);
    const onStart = vi.fn(),
      onSaved = vi.fn();
    const result = await saveReviewDrafts({
      review: fixture(),
      pending,
      signal: new AbortController().signal,
      onStart,
      onSaved,
    });
    expect(requests).toEqual([0, 1, 2]);
    expect(result.revision).toBe(3);
    expect(onStart.mock.calls).toEqual([
      ["finding-1", 0],
      ["finding-2", 1],
      ["finding-3", 2],
    ]);
    expect(onSaved).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("stops after a conflict and exposes the latest state without losing unsaved drafts", async () => {
    const first = saved(fixture(), pending[0]);
    const otherTab = saved(first, {
      findingId: "finding-2",
      draft: { status: "NEEDS_FIX", note: "Other reviewer note" },
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(first))
      .mockResolvedValueOnce(
        Response.json({ current: otherTab }, { status: 409 }),
      );
    vi.stubGlobal("fetch", fetcher);
    let drafts = Object.fromEntries(
      pending.map((item) => [item.findingId, item.draft]),
    );
    try {
      await saveReviewDrafts({
        review: fixture(),
        pending,
        signal: new AbortController().signal,
        onStart: vi.fn(),
        onSaved: (_state, decision) => {
          drafts = acknowledgeDraft(drafts, decision);
        },
      });
      expect.fail("Expected conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(ReviewSaveConflict);
      expect((error as ReviewSaveConflict).current).toEqual(otherTab);
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(drafts).toEqual({
      "finding-2": pending[1].draft,
      "finding-3": pending[2].draft,
    });
  });

  it.each(["network", "http", "malformed"])(
    "retains partial progress and stops on a %s failure",
    async (kind) => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(Response.json(saved(fixture(), pending[0])));
      if (kind === "network")
        fetcher.mockRejectedValueOnce(new TypeError("Disconnected"));
      else
        fetcher.mockResolvedValueOnce(
          kind === "http"
            ? new Response("Unavailable", { status: 503 })
            : Response.json({ invalid: true }),
        );
      vi.stubGlobal("fetch", fetcher);
      const onSaved = vi.fn();
      await expect(
        saveReviewDrafts({
          review: fixture(),
          pending,
          signal: new AbortController().signal,
          onStart: vi.fn(),
          onSaved,
        }),
      ).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(onSaved).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["revision", "decision", "head", "report", "missing"])(
    "rejects an unconfirmed %s response before clearing the draft",
    async (kind) => {
      const next = saved(fixture(), pending[0]);
      if (kind === "revision") next.revision = 0;
      if (kind === "decision")
        next.findings["finding-1"].note = "Different note";
      if (kind === "head") next.headSha = "c".repeat(40);
      if (kind === "report")
        next.reportId = "11111111-1111-4111-8111-111111111111";
      if (kind === "missing") delete next.findings["finding-1"];
      const fetcher = vi.fn().mockResolvedValue(Response.json(next));
      vi.stubGlobal("fetch", fetcher);
      const onSaved = vi.fn();
      await expect(
        saveReviewDrafts({
          review: fixture(),
          pending,
          signal: new AbortController().signal,
          onStart: vi.fn(),
          onSaved,
        }),
      ).rejects.toThrow();
      expect(onSaved).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("does not apply a conflict from another report revision", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { current: { ...fixture(), headSha: "d".repeat(40) } },
            { status: 409 },
          ),
        ),
    );
    await expect(
      saveReviewDrafts({
        review: fixture(),
        pending,
        signal: new AbortController().signal,
        onStart: vi.fn(),
        onSaved: vi.fn(),
      }),
    ).rejects.toThrow("do not match");
  });

  it("does not save unknown findings or start work after cancellation", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      saveReviewDrafts({
        review: fixture(),
        pending,
        signal: AbortSignal.abort(),
        onStart: vi.fn(),
        onSaved: vi.fn(),
      }),
    ).rejects.toThrow();
    await expect(
      saveReviewDrafts({
        review: fixture(),
        pending: [{ ...pending[0], findingId: "outside" }],
        signal: new AbortController().signal,
        onStart: vi.fn(),
        onSaved: vi.fn(),
      }),
    ).rejects.toThrow("not available");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not acknowledge a response arriving after navigation cancellation", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        controller.abort();
        return Response.json(saved(fixture(), pending[0]));
      }),
    );
    const onSaved = vi.fn();
    await expect(
      saveReviewDrafts({
        review: fixture(),
        pending,
        signal: controller.signal,
        onStart: vi.fn(),
        onSaved,
      }),
    ).rejects.toThrow();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("preserves edits made after a draft was submitted", () => {
    const newer = { ...pending[0].draft, note: "Newer edit" };
    const drafts = { "finding-1": newer, "finding-2": pending[1].draft };
    expect(acknowledgeDraft(drafts, pending[0])).toBe(drafts);
    expect(acknowledgeDraft(drafts, pending[1])).toEqual({
      "finding-1": newer,
    });
  });

  it("bounds stalled loads and saves with a request deadline", async () => {
    const deadline = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(deadline.signal);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(init.signal?.reason),
              { once: true },
            );
          }),
      ),
    );
    const onSaved = vi.fn();
    const load = loadReview(fixture(), new AbortController().signal);
    const save = saveReviewDrafts({
      review: fixture(),
      pending,
      signal: new AbortController().signal,
      onStart: vi.fn(),
      onSaved,
    });
    const assertions = Promise.all([
      expect(load).rejects.toMatchObject({ name: "TimeoutError" }),
      expect(save).rejects.toMatchObject({ name: "TimeoutError" }),
    ]);
    deadline.abort(new DOMException("Deadline", "TimeoutError"));
    await assertions;
    expect(timeout).toHaveBeenCalledWith(15000);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("validates loaded review identity and uses uncached reads", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(fixture()))
      .mockResolvedValueOnce(
        Response.json({ ...fixture(), headSha: "c".repeat(40) }),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      loadReview(fixture(), new AbortController().signal),
    ).resolves.toEqual(fixture());
    expect(fetcher).toHaveBeenCalledWith(
      "/api/reports/demo/review",
      expect.objectContaining({ cache: "no-store" }),
    );
    await expect(
      loadReview(fixture(), new AbortController().signal),
    ).rejects.toThrow("do not match");
  });
});
