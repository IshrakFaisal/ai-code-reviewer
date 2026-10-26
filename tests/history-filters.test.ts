import { describe, it, expect } from "vitest";
import {
  historyFiltersFromParams,
  historyFilterHref,
  defaultHistoryFilters,
} from "@/lib/reports/history";
describe("history filters survive navigation", () => {
  it("round-trips search, mode and priority in a shareable URL", () => {
    const filters = {
      query: "owner/repo #42 café",
      mode: "LIVE",
      priority: "HIGH",
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
        "?q=old&mode=DEMO&priority=HIGH&from=workspace",
      ),
    ).toBe("/history?from=workspace");
    expect(historyFilterHref(defaultHistoryFilters)).toBe("/history");
  });
  it("uses safe defaults for invalid or duplicate parameters", () => {
    expect(
      historyFiltersFromParams(
        new URLSearchParams("mode=other&priority=other&q=first&q=second"),
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
