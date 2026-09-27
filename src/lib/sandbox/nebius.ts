import type { SandboxProvider } from "./provider";
/** Extension boundary, deliberately no invented remote SDK or endpoint. */
export function createNebiusSandbox(): SandboxProvider {
  throw new Error(
    "Nebius sandbox is not configured. Connect a ConTree instance through a server-side adapter; see docs/INTEGRATIONS.md. Inference credentials alone do not configure execution.",
  );
}
