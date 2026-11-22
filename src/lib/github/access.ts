import type { RepositoryVisibility } from "@/lib/types";

// Only CLI/Action invocations can supply this capability. Never serialize it.
export type PrivateRepositoryAccess = { allowAI: boolean };
export const privateAiSkipped =
  "AI analysis skipped: private repository without --allow-private-ai";
export const privateTokenRequired =
  "GITHUB_TOKEN is required with --allow-private.";

export function repositoryVisibility(repo: {
  private?: boolean;
  visibility?: string;
}): RepositoryVisibility {
  if (
    repo.visibility &&
    repo.visibility !== "public" &&
    repo.visibility !== "private"
  )
    return "unknown";
  if (repo.private === true || repo.visibility === "private") return "private";
  if (
    repo.private === false &&
    (!repo.visibility || repo.visibility === "public")
  )
    return "public";
  return "unknown";
}

export class RepositoryAccessError extends Error {}

export function requireRepositoryAccess(
  visibility: RepositoryVisibility,
  access?: PrivateRepositoryAccess,
) {
  if (visibility === "public") return;
  if (visibility !== "private" || !access)
    throw new RepositoryAccessError(
      "This MVP analyzes public repositories only.",
    );
  if (!process.env.GITHUB_TOKEN?.trim())
    throw new RepositoryAccessError(privateTokenRequired);
}
