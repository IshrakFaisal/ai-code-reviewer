import { createHash, timingSafeEqual } from "node:crypto";

function failure(error: string, status: number, authenticate = false) {
  return Response.json(
    { error },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...(authenticate
          ? {
              "WWW-Authenticate":
                'Basic realm="AI Change Verifier", charset="UTF-8"',
            }
          : {}),
      },
    },
  );
}

function loopback(hostname: string) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

/** A configured public origin is an operator trust decision, never a forwarded header. */
export function applicationOrigin(request: Request) {
  const configured = process.env.APP_ORIGIN;
  const url = new URL(configured || request.url);
  if (
    configured &&
    (url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/")
  )
    throw new Error("APP_ORIGIN must contain only the application origin.");
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("APP_ORIGIN must use HTTP or HTTPS.");
  const host = request.headers.get("host") || new URL(request.url).host;
  const requested = new URL(`${url.protocol}//${host}`);
  if (
    requested.host !== host.toLowerCase() ||
    requested.username ||
    requested.password ||
    requested.pathname !== "/"
  )
    throw new Error("Invalid request host.");
  if (configured && requested.host !== url.host)
    throw new Error("Request host does not match APP_ORIGIN.");
  if (!configured && !loopback(requested.hostname))
    throw new Error(
      "Configure APP_ORIGIN and authentication before exposing this workspace.",
    );
  return configured ? url : requested;
}

/** One owner for this workspace; this is not multi-tenant identity or authorization. */
export function authorizeRequest(request: Request): Response | undefined {
  let origin: URL;
  try {
    origin = applicationOrigin(request);
  } catch (error) {
    return failure((error as Error).message, 403);
  }
  const username = process.env.APP_AUTH_USERNAME || "";
  const password = process.env.APP_AUTH_PASSWORD || "";
  const publicWorkspace = !loopback(origin.hostname);
  if (publicWorkspace && origin.protocol !== "https:")
    return failure("Public workspaces require an HTTPS APP_ORIGIN.", 503);
  if (!publicWorkspace && !username && !password) return;
  if (
    !/^[a-zA-Z0-9_.@-]{1,100}$/.test(username) ||
    password.length < 24 ||
    password.length > 512
  )
    return failure(
      "Configure APP_AUTH_USERNAME and an APP_AUTH_PASSWORD of at least 24 characters.",
      503,
    );
  const authorization = request.headers.get("authorization") || "";
  const encoded = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization)?.[1];
  if (!encoded || encoded.length > 4096)
    return failure("Sign in to this workspace.", 401, true);
  const actual = createHash("sha256")
    .update(Buffer.from(encoded, "base64"))
    .digest();
  const expected = createHash("sha256")
    .update(`${username}:${password}`, "utf8")
    .digest();
  if (!timingSafeEqual(actual, expected))
    return failure("Sign in to this workspace.", 401, true);
}

export function contentSecurityPolicy(nonce: string, development = false) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    // Report bars use React style attributes; script execution still requires a nonce.
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self'${development ? " ws: wss:" : ""}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
