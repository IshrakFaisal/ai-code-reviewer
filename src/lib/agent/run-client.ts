import { runSnapshotSchema } from "./run-schema";
import { responseError } from "@/lib/streaming";
export async function requestRun(
  url: string,
  id: string,
  options: RequestInit = {},
) {
  const signal = AbortSignal.any([
    AbortSignal.timeout(15000),
    ...(options.signal ? [options.signal] : []),
  ]);
  const response = await fetch(url, { ...options, signal, cache: "no-store" });
  if (!response.ok)
    throw Object.assign(
      await responseError(response, "Analysis could not be reached"),
      { status: response.status },
    );
  const parsed = runSnapshotSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.id !== id)
    throw new Error(
      "The server returned an invalid analysis state. Reconnect to this run.",
    );
  return parsed.data;
}
export async function waitForRun(signal: AbortSignal, milliseconds = 1000) {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}
