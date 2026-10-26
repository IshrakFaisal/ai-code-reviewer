import { describe, it, expect } from "vitest";
import {
  fixtureScenarios,
  executeTrustedFixture,
} from "@/lib/regression/fixtures";
import { compareRevisions } from "@/lib/regression/evidence";
import type { RevisionResult } from "@/lib/regression/types";
describe("five curated regression evaluation cases (not an AI accuracy benchmark)", () => {
  it.each(fixtureScenarios)("$title", async (fixture) => {
    const started = Date.now();
    const revision = async (
      which: "base" | "head",
    ): Promise<RevisionResult> => ({
      revision: (which === "base" ? "a" : "b").repeat(40),
      environmentHash: "trusted-identical-node-fixture",
      runs: [
        await executeTrustedFixture(fixture.id, which),
        await executeTrustedFixture(fixture.id, which),
      ],
      checks: [],
    });
    const base = await revision("base"),
      head = await revision("head");
    const observed = compareRevisions(base, head);
    expect(observed).toBe(fixture.expected);
    if (fixture.expected === "REGRESSION_REPRODUCED") {
      expect((await executeTrustedFixture(fixture.id, "repaired")).status).toBe(
        "PASS",
      );
      expect((await executeTrustedFixture(fixture.id, "repaired")).status).toBe(
        "PASS",
      );
    }
    console.info(
      `${fixture.id}: expected=${fixture.expected}; observed=${observed}; elapsed=${Date.now() - started}ms; source=curated fixture; inference=none`,
    );
  });
});
