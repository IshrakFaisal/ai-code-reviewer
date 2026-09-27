import { z } from "zod";
export const requestSchema = z.object({
  input: z.string().trim().min(1).max(300),
  prNumber: z.coerce.number().int().positive().max(2147483647).optional(),
  demo: z.boolean().optional(),
});
export function parseGitHubInput(input: string, prNumber?: number) {
  let parts: string[];
  const value = input.trim();
  if (value.startsWith("https://")) {
    const url = new URL(value);
    if (
      url.hostname !== "github.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        "Use a public github.com repository or pull request URL without query parameters.",
      );
    parts = url.pathname.replace(/\/$/, "").slice(1).split("/");
  } else parts = value.split("/");
  if (parts.length !== 2 && parts.length !== 4)
    throw new Error(
      "Enter OWNER/REPO and a PR number, or https://github.com/OWNER/REPO/pull/123.",
    );
  const [owner, repo] = parts;
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner) ||
    !/^[A-Za-z0-9_.-]{1,100}$/.test(repo) ||
    repo === "." ||
    repo === ".."
  )
    throw new Error("Invalid GitHub owner or repository name.");
  if (
    parts.length === 4 &&
    (parts[2] !== "pull" || !/^[1-9]\d*$/.test(parts[3]))
  )
    throw new Error("The URL must point to a GitHub pull request.");
  const number = parts.length === 4 ? Number(parts[3]) : prNumber;
  if (
    !number ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    number > 2147483647
  )
    throw new Error("Enter a valid pull request number.");
  return { owner, repo, number };
}
