import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  samplePullRequest,
  sampleHypotheses,
} from "@/lib/demo/sample-analysis";
import type { AnalysisReport, Finding } from "@/lib/types";
import type { SandboxProvider } from "@/lib/sandbox/provider";
import type { RevisionResult } from "@/lib/regression/types";
import {
  compareRevisions,
  parseRegressionRun,
  sha256,
} from "@/lib/regression/evidence";
import { groundRepair, validateRepairPath } from "@/lib/regression/repair";
import { repairDiff } from "@/lib/regression/patch";
import { reproductionBundle } from "@/lib/regression/bundle";
import { reproduce, repairAndRecheck } from "@/lib/regression/workflow";
import { regressionKey, regressionStore } from "@/lib/regression/store";

afterEach(() => vi.unstubAllEnvs());
const filename = "one.test.ts";
function command(passed = true, name = "rejects token reuse", file = filename) {
  return {
    exitCode: passed ? 0 : 1,
    timedOut: false,
    durationMs: 2,
    output: JSON.stringify({
      success: passed,
      numTotalTests: 1,
      numPassedTests: passed ? 1 : 0,
      numFailedTests: passed ? 0 : 1,
      testResults: [
        {
          name: `/repo/.change-verifier/${file}`,
          assertionResults: [
            {
              fullName: name,
              status: passed ? "passed" : "failed",
              failureMessages: passed
                ? []
                : ["AssertionError: expected 200 to equal 400"],
            },
          ],
        },
      ],
    }),
  };
}
const run = (passed = true) => parseRegressionRun(command(passed), filename);
function revision(passed = true, sha = "a".repeat(40)): RevisionResult {
  return {
    revision: sha,
    environmentHash: "same",
    runs: [run(passed), run(passed)],
    checks: [],
  };
}
function reportAndFinding() {
  const finding: Finding = {
    ...sampleHypotheses[0],
    id: "finding-1",
    status: "UNVERIFIED_RISK",
    severity: "HIGH",
    riskScore: 80,
    evidence: [],
    generatedTest: {
      filename: "one.test.ts",
      code: 'import { expect,it } from "vitest"; it("rejects token reuse",()=>expect(true).toBe(true));',
      strategy: "Check reuse",
      framework: "vitest",
    },
  };
  const report = {
    id: "11111111-1111-1111-1111-111111111111",
    mode: "LIVE",
    pr: samplePullRequest(),
    findings: [finding],
  } as AnalysisReport;
  return { report, finding };
}
function fakeProvider(
  options: {
    baseFail?: boolean;
    headPass?: boolean;
    unstable?: boolean;
    installFail?: boolean;
    environmentMismatch?: boolean;
    testMutation?: boolean;
    checkFail?: boolean;
    missingCheck?: boolean;
    cleanupFail?: boolean;
  } = {},
) {
  const instances: Fake[] = [];
  class Fake implements SandboxProvider {
    sha = "";
    patched = false;
    count = 0;
    destroyed = false;
    files: Record<string, string> = {
      "package.json": '{"devDependencies":{"vitest":"3.2.0"}}',
      "package-lock.json": "{}",
      "node_modules/vitest/package.json": '{"version":"3.2.0"}',
      "src/auth/reset.ts": "export const value=0;\n",
      "src/auth/token.ts": "export const token=0;\n",
    };
    replacements: { path: string; hash: string; content: string }[] = [];
    async createSandbox() {}
    async cloneRepository() {}
    async checkoutPullRequest(pr: AnalysisReport["pr"]) {
      this.sha = pr.headSha;
    }
    async installDependencies() {
      return { ...command(), exitCode: options.installFail ? 1 : 0 };
    }
    async readFile(relative: string) {
      if (this.files[relative] === undefined)
        throw Object.assign(new Error("absent"), { code: "ENOENT" });
      return this.files[relative];
    }
    async writeFile(relative: string, code: string) {
      this.files[relative] = code;
    }
    async runtimeIdentity() {
      return options.environmentMismatch && this.sha.startsWith("b")
        ? "different"
        : "same";
    }
    async replaceSource(relative: string, hash: string, content: string) {
      expect(sha256(this.files[relative])).toBe(hash);
      this.replacements.push({ path: relative, hash, content });
      this.files[relative] = content;
      this.patched = true;
    }
    async runCommand(type: string, file?: string) {
      if (type !== "generated") {
        if (options.missingCheck) throw new Error("No script is available.");
        return {
          ...command(),
          exitCode: options.checkFail && this.patched ? 1 : 0,
        };
      }
      this.count++;
      if (options.testMutation)
        this.files[`.change-verifier/${file}`] = "tampered";
      let passed =
        this.patched ||
        (this.sha.startsWith("a") ? !options.baseFail : !!options.headPass);
      if (options.unstable && this.count === 2) passed = !passed;
      return command(passed, "rejects token reuse", file);
    }
    async destroySandbox() {
      this.destroyed = true;
      if (options.cleanupFail) throw new Error("cannot remove");
    }
  }
  return {
    instances,
    sandbox: () => {
      const instance = new Fake();
      instances.push(instance);
      return instance;
    },
  };
}
describe("paired execution evidence", () => {
  it("requires real completed assertion results", () => {
    expect(run().status).toBe("PASS");
    expect(run(false).status).toBe("FAIL");
    expect(
      parseRegressionRun({ ...command(), output: "SyntaxError" }, filename)
        .status,
    ).toBe("INCONCLUSIVE");
    expect(
      parseRegressionRun({ ...command(), timedOut: true }, filename).status,
    ).toBe("INCONCLUSIVE");
    expect(
      parseRegressionRun(command(true, "test", "other.test.ts"), filename)
        .status,
    ).toBe("INCONCLUSIVE");
  });
  it.each([
    "numTotalTests",
    "numPassedTests",
    "numPendingTests",
    "numRuntimeErrorTestSuites",
  ])("rejects inconsistent %s", (key) => {
    const raw = command();
    const data = JSON.parse(raw.output);
    data[key] = 10;
    raw.output = JSON.stringify(data);
    expect(parseRegressionRun(raw, filename).status).toBe("INCONCLUSIVE");
  });
  it("rejects runtime exceptions labeled as failed tests", () => {
    const raw = command(false);
    const data = JSON.parse(raw.output);
    data.testResults[0].assertionResults[0].failureMessages = [
      "TypeError: cannot read property",
    ];
    raw.output = JSON.stringify(data);
    expect(parseRegressionRun(raw, filename).status).toBe("INCONCLUSIVE");
  });
  it.each([
    [true, false, "REGRESSION_REPRODUCED"],
    [true, true, "NO_REGRESSION_OBSERVED"],
    [false, false, "PRE_EXISTING_FAILURE"],
    [false, true, "IMPROVEMENT_OBSERVED"],
  ] as const)("compares base=%s and head=%s", (base, head, verdict) =>
    expect(
      compareRevisions(revision(base), revision(head, "b".repeat(40))),
    ).toBe(verdict),
  );
  it("refuses changed assertions, flaky repeats, environments, and identical revisions", () => {
    const base = revision(),
      head = revision(false, "b".repeat(40));
    head.runs[1] = run();
    expect(compareRevisions(base, head)).toBe("INCONCLUSIVE");
    head.runs = [run(false), run(false)];
    head.environmentHash = "other";
    expect(compareRevisions(base, head)).toBe("INCONCLUSIVE");
    head.environmentHash = "same";
    head.runs.forEach((r) => (r.assertions[0].name = "a different test"));
    expect(compareRevisions(base, head)).toBe("INCONCLUSIVE");
    expect(compareRevisions(base, revision(false))).toBe("INCONCLUSIVE");
  });
});
describe("isolated regression workflow", () => {
  it("pins separate commits, repeats the unchanged test, and always cleans up", async () => {
    const { report, finding } = reportAndFinding(),
      fake = fakeProvider();
    const result = await reproduce(report, finding, () => {}, undefined, fake);
    expect(result.verdict).toBe("REGRESSION_REPRODUCED");
    expect(result.test.sha256).toBe(sha256(finding.generatedTest!.code));
    expect(fake.instances.map((i) => i.sha).sort()).toEqual([
      report.pr.baseSha,
      report.pr.headSha,
    ]);
    for (const instance of fake.instances) {
      expect(instance.count).toBe(2);
      expect(instance.destroyed).toBe(true);
      expect(
        Object.entries(instance.files)
          .filter(([p]) => p.endsWith(".test.ts"))
          .every(([, code]) => code === finding.generatedTest!.code),
      ).toBe(true);
    }
  });
  it.each([
    { unstable: true },
    { installFail: true },
    { environmentMismatch: true },
    { testMutation: true },
    { cleanupFail: true },
  ])("keeps failed prerequisites inconclusive: %s", async (options) => {
    const { report, finding } = reportAndFinding(),
      fake = fakeProvider(options);
    const result = await reproduce(report, finding, () => {}, undefined, fake);
    expect(result.verdict).toBe("INCONCLUSIVE");
    expect(fake.instances.every((i) => i.destroyed)).toBe(true);
  });
  it("validates a bounded source repair while preserving the original evidence", async () => {
    const { report, finding } = reportAndFinding(),
      fake = fakeProvider();
    const previous = await reproduce(
      report,
      finding,
      () => {},
      undefined,
      fake,
    );
    const snapshot = JSON.stringify(previous);
    const result = await repairAndRecheck(
      report,
      finding,
      previous,
      () => {},
      undefined,
      {
        ...fake,
        propose: async () => ({
          explanation: "Consume token",
          files: [
            { path: "src/auth/reset.ts", content: "export const value=1;\n" },
          ],
        }),
      },
    );
    expect(result.repair?.status).toBe("VALIDATED_FOR_TEST");
    expect(result.repair?.result?.checks).toHaveLength(6);
    expect(result.repair?.result?.runs).toHaveLength(2);
    expect(JSON.stringify(previous)).toBe(snapshot);
    expect(fake.instances.at(-1)?.replacements).toHaveLength(1);
    expect(fake.instances.at(-1)?.destroyed).toBe(true);
  });
  it.each([{ checkFail: true }, { missingCheck: true }])(
    "does not validate a repair with failed or missing required checks: %s",
    async (options) => {
      const { report, finding } = reportAndFinding(),
        fake = fakeProvider(options);
      const previous = await reproduce(
        report,
        finding,
        () => {},
        undefined,
        fake,
      );
      const result = await repairAndRecheck(
        report,
        finding,
        previous,
        () => {},
        undefined,
        {
          ...fake,
          propose: async () => ({
            explanation: "Repair",
            files: [
              { path: "src/auth/reset.ts", content: "export const value=1;\n" },
            ],
          }),
        },
      );
      expect(result.repair?.status).not.toBe("VALIDATED_FOR_TEST");
    },
  );
  it("rejects a changed test or stale revisions before repair execution", async () => {
    const { report, finding } = reportAndFinding(),
      fake = fakeProvider();
    const previous = await reproduce(
      report,
      finding,
      () => {},
      undefined,
      fake,
    );
    finding.generatedTest!.code += "\n// changed";
    await expect(
      repairAndRecheck(report, finding, previous, () => {}, undefined, fake),
    ).rejects.toThrow(/current test/);
    expect(fake.instances).toHaveLength(2);
  });
  it("cleans up when repair generation fails", async () => {
    const { report, finding } = reportAndFinding(),
      fake = fakeProvider();
    const previous = await reproduce(
      report,
      finding,
      () => {},
      undefined,
      fake,
    );
    const result = await repairAndRecheck(
      report,
      finding,
      previous,
      () => {},
      undefined,
      {
        ...fake,
        propose: async () => {
          throw new Error("inference unavailable");
        },
      },
    );
    expect(result.repair?.status).toBe("INCONCLUSIVE");
    expect(result.repair?.error).toContain("inference unavailable");
    expect(fake.instances.every((i) => i.destroyed)).toBe(true);
  });
});
describe("repair boundaries and reproducible storage", () => {
  it.each([
    "../src/auth.ts",
    "src/../auth.ts",
    ".env.local",
    "package.json",
    "src/auth.test.ts",
    "tests/auth.ts",
    "scripts/tool.js",
    "vitest.config.ts",
    "src/setup.ts",
    "src/module.d.ts",
    "src/auth\\reset.ts",
  ])("rejects protected path %s", (file) =>
    expect(() => validateRepairPath(file)).toThrow(),
  );
  it("rejects unknown, duplicate, unchanged or empty source replacements", () => {
    const originals = [{ path: "src/auth/reset.ts", content: "before" }],
      file = { path: "src/auth/reset.ts", content: "after" };
    expect(() =>
      groundRepair(
        { explanation: "fix", files: [{ ...file, path: "src/other.ts" }] },
        originals,
      ),
    ).toThrow();
    expect(() =>
      groundRepair({ explanation: "fix", files: [file, file] }, originals),
    ).toThrow();
    expect(() =>
      groundRepair(
        { explanation: "fix", files: [{ ...file, content: "before" }] },
        originals,
      ),
    ).toThrow();
    expect(() =>
      groundRepair({ explanation: "fix", files: [] }, originals),
    ).toThrow();
  });
  it("exports a complete patch including final-newline markers", () => {
    const proposal = groundRepair(
      {
        explanation: "fix",
        files: [{ path: "src/auth/reset.ts", content: "after\n" }],
      },
      [{ path: "src/auth/reset.ts", content: "before" }],
    );
    expect(repairDiff(proposal)).toContain(
      "@@ -1,1 +1,1 @@\n-before\n\\ No newline at end of file\n+after\n",
    );
  });
  it("exports a standalone harness, exact scope and repeat instructions", async () => {
    const { report, finding } = reportAndFinding();
    const result = await reproduce(
      report,
      finding,
      () => {},
      undefined,
      fakeProvider(),
    );
    const bundle = reproductionBundle(result, report.pr);
    expect(bundle.files[".change-verifier/regression.test.ts"]).toBe(
      finding.generatedTest!.code,
    );
    expect(bundle.files[".change-verifier/regression.config.mjs"]).toContain(
      '"requireAssertions":true',
    );
    expect(bundle.files["README.md"]).toContain(report.pr.baseSha);
    expect(bundle.files["README.md"]).toContain(
      "node node_modules/vitest/vitest.mjs",
    );
    expect(JSON.parse(bundle.files["evidence.json"]).verdict).toBe(
      "REGRESSION_REPRODUCED",
    );
    expect(() =>
      reproductionBundle(result, { owner: "owner; rm", repo: "repo" }),
    ).toThrow();
  });
  it("isolates reports/findings and persists the latest result atomically", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "verifier-regression-store-"),
    );
    try {
      const store = regressionStore(directory),
        { report, finding } = reportAndFinding();
      const result = await reproduce(
        report,
        finding,
        () => {},
        undefined,
        fakeProvider(),
      );
      await store.save(result);
      expect(await store.get(report.id, finding.id)).toEqual(result);
      expect(await store.get(report.id, "finding-2")).toBeNull();
      await store.save({ ...result, verdict: "INCONCLUSIVE" });
      expect((await store.get(report.id, finding.id))?.verdict).toBe(
        "INCONCLUSIVE",
      );
      expect(() => regressionKey("../escape", finding.id)).toThrow();
      expect(() => regressionKey(report.id, "../../finding")).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
