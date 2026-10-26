import type { ReportSummary } from "@/lib/reports/history";

export function workspaceSummary(reports: ReportSummary[]) {
  const repositories = new Map<
    string,
    { owner: string; repo: string; count: number; latest: ReportSummary }
  >();
  for (const report of reports) {
    if (report.mode !== "LIVE") continue;
    const key = `${report.pr.owner}/${report.pr.repo}`.toLowerCase();
    const existing = repositories.get(key);
    if (!existing)
      repositories.set(key, {
        owner: report.pr.owner,
        repo: report.pr.repo,
        count: 1,
        latest: report,
      });
    else {
      existing.count++;
      if (report.createdAt > existing.latest.createdAt)
        existing.latest = report;
    }
  }
  return {
    total: reports.length,
    live: reports.filter((report) => report.mode === "LIVE").length,
    demo: reports.filter((report) => report.mode === "DEMO").length,
    repositories: [...repositories.values()].sort((a, b) =>
      b.latest.createdAt.localeCompare(a.latest.createdAt),
    ),
  };
}

/** Only configuration presence and fixed enums leave this server-side boundary. */
export function integrationSummary(
  env: Readonly<Record<string, string | undefined>>,
) {
  const present = (key: string) => !!env[key]?.trim();
  const choice = env.SANDBOX_PROVIDER;
  const provider: "docker" | "native" | "nebius" | "disabled" =
    choice === "docker" || choice === "native" || choice === "nebius"
      ? choice
      : !choice && env.ENABLE_LOCAL_SANDBOX === "true"
        ? "native"
        : "disabled";
  const remote = provider === "nebius";
  const executionEnabled =
    (remote ? env.ENABLE_NEBIUS_SANDBOX : env.ENABLE_LOCAL_SANDBOX) === "true";
  const allowlistPresent = !!(
    remote ? env.NEBIUS_SANDBOX_REPOSITORIES : env.LOCAL_SANDBOX_REPOSITORIES
  )
    ?.split(",")
    .some((value) => value.trim());
  const environmentPermitsExecution =
    env.NODE_ENV === "development" ||
    (env.NODE_ENV === "production" &&
      (provider === "docker" || remote) &&
      env.ENABLE_PRODUCTION_SANDBOX === "true");
  const sandboxCredentialsPresent = [
    "NEBIUS_SANDBOX_TOKEN",
    "NEBIUS_SANDBOX_PROJECT_ID",
    "NEBIUS_SANDBOX_IMAGE",
  ].every(present);
  return {
    githubTokenPresent: present("GITHUB_TOKEN"),
    aiKeyPresent: present("NEBIUS_API_KEY"),
    aiModelPresent: present("NEBIUS_MODEL"),
    provider,
    executionEnabled,
    allowlistPresent,
    environmentPermitsExecution,
    sandboxCredentialsPresent,
    executionConfigured:
      provider !== "disabled" &&
      executionEnabled &&
      allowlistPresent &&
      environmentPermitsExecution &&
      (!remote || sandboxCredentialsPresent),
  };
}
