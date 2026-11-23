import { authorizeRequest } from "@/lib/security";
import { isSameOrigin, readSmallBody, RequestBodyError } from "@/lib/http";
import { RunFileError, evaluations } from "./store";

export type Context = { params: Promise<{ run: string }> };
export type Operation = "list" | "load" | "labels" | "prs" | "score";
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function handle(
  operation: Operation,
  request: Request,
  context?: Context,
) {
  if (process.env.ENABLE_EVAL_UI !== "true")
    return json({ error: "Not found." }, 404);
  const denied = authorizeRequest(request);
  if (denied) return denied;
  if (request.method !== "GET" && !isSameOrigin(request))
    return json({ error: "Cross-origin request denied." }, 403);
  try {
    if (operation === "list") return json(await evaluations.list());
    const { run } = await context!.params;
    if (operation === "load") return json(await evaluations.load(run));
    if (operation === "score")
      return json({ metrics: await evaluations.scores(run) });
    const body = await readSmallBody(request, 128 * 1024);
    let fields: unknown;
    try {
      fields = JSON.parse(body);
    } catch {
      return json({ error: "Invalid label update." }, 400);
    }
    await evaluations.patch(run, operation, fields);
    return json({ saved: true });
  } catch (e) {
    if (e instanceof RunFileError || e instanceof RequestBodyError)
      return json({ error: e.message }, e.status);
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT")
      return json({ error: "Evaluation files not found." }, 404);
    return json(
      { error: "Could not read or update the evaluation files." },
      422,
    );
  }
}
