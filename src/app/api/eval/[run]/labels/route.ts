import { handle, type Context } from "../../_lib/http";
export function PATCH(request: Request, context: Context) {
  return handle("labels", request, context);
}
