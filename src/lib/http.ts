import { applicationOrigin } from "./security";

/** Next may normalize request.url to localhost. Compare the browser origin with
 * the actual Host header instead; never trust a client-supplied forwarded host. */
export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true; // CLI clients; this is not a substitute for authentication.
  try {
    const supplied = new URL(origin);
    return supplied.origin === applicationOrigin(request).origin;
  } catch {
    return false;
  }
}
export class RequestBodyError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
export async function readSmallBody(
  request: Request,
  limit = 4096,
  timeoutMs = 10000,
) {
  if (Number(request.headers.get("content-length")) > limit)
    throw new RequestBodyError("Request too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Request body is required.");
  const decoder = new TextDecoder();
  let bytes = 0,
    result = "";
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    void reader.cancel().catch(() => {});
  }, timeoutMs);
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  request.signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (request.signal.aborted)
        throw new RequestBodyError("Request cancelled.", 408);
      const { done, value } = await reader.read();
      if (expired) throw new RequestBodyError("Request body timed out.", 408);
      if (request.signal.aborted)
        throw new RequestBodyError("Request cancelled.", 408);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new RequestBodyError("Request too large.", 413);
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
