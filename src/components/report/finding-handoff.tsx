"use client";

import { useState } from "react";
import { Copy, Download, FileOutput, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AnalysisReport, Finding } from "@/lib/types";
import { findingHandoff, proposedTestDownload } from "@/lib/reports/handoff";
import type { ReviewChecklist } from "./review-checklist";

function downloadText(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FindingHandoff({
  report,
  finding,
  checklist,
}: {
  report: AnalysisReport;
  finding: Finding;
  checklist: ReviewChecklist;
}) {
  const [message, setMessage] = useState("");
  const canExport =
    !!checklist.review && !checklist.isDirty(finding.id) && !checklist.savingId;
  const proposal = proposedTestDownload(report, finding.id);
  async function copy() {
    if (!canExport || !checklist.review) return;
    try {
      await navigator.clipboard.writeText(
        findingHandoff(report, finding.id, checklist.review),
      );
      setMessage("Finding draft copied. Review it before sharing.");
    } catch {
      setMessage(
        "Clipboard is unavailable. Download the Markdown draft instead.",
      );
    }
  }
  function downloadDraft() {
    if (!canExport || !checklist.review) return;
    downloadText(
      `change-verifier-pr-${report.pr.number}-finding-${report.findings.indexOf(finding) + 1}.md`,
      findingHandoff(report, finding.id, checklist.review),
      "text/markdown;charset=utf-8",
    );
    setMessage("Finding draft downloaded. Nothing was posted to GitHub.");
  }
  return (
    <details className="finding-handoff">
      <summary>
        <FileOutput size={15} />
        <span>Finding handoff & test proposal</span>
        <ChevronRight size={14} className="handoff-chevron" />
      </summary>
      <div>
        <p>
          Prepare a focused Markdown draft with the pinned commits, evidence,
          saved decision, and follow-up checklist. Nothing is posted to GitHub.
        </p>
        <div className="handoff-actions">
          <Button
            variant="outline"
            size="small"
            disabled={!canExport}
            onClick={copy}
          >
            <Copy size={13} />
            Copy finding draft
          </Button>
          <Button
            variant="outline"
            size="small"
            disabled={!canExport}
            onClick={downloadDraft}
          >
            <Download size={13} />
            Download finding draft
          </Button>
          {proposal && (
            <Button
              variant="outline"
              size="small"
              onClick={() => {
                downloadText(
                  proposal.filename,
                  proposal.code,
                  "text/plain;charset=utf-8",
                );
                setMessage(
                  "Test proposal downloaded. Inspect its code and setup before running it.",
                );
              }}
            >
              <Download size={13} />
              Download test proposal
            </Button>
          )}
        </div>
        {!canExport && (
          <p className="handoff-hint">
            {!checklist.review
              ? "Load saved review decisions to export a finding draft."
              : checklist.isDirty(finding.id)
                ? "Save this finding’s decision and note before exporting its draft."
                : "Wait for the current save to finish before exporting."}
          </p>
        )}
        {proposal ? (
          <p className="handoff-hint">
            {report.mode === "DEMO"
              ? "Demo fixture template"
              : "AI-generated test proposal"}{" "}
            · {finding.generatedTest?.framework} · Inspect imports, fixtures,
            and assertions before running.
          </p>
        ) : (
          <p className="handoff-hint">
            No test proposal is recorded for this finding.
          </p>
        )}
        <p role="status" className="handoff-message">
          {message}
        </p>
      </div>
    </details>
  );
}
