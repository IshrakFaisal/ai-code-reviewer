"use client";

import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { ReportList } from "./report-list";
import { Button } from "@/components/ui/button";
import {
  browseReports,
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
  const visible = browseReports(reports, filters);
  const filtered =
    filters.query !== "" ||
    filters.mode !== "ALL" ||
    filters.priority !== "ALL" ||
    filters.runs !== "ALL" ||
    filters.sort !== "NEWEST";
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
      <div className="history-view-options">
        <label>
          <span>Show runs</span>
          <select
            value={filters.runs}
            onChange={(event) =>
              setFilters({
                ...filters,
                runs: event.target.value as HistoryFilters["runs"],
              })
            }
          >
            <option value="ALL">All saved runs</option>
            <option value="LATEST">Latest run per PR and mode</option>
          </select>
        </label>
        <label>
          <span>Sort by</span>
          <select
            value={filters.sort}
            onChange={(event) =>
              setFilters({
                ...filters,
                sort: event.target.value as HistoryFilters["sort"],
              })
            }
          >
            <option value="NEWEST">Newest first</option>
            <option value="OLDEST">Oldest first</option>
            <option value="PRIORITY">Most high-priority findings</option>
          </select>
        </label>
      </div>
      {filters.runs === "LATEST" && (
        <p className="history-view-hint">
          Search and priority filters apply to the latest retained run of each
          PR. Demo and live runs are kept separate. Select all saved runs to
          find older results.
        </p>
      )}
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
            Reset view
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
            Reset view
          </Button>
        </div>
      )}
    </>
  );
}
