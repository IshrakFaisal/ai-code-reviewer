import { afterEach, describe, expect, it, vi } from "vitest";
import { categorize, refineCategories } from "@/lib/analysis/categorizer";
import {
  heuristicBehaviors,
  heuristicHypotheses,
} from "@/lib/analysis/behavioral-change";
import { blastRadius } from "@/lib/analysis/blast-radius";
import { assessRisk } from "@/lib/risk/engine";
import { configuredWeights } from "@/lib/risk/signals";
import { parseDiff } from "@/lib/github/diff";
import { samplePullRequest } from "@/lib/demo/sample-analysis";
import type { ChangedFile } from "@/lib/types";

function file(path: string): ChangedFile {
  const entry = {
    path,
    categories: categorize(path),
    status: "modified",
    additions: 1,
    deletions: 1,
    lines: parseDiff("@@ -1 +1 @@\n-const amount = 10;\n+const amount = 20;"),
  };
  return { ...entry, risk: assessRisk(entry) };
}
afterEach(() => vi.unstubAllEnvs());

describe("payment risk scoring", () => {
  it.each([
    "src/billing/charge.ts",
    "src/payments/refund.ts",
    "src/stripe/client.ts",
    "src/checkout/total.ts",
  ])("includes a small %s change in heuristic review", (path) => {
    const entry = file(path);
    expect(entry.risk).toEqual({
      score: 30,
      level: "MEDIUM",
      reasons: ["Payment or billing behavior changed"],
    });
    const pr = { ...samplePullRequest(), files: [entry], changedFiles: 1 };
    expect(heuristicBehaviors(pr).map((item) => item.files)).toEqual([[path]]);
    expect(heuristicHypotheses(pr, 5)).toMatchObject([
      { category: "PAYMENTS", affectedFiles: [{ path }] },
    ]);
    expect(blastRadius(pr.files)).toMatchObject([
      { category: "PAYMENTS", score: 30, level: "MEDIUM" },
    ]);
  });

  it("combines payment and public API signals once each", () => {
    const entry = file("src/api/payments.ts");
    expect(entry.risk.score).toBe(50);
    expect(entry.risk.level).toBe("HIGH");
    expect(
      assessRisk({ ...entry, categories: [...entry.categories, "PAYMENTS"] }),
    ).toEqual(entry.risk);
  });

  it("adds payment priority for grounded AI categories", () => {
    const original = file("src/logic.ts");
    const [refined] = refineCategories(
      [original],
      [{ path: original.path, categories: ["PAYMENTS"] }],
    );
    expect(original.risk.score).toBe(0);
    expect(assessRisk(refined).score).toBe(30);
  });

  it("keeps payment test files outside production payment scoring", () => {
    const entry = file("tests/billing/charge.test.ts");
    expect(entry.categories).toEqual(["TESTS"]);
    expect(entry.risk.score).toBe(0);
    const [refined] = refineCategories(
      [entry],
      [{ path: entry.path, categories: ["PAYMENTS"] }],
    );
    expect(assessRisk(refined).score).toBe(0);
    expect(assessRisk({ ...entry, status: "removed" }).score).toBe(30);
    expect(assessRisk({ ...entry, status: "removed" }).reasons).toEqual([
      "Test definitions removed; inspect coverage",
    ]);
  });

  it("honors configured payment weights, including explicit zero", () => {
    for (const weight of [0, 12.5, 55, 100]) {
      vi.stubEnv("RISK_WEIGHTS_JSON", JSON.stringify({ payments: weight }));
      expect(
        assessRisk(file("src/billing/charge.ts"), [], configuredWeights())
          .score,
      ).toBe(weight);
    }
    for (const weight of [-1, 101, "50", null]) {
      vi.stubEnv("RISK_WEIGHTS_JSON", JSON.stringify({ payments: weight }));
      expect(configuredWeights().payments).toBe(30);
    }
  });
});
