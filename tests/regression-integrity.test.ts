import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { sha256 } from "@/lib/regression/evidence";
import {
  assertionRows,
  compareRevisions,
  comparisonExplanation,
} from "@/lib/regression/comparison";
import {
  regressionResultSchema,
  matchesRegressionScope,
  regressionMessageSchema,
} from "@/lib/regression/schema";
import { validateRegression } from "@/lib/regression/integrity";
import { regressionKey, regressionStore } from "@/lib/regression/store";
import type { RegressionResult, RevisionResult } from "@/lib/regression/types";
import type { AnalysisReport, Finding } from "@/lib/types";
function sample(): RegressionResult {
  const revision = (sha: string, passed: boolean): RevisionResult => ({
    revision: sha,
    environmentHash: sha256("same image and dependencies"),
    checks: [],
    runs: [1, 2].map(() => ({
      status: passed ? "PASS" : "FAIL",
      durationMs: 20,
      output: "recorded test output",
      assertions: [
        { name: "rejects token reuse", status: passed ? "PASS" : "FAIL" },
      ],
    })),
  });
  const code =
    'import {it,expect} from "vitest"; it("rejects token reuse",()=>expect(true).toBe(true));';
  return {
    version: 1,
    id: "11111111-1111-1111-1111-111111111111",
    reportId: "22222222-2222-2222-2222-222222222222",
    findingId: "finding-1",
    mode: "LIVE",
    provider: "docker",
    createdAt: new Date().toISOString(),
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    test: {
      filename: "regression.test.ts",
      code,
      sha256: sha256(code),
      framework: "vitest",
    },
    base: revision("a".repeat(40), true),
    head: revision("b".repeat(40), false),
    verdict: "REGRESSION_REPRODUCED",
    limitations: ["Test scope only"],
    events: [],
  };
}
function repaired(): RegressionResult {
  const value = sample();
  value.repair = {
    status: "VALIDATED_FOR_TEST",
    provider: "Nebius",
    proposal: {
      explanation: "Consume token",
      files: [
        {
          path: "src/auth.ts",
          before: "before",
          after: "after",
          originalHash: sha256("before"),
        },
      ],
    },
    result: {
      ...structuredClone(value.base),
      revision: value.headSha,
      checks: ["Before repair", "After repair"].flatMap((phase) =>
        ["Build", "TypeScript", "Existing tests"].map((name) => ({
          name: `${phase} · ${name}`,
          status: "PASS" as const,
          output: "ok",
        })),
      ),
    },
  };
  return value;
}
describe("stored regression evidence validation", () => {
  it("accepts valid results and scoped validated repairs", () => {
    expect(validateRegression(sample())).not.toBeNull();
    expect(validateRegression(repaired())).not.toBeNull();
  });
  it("rejects malformed shapes before the UI can render them", () => {
    expect(
      regressionResultSchema.safeParse({ version: 1, events: null }).success,
    ).toBe(false);
    const value = sample();
    value.events = [{ label: "Invalid timestamp", at: "tomorrow" }];
    expect(validateRegression(value)).toBeNull();
    expect(
      regressionMessageSchema.safeParse({
        type: "complete",
        result: { version: 1 },
      }).success,
    ).toBe(false);
  });
  it("rejects changed test content, mismatched revisions and unsupported live provenance", () => {
    const value = sample();
    value.test.code += "tampered";
    expect(validateRegression(value)).toBeNull();
    const other = sample();
    other.base.revision = other.headSha;
    expect(validateRegression(other)).toBeNull();
    const fixture = sample();
    fixture.fixtureSources = { base: "a", head: "b", repaired: "c" };
    expect(validateRegression(fixture)).toBeNull();
  });
  it("rejects overstated verdicts and accepts conservative inconclusive evidence", () => {
    const value = sample();
    value.head.environmentHash = sha256("other environment");
    expect(validateRegression(value)).toBeNull();
    value.verdict = "INCONCLUSIVE";
    expect(validateRegression(value)).not.toBeNull();
  });
  it("rejects a claimed repair with missing checks or changed assertions", () => {
    const value = repaired();
    value.repair!.result!.checks.pop();
    expect(validateRegression(value)).toBeNull();
    const other = repaired();
    other.repair!.result!.runs.forEach(
      (run) => (run.assertions[0].name = "different assertion"),
    );
    expect(validateRegression(other)).toBeNull();
  });
  it("rejects unsafe repair paths and incorrect original source hashes", () => {
    const value = repaired();
    value.repair!.proposal!.files[0].path = "package.json";
    expect(validateRegression(value)).toBeNull();
    const other = repaired();
    other.repair!.proposal!.files[0].before = "modified";
    expect(validateRegression(other)).toBeNull();
  });
  it("matches the active finding, commits, mode and live test source", () => {
    const value = sample();
    const report = {
      id: value.reportId,
      mode: "LIVE",
      pr: { baseSha: value.baseSha, headSha: value.headSha },
    } as AnalysisReport;
    const finding = {
      id: "finding-1",
      generatedTest: { code: value.test.code },
    } as Finding;
    expect(matchesRegressionScope(value, report, finding)).toBe(true);
    expect(
      matchesRegressionScope(value, report, { ...finding, id: "finding-2" }),
    ).toBe(false);
    expect(
      matchesRegressionScope(value, { ...report, mode: "DEMO" }, finding),
    ).toBe(false);
    expect(
      matchesRegressionScope(value, report, {
        ...finding,
        generatedTest: { ...finding.generatedTest!, code: "changed" },
      }),
    ).toBe(false);
  });
  it("recovers from corrupt files and refuses invalid overwrites", async () => {
    const parent = path.resolve(os.tmpdir()),
      directory = await mkdtemp(path.join(parent, "verifier-integrity-"));
    try {
      const store = regressionStore(directory),
        value = sample(),
        filename = path.join(
          directory,
          `${regressionKey(value.reportId, value.findingId)}.json`,
        );
      await store.save(value);
      const saved = await readFile(filename, "utf8");
      await expect(
        store.save({ ...value, test: { ...value.test, code: "tampered" } }),
      ).rejects.toThrow("previous saved result");
      expect(await readFile(filename, "utf8")).toBe(saved);
      await writeFile(filename, '{"version":1,"events":null}');
      const loaded = await store.load(value.reportId, value.findingId);
      expect(loaded.result).toBeNull();
      expect(loaded.issue).toContain("integrity");
      await writeFile(filename, '{"broken"');
      expect(
        (await store.load(value.reportId, value.findingId)).issue,
      ).toContain("could not be read");
      await writeFile(filename, "x".repeat(1_500_001));
      expect(
        (await store.load(value.reportId, value.findingId)).issue,
      ).toContain("too large");
    } finally {
      if (path.dirname(path.resolve(directory)) !== parent)
        throw new Error("Invalid test cleanup target");
      await rm(directory, { recursive: true, force: true });
    }
  });
});
describe("readable assertion comparison", () => {
  it("shows repeated base/head/repair outcomes side by side", () => {
    expect(assertionRows(repaired())).toEqual([
      {
        name: "rejects token reuse",
        base: "PASS",
        head: "FAIL",
        repair: "PASS",
      },
    ]);
  });
  it("keeps unstable, missing and incomplete assertions visible", () => {
    const value = sample();
    value.head.runs[1].assertions[0].status = "PASS";
    expect(assertionRows(value)[0].head).toBe("UNSTABLE");
    value.head.runs[1].assertions = [];
    expect(assertionRows(value)[0].head).toBe("INCONCLUSIVE");
    value.head.runs = [];
    expect(assertionRows(value)[0].head).toBe("NOT_RECORDED");
  });
  it("does not confuse different test names containing newline characters", () => {
    const value = sample();
    value.base.runs.forEach(
      (run) =>
        (run.assertions = [
          { name: "a\nb", status: "PASS" },
          { name: "c", status: "PASS" },
        ]),
    );
    value.head.runs.forEach(
      (run) =>
        (run.assertions = [
          { name: "a", status: "FAIL" },
          { name: "b\nc", status: "FAIL" },
        ]),
    );
    expect(compareRevisions(value.base, value.head)).toBe("INCONCLUSIVE");
  });
  it("explains environment mismatches and incomplete evidence", () => {
    const value = sample();
    value.verdict = "INCONCLUSIVE";
    value.head.environmentHash = sha256("other");
    expect(comparisonExplanation(value).reason).toContain(
      "fingerprints differ",
    );
    value.head.error = "Dependency installation failed";
    expect(comparisonExplanation(value).reason).toBe(
      "Dependency installation failed",
    );
  });
});
