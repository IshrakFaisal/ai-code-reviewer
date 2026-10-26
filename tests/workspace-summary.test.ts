import { describe, expect, it } from "vitest";
import { workspaceSummary, integrationSummary } from "@/lib/workspace/summary";
import type { ReportSummary } from "@/lib/reports/history";

function report(
  id: string,
  owner: string,
  repo: string,
  mode: ReportSummary["mode"],
  createdAt = "2026-10-25T00:00:00.000Z",
): ReportSummary {
  return {
    id,
    createdAt,
    mode,
    highFindings: 0,
    pr: { owner, repo, number: 1, title: "Change", headSha: "a".repeat(40) },
  };
}

describe("workspace activity", () => {
  it("separates synthetic reports and groups GitHub repository casing", () => {
    const summary = workspaceSummary([
      report("1", "Acme", "Platform", "LIVE"),
      report("2", "acme", "platform", "LIVE"),
      report("3", "acme", "platform", "DEMO"),
    ]);
    expect(summary.total).toBe(3);
    expect(summary.live).toBe(2);
    expect(summary.demo).toBe(1);
    expect(summary.repositories).toHaveLength(1);
    expect(summary.repositories[0].count).toBe(2);
  });
  it("uses the latest report independent of input order and leaves input untouched", () => {
    const reports = [
      report("old", "acme", "app", "LIVE", "2026-10-20T00:00:00.000Z"),
      report("other", "acme", "api", "LIVE", "2026-10-23T00:00:00.000Z"),
      report("new", "acme", "app", "LIVE"),
    ];
    const before = structuredClone(reports),
      summary = workspaceSummary(reports);
    expect(
      summary.repositories.map((repository) => repository.latest.id),
    ).toEqual(["new", "other"]);
    expect(reports).toEqual(before);
  });
  it("handles empty and demo-only workspaces without inventing repositories", () => {
    expect(workspaceSummary([])).toEqual({
      total: 0,
      live: 0,
      demo: 0,
      repositories: [],
    });
    expect(
      workspaceSummary([report("demo", "synthetic", "repo", "DEMO")])
        .repositories,
    ).toEqual([]);
  });
});

describe("safe integration summary", () => {
  it("exposes only presence flags and an allowlisted provider, never environment values", () => {
    const env = {
      GITHUB_TOKEN: "github-secret",
      NEBIUS_API_KEY: "inference-secret",
      NEBIUS_MODEL: "model-secret",
      NEBIUS_SANDBOX_TOKEN: "sandbox-secret",
      NEBIUS_SANDBOX_PROJECT_ID: "project-secret",
      NEBIUS_SANDBOX_IMAGE: "image-secret",
      APP_AUTH_PASSWORD: "owner-password-secret",
      SANDBOX_PROVIDER: "untrusted-secret",
    };
    const summary = integrationSummary(env),
      serialized = JSON.stringify(summary);
    for (const value of Object.values(env))
      expect(serialized).not.toContain(value);
    expect(summary.githubTokenPresent).toBe(true);
    expect(summary.aiKeyPresent).toBe(true);
    expect(summary.aiModelPresent).toBe(true);
    expect(summary.provider).toBe("disabled");
    expect(summary.executionConfigured).toBe(false);
  });
  it("does not treat whitespace credentials or nonliteral enablement as configured", () => {
    const summary = integrationSummary({
      GITHUB_TOKEN: " ",
      NEBIUS_API_KEY: "\n",
      NEBIUS_MODEL: " ",
      SANDBOX_PROVIDER: "docker",
      ENABLE_LOCAL_SANDBOX: "TRUE",
      LOCAL_SANDBOX_REPOSITORIES: " , ",
      NODE_ENV: "development",
    });
    expect(summary.githubTokenPresent).toBe(false);
    expect(summary.aiKeyPresent).toBe(false);
    expect(summary.aiModelPresent).toBe(false);
    expect(summary.executionEnabled).toBe(false);
    expect(summary.allowlistPresent).toBe(false);
    expect(summary.executionConfigured).toBe(false);
  });
  it("requires the production execution gate for Docker and always blocks production native execution", () => {
    const env = {
      SANDBOX_PROVIDER: "docker",
      ENABLE_LOCAL_SANDBOX: "true",
      LOCAL_SANDBOX_REPOSITORIES: "acme/repo",
      NODE_ENV: "production",
    };
    expect(integrationSummary(env).executionConfigured).toBe(false);
    expect(
      integrationSummary({ ...env, ENABLE_PRODUCTION_SANDBOX: "true" })
        .executionConfigured,
    ).toBe(true);
    expect(
      integrationSummary({
        ...env,
        ENABLE_PRODUCTION_SANDBOX: "true",
        SANDBOX_PROVIDER: "native",
      }).executionConfigured,
    ).toBe(false);
  });
  it("requires all remote sandbox prerequisites without claiming account access", () => {
    const env = {
      SANDBOX_PROVIDER: "nebius",
      ENABLE_NEBIUS_SANDBOX: "true",
      NEBIUS_SANDBOX_REPOSITORIES: "acme/repo",
      NODE_ENV: "development",
      NEBIUS_SANDBOX_TOKEN: "token",
      NEBIUS_SANDBOX_PROJECT_ID: "project",
    };
    expect(integrationSummary(env).executionConfigured).toBe(false);
    const complete = integrationSummary({
      ...env,
      NEBIUS_SANDBOX_IMAGE: "image",
    });
    expect(complete.executionConfigured).toBe(true);
    expect(Object.hasOwn(complete, "connected")).toBe(false);
  });
  it("preserves the explicit native development fallback and keeps empty configuration disabled", () => {
    expect(integrationSummary({}).provider).toBe("disabled");
    const summary = integrationSummary({
      ENABLE_LOCAL_SANDBOX: "true",
      LOCAL_SANDBOX_REPOSITORIES: "acme/repo",
      NODE_ENV: "development",
    });
    expect(summary.provider).toBe("native");
    expect(summary.executionConfigured).toBe(true);
  });
});
