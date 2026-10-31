"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, LoaderCircle } from "lucide-react";
import type { AnalysisReport } from "@/lib/types";
import {
  analysisMarkdown,
  reportExportFilename,
} from "@/lib/reports/readable-export";
import { Button } from "@/components/ui/button";

export function ReportExports({ report }: { report: AnalysisReport }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const running = useRef(false);
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        menu.current &&
        event.target instanceof Node &&
        !menu.current.contains(event.target)
      )
        menu.current.open = false;
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  async function download(format: "pdf" | "json" | "md") {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    if (menu.current?.open) {
      menu.current.open = false;
      menu.current.querySelector("summary")?.focus();
    }
    try {
      const blob =
        format === "pdf"
          ? await (
              await import("@/lib/reports/pdf-export")
            ).createReportPdf(report)
          : new Blob(
              [
                format === "json"
                  ? JSON.stringify(report, null, 2)
                  : analysisMarkdown(report),
              ],
              {
                type:
                  format === "json"
                    ? "application/json"
                    : "text/markdown;charset=utf-8",
              },
            );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = reportExportFilename(report, format);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      setError(
        "The export could not be created. Please retry, or choose another format.",
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="report-exports">
      <div className="report-export-controls">
        <Button size="small" disabled={busy} onClick={() => download("pdf")}>
          {busy ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Download size={14} />
          )}
          {busy ? "Preparing export…" : "Download PDF"}
        </Button>
        <details
          ref={menu}
          className="report-export-menu"
          onKeyDown={(event) => {
            if (event.key === "Escape" && menu.current) {
              menu.current.open = false;
              menu.current.querySelector("summary")?.focus();
            }
          }}
        >
          <summary>
            Other formats <ChevronDown size={13} />
          </summary>
          <div className="report-export-options">
            <button
              type="button"
              disabled={busy}
              onClick={() => download("md")}
            >
              Markdown (.md)<small>Readable text for sharing</small>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => download("json")}
            >
              JSON (.json)<small>Full analysis data</small>
            </button>
          </div>
        </details>
      </div>
      <span className="sr-only" role="status">
        {busy ? "Preparing your download" : ""}
      </span>
      {error && (
        <p className="report-export-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
