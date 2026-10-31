"use client";

import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { DraftProtectedLink } from "./draft-navigation";
import { openReportTarget } from "./open-report-target";
import {
  reportSectionLocation,
  reportTargetHref,
} from "@/lib/reports/sections";

/** Native link semantics, including new tabs, for evidence on another report page. */
export function ReportTargetLink({
  href,
  onClick,
  ...props
}: ComponentProps<typeof DraftProtectedLink>) {
  const pathname = usePathname();
  const location = reportSectionLocation(pathname);
  const destination = location
    ? reportTargetHref(decodeURIComponent(location.id), href)
    : href;
  return (
    <DraftProtectedLink
      {...props}
      href={destination}
      onClick={(event) => {
        onClick?.(event);
        if (
          !event.defaultPrevented &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          !event.altKey &&
          destination.split("#")[0] === pathname
        ) {
          openReportTarget(href);
        }
      }}
    />
  );
}
