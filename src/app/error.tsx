"use client";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="page empty-state">
      <AlertCircle size={28} />
      <h1>This view could not load</h1>
      <p>
        Try loading it again, or return to your workspace to open another
        report.
      </p>
      <div className="error-actions">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/">Back to workspace</Link>
        </Button>
      </div>
    </div>
  );
}
