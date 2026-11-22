import { analysisRuns } from "@/lib/agent/runs";
import { runFailure, runHeaders } from "@/lib/agent/run-http";
import { authorizeRequest } from "@/lib/security";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const denied = authorizeRequest(request);
  if (denied) return denied;
  try {
    return Response.json(await analysisRuns.listUnfinishedRuns(), {
      headers: runHeaders,
    });
  } catch (error) {
    return runFailure(error);
  }
}
