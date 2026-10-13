import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  authorizeRequest,
  applicationOrigin,
  contentSecurityPolicy,
} from "@/lib/security";
import { proxy } from "@/proxy";

const password = "test-password-that-is-long-enough";
const basic = (value = `reviewer:${password}`) =>
  `Basic ${Buffer.from(value).toString("base64")}`;
const request = (host = "127.0.0.1:3000", authorization?: string) =>
  new Request("http://localhost:3000/history", {
    headers: { host, ...(authorization ? { authorization } : {}) },
  });

beforeEach(() => {
  vi.stubEnv("APP_ORIGIN", "");
  vi.stubEnv("APP_AUTH_USERNAME", "");
  vi.stubEnv("APP_AUTH_PASSWORD", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("workspace access", () => {
  it("keeps credential-free loopback demo access", () => {
    expect(authorizeRequest(request())).toBeUndefined();
  });
  it.each([
    "evil.example",
    "localhost.evil.example",
    "127.0.0.1@evil.example",
    "localhost:3000/extra",
  ])("blocks an unconfigured host: %s", (host) => {
    expect(authorizeRequest(request(host))?.status).toBe(403);
  });
  it("requires HTTPS and strong credentials for a public workspace", () => {
    vi.stubEnv("APP_ORIGIN", "http://review.example");
    expect(authorizeRequest(request("review.example"))?.status).toBe(503);
    vi.stubEnv("APP_ORIGIN", "https://review.example");
    expect(authorizeRequest(request("review.example"))?.status).toBe(503);
    vi.stubEnv("APP_AUTH_USERNAME", "reviewer");
    vi.stubEnv("APP_AUTH_PASSWORD", "short");
    expect(authorizeRequest(request("review.example"))?.status).toBe(503);
  });
  it("authenticates public pages and rejects missing or wrong credentials", () => {
    vi.stubEnv("APP_ORIGIN", "https://review.example");
    vi.stubEnv("APP_AUTH_USERNAME", "reviewer");
    vi.stubEnv("APP_AUTH_PASSWORD", password);
    const denied = authorizeRequest(request("review.example"));
    expect(denied?.status).toBe(401);
    expect(denied?.headers.get("www-authenticate")).toContain("Basic");
    expect(
      authorizeRequest(request("review.example", basic("reviewer:wrong")))
        ?.status,
    ).toBe(401);
    expect(
      authorizeRequest(request("review.example", basic())),
    ).toBeUndefined();
    expect(authorizeRequest(request("127.0.0.1:3000", basic()))?.status).toBe(
      403,
    );
  });
  it("does not accept a forwarded host as the configured origin", () => {
    vi.stubEnv("APP_ORIGIN", "https://review.example");
    expect(() =>
      applicationOrigin(
        new Request("http://localhost", {
          headers: {
            host: "attacker.example",
            "x-forwarded-host": "review.example",
          },
        }),
      ),
    ).toThrow("does not match");
  });
  it("can protect the local workspace too", () => {
    vi.stubEnv("APP_AUTH_USERNAME", "reviewer");
    vi.stubEnv("APP_AUTH_PASSWORD", password);
    expect(authorizeRequest(request())?.status).toBe(401);
    expect(
      authorizeRequest(request("127.0.0.1:3000", basic())),
    ).toBeUndefined();
  });
  it("accepts configured UTF-8 credentials within the password length bound", () => {
    const unicodePassword = "密".repeat(400);
    vi.stubEnv("APP_AUTH_USERNAME", "reviewer");
    vi.stubEnv("APP_AUTH_PASSWORD", unicodePassword);
    expect(
      authorizeRequest(
        request("127.0.0.1:3000", basic(`reviewer:${unicodePassword}`)),
      ),
    ).toBeUndefined();
  });
});

describe("browser security policy", () => {
  it("uses fresh nonces in both the render request and response", () => {
    const a = proxy(new NextRequest("http://localhost:3000/"));
    const b = proxy(new NextRequest("http://localhost:3000/"));
    const policy = a.headers.get("content-security-policy");
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).not.toBe(b.headers.get("content-security-policy"));
    expect(a.headers.get("x-middleware-request-content-security-policy")).toBe(
      policy,
    );
    expect(a.headers.get("cache-control")).toContain("no-store");
  });
  it("allows eval only in development and blocks framing and objects", () => {
    expect(contentSecurityPolicy("nonce", false)).not.toContain("unsafe-eval");
    expect(contentSecurityPolicy("nonce", true)).toContain("unsafe-eval");
    expect(contentSecurityPolicy("nonce")).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy("nonce")).toContain("object-src 'none'");
  });
});
