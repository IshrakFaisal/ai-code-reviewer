async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
  timeoutMs = 45000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "The server stopped sending progress. Retry the investigation; previously saved results remain available.",
              ),
            ),
          timeoutMs,
        );
        abort = () =>
          reject(
            signal?.reason ??
              new DOMException("Request cancelled.", "AbortError"),
          );
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}
/** Shared browser-safe decoding for the analysis and reproduction streams. */
export async function* readJsonLines(
  response: Response,
  options: {
    signal?: AbortSignal;
    idleTimeoutMs?: number;
    maxBytes?: number;
    maxLineBytes?: number;
  } = {},
): AsyncGenerator<unknown> {
  const reader = response.body?.getReader();
  if (!reader)
    throw new Error(
      "The server did not provide a progress stream. Please retry.",
    );
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const maxBytes = options.maxBytes ?? 2_000_000;
  const maxLineBytes = options.maxLineBytes ?? 1_600_000;
  let buffer = "",
    bytes = 0,
    lineBytes = 0,
    ended = false;
  const parse = (line: string) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(
        "The server sent an invalid progress message. Retry the investigation.",
      );
    }
  };
  try {
    while (true) {
      options.signal?.throwIfAborted();
      const chunk = await readChunk(
        reader,
        options.signal,
        options.idleTimeoutMs ?? 45000,
      );
      if (chunk.done) {
        ended = true;
        try {
          buffer += decoder.decode();
        } catch {
          throw new Error(
            "The progress stream ended with unreadable text. Please retry.",
          );
        }
        if (buffer.trim()) yield parse(buffer);
        return;
      }
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes)
        throw new Error(
          "The progress stream exceeded its size limit. Try a smaller investigation.",
        );
      for (const byte of chunk.value) {
        lineBytes = byte === 10 ? 0 : lineBytes + 1;
        if (lineBytes > maxLineBytes)
          throw new Error(
            "A progress message exceeded its size limit. Please retry.",
          );
      }
      try {
        buffer += decoder.decode(chunk.value, { stream: true });
      } catch {
        throw new Error(
          "The progress stream contained unreadable text. Please retry.",
        );
      }
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim()) yield parse(line);
      }
    }
  } finally {
    if (!ended) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function responseError(response: Response, fallback: string) {
  let message = `${fallback} (HTTP ${response.status}).`;
  if (response.status === 401)
    message = "Sign in to this workspace, then retry the investigation.";
  else if (response.body) {
    const reader = response.body.getReader();
    let raw = "",
      bytes = 0;
    try {
      const decoder = new TextDecoder();
      while (true) {
        const chunk = await readChunk(reader, undefined, 5000);
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 12000) break;
        raw += decoder.decode(chunk.value, { stream: true });
      }
      const data = JSON.parse(raw + decoder.decode());
      if (typeof data?.error === "string" && data.error.trim())
        message = data.error.slice(0, 2000);
    } catch {
      /* HTML gateway pages and malformed errors retain the actionable fallback. */
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  const retry = Number(response.headers.get("retry-after"));
  if (
    response.status === 429 &&
    Number.isInteger(retry) &&
    retry > 0 &&
    retry <= 3600
  )
    message += ` Retry in ${retry} seconds.`;
  return new Error(message);
}

export function streamError(error: unknown, fallback: string) {
  if (error instanceof Error && error.name === "TimeoutError")
    return "The investigation exceeded its deadline. Try again with a smaller scope.";
  if (error instanceof TypeError)
    return "The connection to the app was interrupted. Check that the server is running, then retry.";
  return error instanceof Error ? error.message : fallback;
}
