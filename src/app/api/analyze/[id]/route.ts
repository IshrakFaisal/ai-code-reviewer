import { after } from "next/server";
import { authorizeRequest } from "@/lib/security";
import { isSameOrigin } from "@/lib/http";
import { analysisRuns } from "@/lib/agent/runs";
import { runFailure, runHeaders } from "@/lib/agent/run-http";
export const runtime = "nodejs";
export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  const denied = authorizeRequest(request);
  if (denied) return denied;
  try {
    return Response.json(await analysisRuns.get((await params).id), {
      headers: runHeaders,
    });
  } catch (error) {
    return runFailure(error);
  }
}
export async function POST(request: Request, { params }: Context) {
  const denied = authorizeRequest(request);
  if (denied) return denied;
  if (!isSameOrigin(request))
    return Response.json(
      { error: "Cross-origin resume is not allowed." },
      { status: 403 },
    );
  try {
    const job = await analysisRuns.resume((await params).id);
    after(() => job.done);
    return Response.json(job.snapshot, { status: 202, headers: runHeaders });
  } catch (error) {
    return runFailure(error);
  }
}
export async function DELETE(request: Request, { params }: Context) {
  const denied = authorizeRequest(request);
  if (denied) return denied;
  if (!isSameOrigin(request))
    return Response.json(
      { error: "Cross-origin pause is not allowed." },
      { status: 403 },
    );
  try {
    return Response.json(await analysisRuns.pause((await params).id), {
      headers: runHeaders,
    });
  } catch (error) {
    return runFailure(error);
  }
}
