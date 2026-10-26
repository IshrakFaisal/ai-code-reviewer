import { z } from "zod";
import { authorizeRequest } from "@/lib/security";
import { isSameOrigin, readSmallBody, RequestBodyError } from "@/lib/http";
import { getReport } from "@/lib/reports/store";
import { investigate } from "@/lib/agent/investigator";
import { regressions, regressionKey } from "@/lib/regression/store";
import {
  reproduce,
  repairAndRecheck,
  describeError,
} from "@/lib/regression/workflow";
import { demoReproduction } from "@/lib/regression/fixtures";
import { sandboxAllowed, selectedSandboxProvider } from "@/lib/sandbox/factory";

export const runtime = "nodejs";
export const maxDuration = 300;
const state = globalThis as typeof globalThis & {
  verifierActive?: number;
  regressionActive?: Set<string>;
};
const bodySchema = z
  .object({ action: z.enum(["reproduce", "repair"]) })
  .strict();
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; findingId: string }> },
) {
  const denied = authorizeRequest(request);
  if (denied) return denied;
  if (!isSameOrigin(request))
    return Response.json(
      { error: "Cross-origin execution is not allowed." },
      { status: 403 },
    );
  let key: string,
    id: string,
    findingId: string,
    action: "reproduce" | "repair";
  try {
    ({ id, findingId } = await context.params);
    key = regressionKey(id, findingId);
    ({ action } = bodySchema.parse(
      JSON.parse(await readSmallBody(request, 512)),
    ));
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof RequestBodyError
            ? error.message
            : "Choose a valid reproduction action and report.",
      },
      { status: error instanceof RequestBodyError ? error.status : 400 },
    );
  }
  if ((state.verifierActive || 0) >= 2 || state.regressionActive?.has(key))
    return Response.json(
      {
        error:
          "This investigation is already running, or the execution slots are busy. Try again shortly.",
      },
      { status: 429, headers: { "Retry-After": "30" } },
    );
  let report;
  try {
    report =
      id === "demo"
        ? await investigate({ input: "acme/platform", demo: true })
        : await getReport(id);
  } catch {
    return Response.json(
      { error: "The bundled fixture could not load." },
      { status: 503 },
    );
  }
  if (!report)
    return Response.json({ error: "Report not found." }, { status: 404 });
  if (id === "demo") report.id = "demo";
  const finding = report.findings.find((f) => f.id === findingId);
  if (!finding)
    return Response.json({ error: "Finding not found." }, { status: 404 });
  if (report.mode === "DEMO" && finding.id !== "finding-1")
    return Response.json(
      {
        error:
          "The bundled walkthrough covers the first reset-token finding only.",
      },
      { status: 422 },
    );
  if (report.mode === "LIVE") {
    if (!finding.generatedTest || finding.generatedTest.framework !== "vitest")
      return Response.json(
        {
          error:
            "This finding has no supported generated Vitest test. Run a live AI investigation first.",
        },
        { status: 422 },
      );
    if (
      !["docker", "nebius"].includes(selectedSandboxProvider()) ||
      !sandboxAllowed(`${report.pr.owner}/${report.pr.repo}`)
    )
      return Response.json(
        {
          error:
            "Reproduction requires enabled Docker or Nebius execution and this exact repository in its allowlist. See Settings & integrations.",
        },
        { status: 409 },
      );
    if (
      action === "repair" &&
      (!process.env.NEBIUS_API_KEY || !process.env.NEBIUS_MODEL)
    )
      return Response.json(
        {
          error:
            "Set the server-side Nebius API key and exact NVIDIA model before requesting a live repair.",
        },
        { status: 409 },
      );
  }
  const previous =
    action === "repair" ? await regressions.get(id, findingId) : null;
  if (action === "repair" && !previous)
    return Response.json(
      { error: "Run the base/head comparison before requesting a repair." },
      { status: 409 },
    );
  // Recheck after asynchronous loading, before reserving the shared execution slot.
  if ((state.verifierActive || 0) >= 2 || state.regressionActive?.has(key))
    return Response.json(
      { error: "An execution is already running. Try again shortly." },
      { status: 429 },
    );
  state.regressionActive ??= new Set();
  state.regressionActive.add(key);
  state.verifierActive = (state.verifierActive || 0) + 1;
  const controller = new AbortController();
  const signal = AbortSignal.any([
    request.signal,
    controller.signal,
    AbortSignal.timeout(280000),
  ]);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(streamController) {
      const send = (data: unknown) => {
        if (!signal.aborted)
          try {
            streamController.enqueue(
              encoder.encode(JSON.stringify(data) + "\n"),
            );
          } catch {
            controller.abort();
          }
      };
      const heartbeat = setInterval(() => send({ type: "heartbeat" }), 10000);
      try {
        const progress = (label: string) =>
          send({ type: "progress", label, at: new Date().toISOString() });
        const result =
          report.mode === "DEMO"
            ? await demoReproduction(
                report,
                finding,
                action,
                previous ?? undefined,
                progress,
                signal,
              )
            : action === "repair"
              ? await repairAndRecheck(
                  report,
                  finding,
                  previous!,
                  progress,
                  signal,
                )
              : await reproduce(report, finding, progress, signal);
        signal.throwIfAborted();
        await regressions.save(result);
        send({ type: "complete", result });
      } catch (error) {
        send({
          type: "error",
          error: signal.aborted
            ? "Execution was cancelled or exceeded its deadline. Existing saved evidence is unchanged."
            : describeError(error),
        });
      } finally {
        clearInterval(heartbeat);
        state.regressionActive?.delete(key);
        state.verifierActive = Math.max(0, (state.verifierActive || 1) - 1);
        try {
          streamController.close();
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
