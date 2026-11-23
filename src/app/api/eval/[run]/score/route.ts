import { handle, type Context } from "../../_lib/http";
export function POST(request: Request, context: Context) {
  return handle("score", request, context);
}
