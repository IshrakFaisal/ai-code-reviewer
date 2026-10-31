import { RunError } from "./runs";
export const runHeaders = { "Cache-Control": "no-store" };
export function runFailure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof RunError
          ? error.message
          : "Analysis storage is unavailable or invalid. Existing checkpoints were preserved; retry or start a new analysis.",
    },
    {
      status: error instanceof RunError ? error.status : 500,
      headers: {
        ...runHeaders,
        ...(error instanceof RunError && error.status === 429
          ? { "Retry-After": "30" }
          : {}),
      },
    },
  );
}
