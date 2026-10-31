import { describe, it, expect } from "vitest";
import {
  historyFiltersFromParams,
  historyFilterHref,
  defaultHistoryFilters,
  browseReports,
  type ReportSummary,
} from "@/lib/reports/history";
describe("history filters survive navigation", () => {
  it("round-trips search, mode and priority in a shareable URL", () => {
    const filters = {
      ...defaultHistoryFilters,
      query: "owner/repo #42 café",
      mode: "LIVE",
      priority: "HIGH",
      sort: "PRIORITY",
      runs: "LATEST",
    } as const;
    const href = historyFilterHref(filters);
    expect(href).toContain("mode=LIVE");
    expect(
      historyFiltersFromParams(new URL(href, "http://localhost").searchParams),
    ).toEqual(filters);
  });
  it("clears only filter keys and preserves unrelated parameters", () => {
    expect(
      historyFilterHref(
        defaultHistoryFilters,
        "?q=old&mode=DEMO&priority=HIGH&sort=OLDEST&runs=LATEST&from=workspace",
      ),
    ).toBe("/history?from=workspace");
    expect(historyFilterHref(defaultHistoryFilters)).toBe("/history");
  });
  it("uses safe defaults for invalid or duplicate parameters", () => {
    expect(
      historyFiltersFromParams(
        new URLSearchParams(
          "mode=other&priority=other&q=first&q=second&sort=other&runs=other",
        ),
      ),
    ).toEqual(defaultHistoryFilters);
    expect(
      historyFiltersFromParams(new URLSearchParams("mode=LIVE&mode=DEMO")),
    ).toEqual(defaultHistoryFilters);
  });
  it("bounds search length and safely encodes input", () => {
    const href = historyFilterHref({
      ...defaultHistoryFilters,
      query: "x".repeat(400),
    });
    expect(
      historyFiltersFromParams(new URL(href, "http://localhost").searchParams)
        .query,
    ).toHaveLength(300);
    const query = "repo&mode=DEMO";
    expect(
      historyFiltersFromParams(
        new URL(
          historyFilterHref({ ...defaultHistoryFilters, query }),
          "http://localhost",
        ).searchParams,
      ),
    ).toEqual({ ...defaultHistoryFilters, query });
  });
});

function run(id: string, day: number, highFindings = 0): ReportSummary {
  return {
    id,
    createdAt: `2026-10-${day}T00:00:00Z`,
    mode: "LIVE",
    highFindings,
    pr: {
      owner: "acme",
      repo: "platform",
      number: 42,
      title: "Token handling",
      headSha: id,
    },
  };
}

describe("history ordering and latest-run selection", () => {
  it("sorts unsorted history by date or priority without changing the input", () => {
    const old = run("old", 20, 4),
      recent = run("recent", 22, 1),
      middle = run("middle", 21, 4);
    const reports = [old, recent, middle];
    expect(browseReports(reports, defaultHistoryFilters)).toEqual([
      recent,
      middle,
      old,
    ]);
    expect(
      browseReports(reports, { ...defaultHistoryFilters, sort: "OLDEST" }),
    ).toEqual([old, middle, recent]);
    expect(
      browseReports(reports, { ...defaultHistoryFilters, sort: "PRIORITY" }),
    ).toEqual([middle, old, recent]);
    expect(reports).toEqual([old, recent, middle]);
  });

  it("selects latest runs before searching or filtering priority", () => {
    const old = run("old", 20, 4),
      recent = run("recent", 22);
    old.pr.title = "Old title";
    const filters = { ...defaultHistoryFilters, runs: "LATEST" as const };
    expect(browseReports([old, recent], filters)).toEqual([recent]);
    expect(
      browseReports([old, recent], { ...filters, priority: "HIGH" }),
    ).toEqual([]);
    expect(
      browseReports([old, recent], { ...filters, query: "Old title" }),
    ).toEqual([]);
    expect(
      browseReports([old, recent], {
        ...filters,
        runs: "ALL",
        query: "Old title",
      }),
    ).toEqual([old]);
  });

  it("groups repository names case-insensitively while keeping PRs and modes separate", () => {
    const old = run("old", 20),
      recent = run("recent", 22);
    recent.pr.owner = "ACME";
    recent.pr.repo = "Platform";
    const demo = { ...old, id: "demo", mode: "DEMO" as const };
    const otherPr = { ...old, id: "other-pr", pr: { ...old.pr, number: 43 } };
    const otherRepo = {
      ...old,
      id: "other-repo",
      pr: { ...old.pr, repo: "another" },
    };
    const filters = { ...defaultHistoryFilters, runs: "LATEST" as const };
    expect(
      browseReports([old, recent, demo, otherPr, otherRepo], filters),
    ).toEqual([recent, demo, otherPr, otherRepo]);
    expect(
      browseReports([old, recent, demo], { ...filters, mode: "DEMO" }),
    ).toEqual([demo]);
  });

  it("handles ties deterministically and ignores invalid dates when choosing the latest", () => {
    const a = run("a", 22),
      b = run("b", 22),
      invalid = { ...run("invalid", 23), createdAt: "invalid" };
    const filters = { ...defaultHistoryFilters, runs: "LATEST" as const };
    expect(browseReports([b, invalid, a], filters)).toEqual([a]);
    expect(browseReports([a, b, invalid], filters)).toEqual([a]);
    expect(browseReports([], filters)).toEqual([]);
    expect(
      historyFiltersFromParams(
        new URLSearchParams("sort=OLDEST&sort=PRIORITY&runs=LATEST&runs=ALL"),
      ),
    ).toEqual(defaultHistoryFilters);
  });
});
