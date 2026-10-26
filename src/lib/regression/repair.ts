import { z } from "zod";
import { validateRelativePath } from "@/lib/sandbox/commands";
import { sha256 } from "./evidence";
import type { RepairProposal } from "./types";

export const repairSchema = z
  .object({
    explanation: z.string().min(1).max(2000),
    files: z
      .array(
        z
          .object({
            path: z.string().min(1).max(300),
            content: z.string().min(1).max(24000),
          })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict();
export function validateRepairPath(path: string) {
  validateRelativePath(path);
  if (
    !/^[a-zA-Z0-9_/-]+\.(?:ts|tsx|js|jsx)$/.test(path) ||
    path
      .split("/")
      .some((p) =>
        /^(?:node_modules|tests?|__tests__|fixtures?|__fixtures__|scripts|dist|build|coverage)$/i.test(
          p,
        ),
      ) ||
    /(?:^|[/.\-])(?:test|spec|config|setup|lock)(?:[/.\-]|$)/i.test(path) ||
    /\.d\.ts$/.test(path)
  )
    throw new Error(
      "Repairs are limited to existing application source files; tests, scripts, and configuration cannot be changed.",
    );
}
export function groundRepair(
  raw: unknown,
  originals: { path: string; content: string }[],
): RepairProposal {
  const parsed = repairSchema.parse(raw);
  const seen = new Set<string>();
  const files = parsed.files.map((file) => {
    validateRepairPath(file.path);
    const before = originals.find(
      (source) => source.path === file.path,
    )?.content;
    if (before === undefined || seen.has(file.path))
      throw new Error("Repair references an unapproved or duplicate file.");
    seen.add(file.path);
    if (
      Buffer.byteLength(file.content) > 24000 ||
      !file.content.trim() ||
      before === file.content
    )
      throw new Error("Repair must contain a bounded, nonempty source change.");
    return {
      path: file.path,
      originalHash: sha256(before),
      before,
      after: file.content,
    };
  });
  return { explanation: parsed.explanation, files };
}
