import { describe, expect, it } from "vitest";
import { categorize, refineCategories } from "@/lib/analysis/categorizer";
import { assessRisk } from "@/lib/risk/engine";
import type { ChangedFile } from "@/lib/types";

function file(path: string): ChangedFile {
  const entry = {
    path,
    categories: categorize(path),
    status: "modified",
    additions: 1,
    deletions: 1,
    lines: [],
  };
  return { ...entry, risk: assessRisk(entry) };
}

describe("conservative AI category refinement", () => {
  it("adds behavioral categories without removing path-derived risk", () => {
    const original = file("src/auth/session.ts");
    const [refined] = refineCategories(
      [original],
      [{ path: original.path, categories: ["DATABASE"] }],
    );
    expect(refined.categories).toEqual(["AUTHENTICATION", "DATABASE"]);
    expect(assessRisk(refined).score).toBeGreaterThan(original.risk.score);
    expect(original.categories).toEqual(["AUTHENTICATION"]);
  });
  it("replaces UNKNOWN only when there is a concrete inferred category", () => {
    const original = file("src/logic.ts");
    expect(
      refineCategories(
        [original],
        [{ path: original.path, categories: ["PAYMENTS", "UNKNOWN"] }],
      )[0].categories,
    ).toEqual(["PAYMENTS"]);
    expect(
      refineCategories(
        [original],
        [{ path: original.path, categories: ["UNKNOWN"] }],
      )[0].categories,
    ).toEqual(["UNKNOWN"]);
  });
  it("preserves test precedence and refuses AI camouflage of production files", () => {
    const production = file("src/auth/session.ts");
    const test = file("tests/auth.test.ts");
    const result = refineCategories(
      [production, test],
      [
        { path: production.path, categories: ["TESTS"] },
        { path: test.path, categories: ["AUTHENTICATION"] },
      ],
    );
    expect(result.map((entry) => entry.categories)).toEqual([
      ["AUTHENTICATION"],
      ["TESTS"],
    ]);
  });
  it("deduplicates additions and ignores unknown paths", () => {
    const original = file("src/logic.ts");
    const result = refineCategories(
      [original],
      [
        { path: original.path, categories: ["DATABASE", "DATABASE"] },
        { path: original.path, categories: ["DATABASE"] },
        { path: "invented.ts", categories: ["AUTHENTICATION"] },
      ],
    );
    expect(result).toHaveLength(1);
    expect(result[0].categories).toEqual(["DATABASE"]);
  });
});
