import { describe, it, expect } from "vitest";
import {
  mkdir,
  mkdtemp,
  writeFile,
  readFile,
  symlink,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { generatedPlan } from "@/lib/sandbox/commands";
import { runProcess } from "@/lib/sandbox/process";
import {
  parseRegressionRun,
  compareRevisions,
} from "@/lib/regression/evidence";
import type { RevisionResult } from "@/lib/regression/types";
describe("actual isolated Vitest report compatibility", () => {
  it("recognizes repeated pass/fail assertions from the unchanged test source", async () => {
    const parent = path.resolve(".sandbox");
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(path.join(parent, "verifier-paired-vitest-"));
    try {
      await mkdir(path.join(root, ".change-verifier"));
      await symlink(
        path.resolve("node_modules"),
        path.join(root, "node_modules"),
        process.platform === "win32" ? "junction" : "dir",
      );
      await writeFile(path.join(root, "package.json"), '{"type":"module"}');
      const test =
        'import {expect,it} from "vitest"; import {allowed} from "../subject.mjs"; it("rejects an unauthorized actor",()=>{expect(allowed("alice","mallory")).toBe(false);});';
      const execute = async (
        side: "base" | "head",
      ): Promise<RevisionResult> => {
        await writeFile(
          path.join(root, "subject.mjs"),
          side === "base"
            ? "export const allowed=(owner,actor)=>owner===actor;"
            : "export const allowed=(owner,actor)=>true;",
        );
        const revision: RevisionResult = {
          revision: (side === "base" ? "a" : "b").repeat(40),
          environmentHash: "trusted-shared-vitest-runtime",
          runs: [],
          checks: [],
        };
        for (let repeat = 1; repeat <= 2; repeat++) {
          const filename = `${side}-${repeat}.test.ts`,
            plan = generatedPlan(filename);
          await writeFile(
            path.join(root, `.change-verifier/${filename}`),
            test,
          );
          await writeFile(path.join(root, plan.config), plan.content);
          const result = await runProcess(process.execPath, plan.args, {
            cwd: root,
            env: {
              NODE_ENV: "test",
              SystemRoot: process.env.SystemRoot,
              PATH: process.env.PATH,
            },
            timeout: 15000,
          });
          const output = await readFile(path.join(root, plan.report), "utf8");
          revision.runs.push(
            parseRegressionRun({ ...result, output }, filename),
          );
        }
        return revision;
      };
      const base = await execute("base"),
        head = await execute("head");
      expect(base.runs.map((r) => r.status)).toEqual(["PASS", "PASS"]);
      expect(head.runs.map((r) => r.status)).toEqual(["FAIL", "FAIL"]);
      expect(compareRevisions(base, head)).toBe("REGRESSION_REPRODUCED");
    } finally {
      if (
        path.dirname(path.resolve(root)) !== parent ||
        !path.basename(root).startsWith("verifier-paired-vitest-")
      )
        throw new Error("Invalid fixture cleanup target.");
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);
});
