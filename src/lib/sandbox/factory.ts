import { DockerSandboxProvider } from "./docker";
import { LocalSandboxProvider } from "./local";
import type { SandboxProvider } from "./provider";

export function selectedSandboxProvider(): "docker" | "native" | "disabled" {
  const value = process.env.SANDBOX_PROVIDER;
  if (value === "docker" || value === "native") return value;
  // Preserve the existing explicitly enabled trusted development configuration.
  if (!value && process.env.ENABLE_LOCAL_SANDBOX === "true") return "native";
  return "disabled";
}

export function sandboxAllowed(repository: string) {
  const provider = selectedSandboxProvider();
  const trusted = (process.env.LOCAL_SANDBOX_REPOSITORIES || "")
    .split(",").map((value) => value.trim().toLowerCase()).includes(repository.toLowerCase());
  return process.env.ENABLE_LOCAL_SANDBOX === "true" && trusted &&
    (process.env.NODE_ENV === "development" ||
      (provider === "docker" && process.env.NODE_ENV === "production" && process.env.ENABLE_PRODUCTION_SANDBOX === "true"));
}

export function createSandboxProvider(repository: string, signal?: AbortSignal): SandboxProvider {
  const provider = selectedSandboxProvider();
  if (provider === "disabled")
    throw new Error("Execution is disabled. Configure SANDBOX_PROVIDER=docker, ENABLE_LOCAL_SANDBOX=true and an exact LOCAL_SANDBOX_REPOSITORIES allowlist.");
  if (!sandboxAllowed(repository))
    throw new Error("Execution requires an explicitly allowed repository and development mode (or Docker with ENABLE_PRODUCTION_SANDBOX=true in an authenticated deployment).");
  return provider === "docker"
    ? new DockerSandboxProvider(repository, signal)
    : new LocalSandboxProvider(repository, signal);
}
