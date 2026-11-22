import { analysisRuns } from "@/lib/agent/runs";
import { runFailure, runHeaders } from "@/lib/agent/run-http";
import { isSameOrigin } from "@/lib/http";
import { authorizeRequest } from "@/lib/security";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = authorizeRequest(request);
  if (denied) return denied;
  if (!isSameOrigin(request))
    return Response.json(
      { error: "Cross-origin discard is not allowed." },
      { status: 403 },
    );
  try {
    await analysisRuns.discard((await params).id);
    return new Response(null, { status: 204, headers: runHeaders });
  } catch (error) {
    return runFailure(error);
  }
}
