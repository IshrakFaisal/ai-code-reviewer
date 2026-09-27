import { requestSchema, parseGitHubInput } from "@/lib/github/input";
import { investigate } from "@/lib/agent/investigator";
import { saveReport } from "@/lib/reports/store";
import { isSameOrigin, readSmallBody, RequestBodyError } from "@/lib/http";
import { authorizeRequest } from "@/lib/security";
export const runtime = "nodejs";
export const maxDuration = 300;
const state = globalThis as typeof globalThis & { verifierActive?: number };
export async function POST(request: Request) {
  const denied = authorizeRequest(request);
  if (denied) return denied;
  if (!isSameOrigin(request))
    return Response.json(
      { error: "Cross-origin analysis is not allowed." },
      { status: 403 },
    );
  if (Number(request.headers.get("content-length")) > 4096)
    return Response.json({ error: "Request too large." }, { status: 413 });
  let input;
  try {
    const text = await readSmallBody(request);
    input = requestSchema.parse(JSON.parse(text));
    if (!input.demo) parseGitHubInput(input.input, input.prNumber);
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof Error && e.name !== "ZodError"
            ? e.message
            : "Enter a valid GitHub PR URL, or OWNER/REPO and a PR number.",
      },
      { status: e instanceof RequestBodyError ? e.status : 400 },
    );
  }
  if ((state.verifierActive || 0) >= 2)
    return Response.json(
      { error: "Two analyses are already running. Try again shortly." },
      { status: 429, headers: { "Retry-After": "30" } },
    );
  state.verifierActive = (state.verifierActive || 0) + 1;
  const encoder = new TextEncoder();
  const controller = new AbortController();
  const signal = AbortSignal.any([
    request.signal,
    controller.signal,
    AbortSignal.timeout(280000),
  ]);
  const stream = new ReadableStream({
    async start(s) {
      const send = (data: unknown) => {
        if (!signal.aborted)
          try {
            s.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
          } catch {
            controller.abort();
          }
      };
      const heartbeat = setInterval(() => send({ type: "heartbeat" }), 10000);
      try {
        const report = await investigate(
          input,
          (event) => send({ type: "progress", event }),
          signal,
        );
        await saveReport(report);
        send({ type: "complete", id: report.id });
      } catch (e) {
        if (!request.signal.aborted) {
          try {
            s.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: "error",
                  error: signal.aborted
                    ? "Analysis timed out. Try a smaller PR or run the demo."
                    : e instanceof Error
                      ? e.message
                      : "Analysis failed. Please retry.",
                }) + "\n",
              ),
            );
          } catch {}
        }
      } finally {
        clearInterval(heartbeat);
        state.verifierActive = Math.max(0, (state.verifierActive || 1) - 1);
        try {
          s.close();
        } catch {}
      }
    },
    cancel() {
      controller.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
