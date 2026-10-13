import { isSameOrigin, readSmallBody, RequestBodyError } from "@/lib/http";
import { reviewUpdateSchema } from "@/lib/reports/review";
import {
  ReviewConflictError,
  ReviewStoreError,
  reviewStore,
} from "@/lib/reports/review-store";
import { authorizeRequest } from "@/lib/security";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "no-store" };

function failure(error: unknown) {
  if (error instanceof ReviewConflictError)
    return Response.json(
      { error: error.message, current: error.current },
      { status: 409, headers },
    );
  if (error instanceof ReviewStoreError || error instanceof RequestBodyError)
    return Response.json(
      { error: error.message },
      { status: error.status, headers },
    );
  return Response.json(
    { error: "Review could not be saved or loaded. Try again." },
    { status: 500, headers },
  );
}

export async function GET(request: Request, { params }: Context) {
  const denied = authorizeRequest(request);
  if (denied) return denied;
  try {
    return Response.json(await reviewStore.get((await params).id), { headers });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const denied = authorizeRequest(request);
  if (denied) return denied;
  if (!isSameOrigin(request))
    return Response.json(
      { error: "Cross-origin review changes are not allowed." },
      { status: 403, headers },
    );
  let update;
  try {
    // 2,000 Unicode characters plus JSON escaping can exceed the analysis limit.
    update = reviewUpdateSchema.parse(
      JSON.parse(await readSmallBody(request, 16384)),
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof RequestBodyError
            ? error.message
            : "Invalid review decision. Notes must be at most 2,000 characters.",
      },
      {
        status: error instanceof RequestBodyError ? error.status : 400,
        headers,
      },
    );
  }
  try {
    return Response.json(await reviewStore.update((await params).id, update), {
      headers,
    });
  } catch (error) {
    return failure(error);
  }
}
