import Link from "next/link";
import { AlertCircle } from "lucide-react";
import type { ReportIssue } from "@/lib/reports/store";

const reasons = {
  INVALID: "Invalid report data or unsupported format",
  TOO_LARGE: "Exceeds the 64 MiB report limit",
  UNREADABLE: "File could not be read",
};

export function ReportStorageNotice({
  issues,
  unavailable = false,
}: {
  issues: ReportIssue[];
  unavailable?: boolean;
}) {
  if (!issues.length && !unavailable) return null;
  return (
    <div className="error-panel" role="status">
      <AlertCircle size={21} aria-hidden="true" />
      <div>
        <strong>
          {unavailable
            ? "Saved reports are unavailable"
            : `${issues.length} saved ${issues.length === 1 ? "report could" : "reports could"} not be loaded`}
        </strong>
        <p>
          {unavailable
            ? "The report folder could not be read. Check the server’s storage permissions and reload this page."
            : "The affected files have been left in place. Restore them from a backup or run a new analysis. Other readable reports remain available in history."}
        </p>
        {!!issues.length && (
          <details>
            <summary>View affected report files</summary>
            <p>Files are in the server’s .data/reports folder.</p>
            <ul>
              {issues.map((issue) => (
                <li key={issue.id}>
                  {issue.id}.json — {reasons[issue.reason]}
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="error-actions">
          <Link href="/history" className="text-link">
            View history
          </Link>
          <Link href="/" className="text-link">
            Start a new analysis
          </Link>
        </div>
      </div>
    </div>
  );
}
