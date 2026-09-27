"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="page empty-state">
      <h1>Something interrupted this page.</h1>
      <p>
        Your application is still available. Retry the page or return to the
        workspace.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
