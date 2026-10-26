import { afterEach, describe, it, expect, vi } from "vitest";
import { readJsonLines, responseError, streamError } from "@/lib/streaming";
import { analysisMessageSchema } from "@/lib/agent/messages";
import { STAGES } from "@/lib/types";
afterEach(() => vi.useRealTimers());
const collect = async (
  response: Response,
  options: Parameters<typeof readJsonLines>[1] = {},
) => {
  const values = [];
  for await (const value of readJsonLines(response, options))
    values.push(value);
  return values;
};
describe("bounded investigation stream decoding", () => {
  it("handles split UTF-8, CRLF, blank lines and a terminal message without a newline", async () => {
    const bytes = new TextEncoder().encode(
      '\r\n{"label":"café → test"}\r\n\n{"type":"complete"}',
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    expect(await collect(new Response(body))).toEqual([
      { label: "café → test" },
      { type: "complete" },
    ]);
    expect(body.locked).toBe(false);
  });
  it("cancels and unlocks an open stream when the consumer stops after completion", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"type":"complete"}\n'));
      },
      cancel,
    });
    for await (const value of readJsonLines(new Response(body))) {
      expect(value).toEqual({ type: "complete" });
      break;
    }
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });
  it("cancels malformed JSON rather than leaving server work running", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode("{broken}\n"));
      },
      cancel,
    });
    await expect(collect(new Response(body))).rejects.toThrow(
      "invalid progress message",
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });
  it.each([{ maxBytes: 10 }, { maxLineBytes: 10 }])(
    "enforces byte bounds: %s",
    async (options) => {
      await expect(
        collect(new Response('{"text":"ééééé"}\n'), options),
      ).rejects.toThrow("size limit");
    },
  );
  it("rejects malformed UTF-8", async () => {
    await expect(
      collect(new Response(new Uint8Array([0xc3, 0x28]))),
    ).rejects.toThrow("unreadable text");
  });
  it("interrupts a stalled read immediately on cancellation", async () => {
    const controller = new AbortController(),
      cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const assertion = expect(
      collect(new Response(body), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });
  it("times out silent streams and releases the reader", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(),
      body = new ReadableStream<Uint8Array>({ cancel });
    const assertion = expect(
      collect(new Response(body), { idleTimeoutMs: 20 }),
    ).rejects.toThrow("stopped sending progress");
    await vi.advanceTimersByTimeAsync(21);
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });
});
describe("actionable response errors and trusted navigation", () => {
  it("retains server messages and tells the user when to retry a rate limit", async () => {
    const error = await responseError(
      new Response('{"error":"Execution slots are busy."}', {
        status: 429,
        headers: { "retry-after": "30" },
      }),
      "Cannot start",
    );
    expect(error.message).toBe(
      "Execution slots are busy. Retry in 30 seconds.",
    );
  });
  it("handles gateway HTML and authentication failures without exposing HTML", async () => {
    expect(
      (
        await responseError(
          new Response("<html>proxy error</html>", { status: 502 }),
          "Analysis unavailable",
        )
      ).message,
    ).toBe("Analysis unavailable (HTTP 502).");
    expect(
      (
        await responseError(
          new Response("private login response", { status: 401 }),
          "Failed",
        )
      ).message,
    ).toContain("Sign in to this workspace");
  });
  it("does not wait indefinitely for an incomplete HTTP error body", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      status: 503,
    });
    const pending = responseError(response, "Service unavailable");
    await vi.advanceTimersByTimeAsync(5001);
    expect((await pending).message).toBe("Service unavailable (HTTP 503).");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("bounds oversized error bodies", async () =>
    expect(
      (
        await responseError(
          new Response("x".repeat(13000), { status: 500 }),
          "Failed",
        )
      ).message,
    ).toBe("Failed (HTTP 500)."));
  it("maps network failures and request deadlines to useful messages", () => {
    expect(streamError(new TypeError("Failed to fetch"), "Failed")).toContain(
      "server is running",
    );
    expect(
      streamError(new DOMException("timeout", "TimeoutError"), "Failed"),
    ).toContain("deadline");
  });
  it("rejects invalid stage metadata and report redirect IDs", () => {
    const event = {
      stage: 0,
      label: STAGES[0],
      detail: "Fetching",
      at: new Date().toISOString(),
    };
    expect(
      analysisMessageSchema.safeParse({ type: "progress", event }).success,
    ).toBe(true);
    expect(
      analysisMessageSchema.safeParse({
        type: "progress",
        event: { ...event, stage: 999 },
      }).success,
    ).toBe(false);
    expect(
      analysisMessageSchema.safeParse({
        type: "progress",
        event: { ...event, label: "wrong stage" },
      }).success,
    ).toBe(false);
    expect(
      analysisMessageSchema.safeParse({
        type: "complete",
        id: "../../other-page",
      }).success,
    ).toBe(false);
  });
});
