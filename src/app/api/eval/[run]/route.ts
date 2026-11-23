import { handle, type Context } from "../_lib/http";
export function GET(request: Request, context: Context) {
  return handle("load", request, context);
}
