import { DockerSandboxProvider } from "./docker";
import { LocalSandboxProvider } from "./local";
import { NebiusSandboxProvider } from "./nebius";
import type { SandboxProvider } from "./provider";

export function selectedSandboxProvider():
  "docker" | "native" | "nebius" | "disabled" {
  const value = process.env.SANDBOX_PROVIDER;
  if (value === "docker" || value === "native" || value === "nebius")
    return value;
  // Preserve the existing explicitly enabled trusted development configuration.
  if (!value && process.env.ENABLE_LOCAL_SANDBOX === "true") return "native";
  return "disabled";
}

export function sandboxAllowed(repository: string) {
  const provider = selectedSandboxProvider();
  if (provider === "disabled") return false;
  const remote = provider === "nebius";
  const trusted = (
    (remote
      ? process.env.NEBIUS_SANDBOX_REPOSITORIES
      : process.env.LOCAL_SANDBOX_REPOSITORIES) || ""
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .includes(repository.toLowerCase());
  return (
    (remote
      ? process.env.ENABLE_NEBIUS_SANDBOX
      : process.env.ENABLE_LOCAL_SANDBOX) === "true" &&
    trusted &&
    (process.env.NODE_ENV === "development" ||
      ((provider === "docker" || remote) &&
        process.env.NODE_ENV === "production" &&
        process.env.ENABLE_PRODUCTION_SANDBOX === "true"))
  );
}

export function createSandboxProvider(
  repository: string,
  signal?: AbortSignal,
): SandboxProvider {
  const provider = selectedSandboxProvider();
  if (provider === "disabled")
    throw new Error(
      "Execution is disabled. Configure SANDBOX_PROVIDER=docker or nebius with its explicit enablement and exact repository allowlist; see README.md.",
    );
  if (!sandboxAllowed(repository))
    throw new Error(
      "Execution requires an explicitly allowed repository and development mode (or Docker/Nebius with ENABLE_PRODUCTION_SANDBOX=true in an authenticated deployment).",
    );
  if (provider === "nebius")
    return new NebiusSandboxProvider(repository, signal);
  return provider === "docker"
    ? new DockerSandboxProvider(repository, signal)
    : new LocalSandboxProvider(repository, signal);
}
