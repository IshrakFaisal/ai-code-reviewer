import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FileSearch } from "lucide-react";
export default function NotFound() {
  return (
    <div className="page empty-state">
      <FileSearch size={28} />
      <h1>Report not found</h1>
      <p>
        This report may have been removed from local history, or the link is
        incorrect.
      </p>
      <Button asChild>
        <Link href="/">Start a new analysis</Link>
      </Button>
    </div>
  );
}
