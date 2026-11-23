import { handle } from "./_lib/http";
export function GET(request: Request) {
  return handle("list", request);
}
