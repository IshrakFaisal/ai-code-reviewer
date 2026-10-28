"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Download, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AnalysisReport } from "@/lib/types";
import type { RevisionCheck } from "@/lib/reports/freshness";
import {
  buildReviewPlan,
  reviewPlanMarkdown,
  type ReviewAction,
} from "@/lib/reports/review-plan";
import { ReviewDraftActions, type ReviewChecklist } from "./review-checklist";
import { openReportTarget } from "./open-report-target";

export function ReviewPlan({
  report,
  checklist,
  revision,
  onOpenFinding,
}: {
  report: AnalysisReport;
  checklist: ReviewChecklist;
  revision: RevisionCheck | null;
  onOpenFinding: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  const [expanded, setExpanded] = useState(false);
  const [kind, setKind] = useState<ReviewAction["kind"] | "ALL">("ALL");
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const plan = buildReviewPlan(report, checklist.review, revision, now);
  const matchesKind = (action: ReviewAction, value: typeof kind) =>
    value === "ALL" ||
    action.kind === value ||
    (value === "FINDING" && action.kind === "DECISIONS");
  const matching = plan.actions.filter((action) => matchesKind(action, kind));
  const visible = expanded ? matching : matching.slice(0, 5);
  const canExport =
    !!checklist.review && checklist.dirtyCount === 0 && !checklist.savingId;
  function download() {
    if (!checklist.review || !canExport) return;
    const url = URL.createObjectURL(
      new Blob([reviewPlanMarkdown(report, checklist.review, revision)], {
        type: "text/markdown;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `change-verifier-pr-${report.pr.number}-action-plan.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function open(action: { href: string; findingId?: string }) {
    if (action.findingId) onOpenFinding();
    openReportTarget(action.href);
  }
  return (
    <section
      id="review-plan"
      className="review-plan"
      aria-labelledby="review-plan-heading"
    >
      <div className="section-heading">
        <div>
          <h2 id="review-plan-heading">
            <ListChecks size={17} /> Your next review steps
          </h2>
          <p>
            A prioritized plan from saved decisions, evidence gaps, and revision
            scope.
          </p>
        </div>
        <Button
          variant="outline"
          size="small"
          disabled={!canExport}
          onClick={download}
        >
          <Download size={13} />
          Download action plan
        </Button>
      </div>
      <div className="review-plan-metrics">
        <div>
          <strong>{plan.decisionsLoaded ? plan.counts.open : "—"}</strong>
          <span>Awaiting decision</span>
        </div>
        <div>
          <strong>{plan.decisionsLoaded ? plan.counts.needsFix : "—"}</strong>
          <span>Marked needs fix</span>
        </div>
        <div>
          <strong>{plan.counts.failures}</strong>
          <span>
            {report.mode === "DEMO"
              ? "Failed fixture checks"
              : "Failed execution checks"}
          </span>
        </div>
        <div>
          <strong>{plan.counts.highRiskGaps}</strong>
          <span>High-risk execution gaps</span>
        </div>
      </div>
      <p className="review-plan-scope">
        This plan uses the original report’s evidence. Saved reviewer decisions
        do not change test results; newer reproduction and repair results remain
        on their own page.{" "}
        {checklist.dirtyCount > 0
          ? "Save your draft decisions to update the plan and enable export."
          : !checklist.review
            ? checklist.error
              ? "Saved decisions are unavailable. Retry from Your review checklist; decision counts remain unknown."
              : "Loading saved decisions; decision counts are unavailable."
            : "Only saved decisions are included."}
      </p>
      <ReviewDraftActions checklist={checklist} onOpenFinding={onOpenFinding} />
      {checklist.error && checklist.review && (
        <p className="review-error" role="alert">
          {checklist.error} <a href="#human-review">Go to review checklist</a>
        </p>
      )}
      <div
        className="review-plan-filters"
        role="group"
        aria-label="Filter review steps"
      >
        {(
          [
            ["ALL", "All steps"],
            ["FINDING", "Decisions"],
            ["EVIDENCE", "Evidence"],
            ["REVISION", "Revision"],
            ["SCOPE", "Scope"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            onClick={() => {
              setKind(value);
              setExpanded(false);
            }}
          >
            {label}{" "}
            <span>
              {value === "ALL"
                ? plan.actions.length
                : plan.actions.filter((action) => matchesKind(action, value))
                    .length}
            </span>
          </button>
        ))}
      </div>
      <p className="review-plan-result-count" role="status">
        Showing {visible.length} of {matching.length}{" "}
        {kind === "ALL" ? "review" : "matching"} steps. Downloads include the
        full plan.
      </p>
      <ol id="review-plan-actions" className="review-plan-list">
        {visible.map((action) => (
          <li key={action.id}>
            <span
              className={`review-action-kind kind-${action.kind.toLowerCase()}`}
            >
              {action.kind.toLowerCase()}
            </span>
            <div>
              <h3>{action.title}</h3>
              <p>{action.detail}</p>
              {action.targets && (
                <ul className="review-action-targets">
                  {action.targets.map((target) => (
                    <li key={target.href}>
                      <a href={target.href} onClick={() => open(target)}>
                        {target.title}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {action.href.startsWith("#") ? (
              <a
                className="review-action-open"
                aria-label={`Open action: ${action.title}`}
                href={action.href}
                onClick={() => open(action)}
              >
                <ArrowRight size={16} />
              </a>
            ) : (
              <Link
                className="review-action-open"
                aria-label={`Open action: ${action.title}`}
                href={action.href}
              >
                <ArrowRight size={16} />
              </Link>
            )}
          </li>
        ))}
      </ol>
      {!plan.actions.length && (
        <p className="review-plan-scope">
          No outstanding steps identified by these rules. This does not
          establish merge safety.
        </p>
      )}
      {!!plan.actions.length && !matching.length && (
        <p className="review-plan-scope">
          No steps in this category. Select All steps to see the remaining work.
        </p>
      )}
      {matching.length > 5 && (
        <Button
          variant="ghost"
          size="small"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls="review-plan-actions"
        >
          {expanded
            ? "Show priority steps"
            : `Show ${matching.length - 5} more steps`}
        </Button>
      )}
    </section>
  );
}
