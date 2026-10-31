"use client";
import { DraftProtectedLink as Link } from "./draft-navigation";
import {
  reportSections,
  reportSectionHref,
  type ReportSection,
} from "@/lib/reports/sections";
export function ReportNavigation({
  id,
  active,
  findings,
}: {
  id: string;
  active: ReportSection;
  findings: number;
}) {
  return (
    <nav className="report-nav" aria-label="Report pages">
      {reportSections.map(([section, label]) => (
        <Link
          key={section}
          href={reportSectionHref(id, section)}
          className={active === section ? "active" : undefined}
          aria-current={active === section ? "page" : undefined}
        >
          {label}
          {section === "findings" && <span>{findings}</span>}
        </Link>
      ))}
    </nav>
  );
}
