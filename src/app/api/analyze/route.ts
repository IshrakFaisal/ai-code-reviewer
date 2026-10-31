import { after } from "next/server";
import { requestSchema, parseGitHubInput } from "@/lib/github/input";
import { isSameOrigin, readSmallBody, RequestBodyError } from "@/lib/http";
import { authorizeRequest } from "@/lib/security";
import { analysisRuns } from "@/lib/agent/runs";
import { runIdSchema } from "@/lib/agent/run-schema";
import { runFailure, runHeaders } from "@/lib/agent/run-http";
export const runtime = "nodejs";
export const maxDuration = 300;
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
  let parsed;
  try {
    parsed = requestSchema
      .extend({ runId: runIdSchema.optional() })
      .parse(JSON.parse(await readSmallBody(request)));
    if (!parsed.demo) parseGitHubInput(parsed.input, parsed.prNumber);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error && error.name !== "ZodError"
            ? error.message
            : "Enter a valid GitHub PR URL, or OWNER/REPO and a PR number.",
      },
      { status: error instanceof RequestBodyError ? error.status : 400 },
    );
  }
  try {
    const { runId, ...input } = parsed;
    const job = await analysisRuns.start(input, runId);
    after(() => job.done);
    return Response.json(job.snapshot, { status: 202, headers: runHeaders });
  } catch (error) {
    return runFailure(error);
  }
}
