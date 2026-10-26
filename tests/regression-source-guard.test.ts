import { describe, it, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  link,
  symlink,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { sandboxFileProgram } from "@/lib/sandbox/file-program";
import { runProcess } from "@/lib/sandbox/process";
import { sha256 } from "@/lib/regression/evidence";
describe("actual guarded sandbox source replacement", () => {
  it("replaces matching source but rejects stale hashes, hardlinks, symlinks and protected files", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "verifier-source-guard-"),
    );
    try {
      await mkdir(path.join(root, "src"));
      await writeFile(path.join(root, "src", "auth.ts"), "before");
      await writeFile(path.join(root, "src", "auth.test.ts"), "protected");
      const replace = (
        relative: string,
        content: string,
        hash = sha256("before"),
      ) =>
        runProcess(
          process.execPath,
          ["-e", sandboxFileProgram(root), "replace", relative],
          {
            env: { SystemRoot: process.env.SystemRoot, NODE_ENV: "test" },
            input: JSON.stringify({ expectedSha256: hash, content }),
            timeout: 10000,
          },
        );
      expect(
        (await replace("src/auth.ts", "after", "0".repeat(64))).exitCode,
      ).not.toBe(0);
      expect(await readFile(path.join(root, "src", "auth.ts"), "utf8")).toBe(
        "before",
      );
      expect((await replace("src/auth.ts", "after")).exitCode).toBe(0);
      expect(await readFile(path.join(root, "src", "auth.ts"), "utf8")).toBe(
        "after",
      );
      expect(
        (await replace("src/auth.test.ts", "overwritten", sha256("protected")))
          .exitCode,
      ).not.toBe(0);
      await link(
        path.join(root, "src", "auth.ts"),
        path.join(root, "src", "hard.ts"),
      );
      expect(
        (await replace("src/hard.ts", "new", sha256("after"))).exitCode,
      ).not.toBe(0);
      await symlink(
        path.join(root, "src"),
        path.join(root, "linked"),
        "junction",
      );
      expect(
        (await replace("linked/auth.ts", "new", sha256("after"))).exitCode,
      ).not.toBe(0);
      expect(await readFile(path.join(root, "src", "auth.ts"), "utf8")).toBe(
        "after",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
