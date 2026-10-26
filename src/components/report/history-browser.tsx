"use client";

import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { ReportList } from "./report-list";
import { Button } from "@/components/ui/button";
import {
  filterReports,
  historyFiltersFromParams,
  historyFilterHref,
  defaultHistoryFilters,
  type HistoryFilters,
  type ReportSummary,
} from "@/lib/reports/history";

export function HistoryBrowser({ reports }: { reports: ReportSummary[] }) {
  const params = useSearchParams();
  const filters = historyFiltersFromParams(params);
  const setFilters = (next: HistoryFilters, replace = false) => {
    const href = historyFilterHref(next, window.location.search);
    if (href !== window.location.pathname + window.location.search) {
      if (replace) window.history.replaceState(null, "", href);
      else window.history.pushState(null, "", href);
    }
  };
  const visible = filterReports(reports, filters);
  const filtered =
    filters.query !== "" ||
    filters.mode !== "ALL" ||
    filters.priority !== "ALL";
  return (
    <>
      <div
        className="history-filters"
        role="search"
        aria-label="Search saved analyses"
      >
        <label className="history-search">
          <span>Search analyses</span>
          <div>
            <Search size={16} />
            <input
              type="search"
              placeholder="Repository, title, PR number, or commit"
              maxLength={300}
              value={filters.query}
              onChange={(event) =>
                setFilters({ ...filters, query: event.target.value }, true)
              }
            />
          </div>
        </label>
        <label>
          <span>Analysis mode</span>
          <select
            value={filters.mode}
            onChange={(event) =>
              setFilters({
                ...filters,
                mode: event.target.value as HistoryFilters["mode"],
              })
            }
          >
            <option value="ALL">All modes</option>
            <option value="LIVE">Live</option>
            <option value="DEMO">Demo</option>
          </select>
        </label>
        <label>
          <span>Finding priority</span>
          <select
            value={filters.priority}
            onChange={(event) =>
              setFilters({
                ...filters,
                priority: event.target.value as HistoryFilters["priority"],
              })
            }
          >
            <option value="ALL">All priorities</option>
            <option value="HIGH">Has high findings</option>
            <option value="NO_HIGH">No high findings</option>
          </select>
        </label>
      </div>
      <div className="list-toolbar">
        <span role="status">
          <strong>{visible.length}</strong> of {reports.length}{" "}
          {reports.length === 1 ? "report" : "reports"}
        </span>
        {filtered ? (
          <Button
            variant="ghost"
            size="small"
            onClick={() => setFilters(defaultHistoryFilters)}
          >
            Clear filters
          </Button>
        ) : (
          <span>Most recent first · Up to 100 retained locally</span>
        )}
      </div>
      {visible.length ? (
        <ReportList reports={visible} />
      ) : (
        <div className="panel empty-state">
          <Search size={26} />
          <h2>No matching analyses</h2>
          <p>Try another repository, PR number, or filter.</p>
          <Button
            variant="outline"
            onClick={() => setFilters(defaultHistoryFilters)}
          >
            Clear filters
          </Button>
        </div>
      )}
    </>
  );
}
