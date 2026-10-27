import { authorizeRequest } from "@/lib/security";
import { isSameOrigin } from "@/lib/http";
import { reviewReportIdSchema } from "@/lib/reports/review";
import { getReport } from "@/lib/reports/store";
import { checkPullRequestRevision } from "@/lib/github/revision";
import { revisionCheckCooldown } from "@/lib/reports/freshness";

export const runtime = "nodejs";
export const maxDuration = 30;
const headers = { "Cache-Control": "no-store" };
const state = globalThis as typeof globalThis & {
  revisionChecks?: Map<string, number>;
  revisionActive?: number;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = authorizeRequest(request);
  if (denied) return denied;
  if (!isSameOrigin(request))
    return Response.json(
      { error: "Cross-origin revision checks are not allowed." },
      { status: 403, headers },
    );
  const { id } = await params;
  if (!reviewReportIdSchema.safeParse(id).success)
    return Response.json(
      { error: "Invalid report ID." },
      { status: 400, headers },
    );
  if (id === "demo")
    return Response.json(
      {
        error:
          "The demo PR is synthetic. Open a live report to check GitHub revisions.",
      },
      { status: 400, headers },
    );
  const report = await getReport(id);
  if (!report)
    return Response.json(
      { error: "Report not found." },
      { status: 404, headers },
    );
  if (report.mode !== "LIVE")
    return Response.json(
      { error: "Synthetic reports cannot be checked against GitHub." },
      { status: 400, headers },
    );
  const checks = (state.revisionChecks ??= new Map());
  const now = Date.now();
  for (const [key, at] of checks)
    if (now - at >= revisionCheckCooldown) checks.delete(key);
  const key =
    `${report.pr.owner}/${report.pr.repo}#${report.pr.number}`.toLowerCase();
  const previous = checks.get(key);
  if (
    previous !== undefined ||
    (state.revisionActive ?? 0) >= 2 ||
    checks.size >= 100
  ) {
    const retry =
      previous !== undefined
        ? Math.max(
            1,
            Math.ceil((revisionCheckCooldown - (now - previous)) / 1000),
          )
        : revisionCheckCooldown / 1000;
    return Response.json(
      {
        error:
          "A revision check was requested recently. Wait briefly before checking again.",
      },
      { status: 429, headers: { ...headers, "Retry-After": String(retry) } },
    );
  }
  checks.set(key, now);
  state.revisionActive = (state.revisionActive ?? 0) + 1;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25000)]);
  try {
    return Response.json(await checkPullRequestRevision(report, signal), {
      headers,
    });
  } catch (error) {
    return Response.json(
      {
        error: signal.aborted
          ? "The GitHub revision check timed out or was cancelled. Retry when the connection is available."
          : error instanceof Error
            ? error.message
            : "The GitHub revision could not be checked.",
      },
      { status: signal.aborted ? 504 : 502, headers },
    );
  } finally {
    state.revisionActive = Math.max(0, (state.revisionActive ?? 1) - 1);
  }
}
