"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const sections = [
  ["workbench", "Workbench"],
  ["review-plan", "Next steps"],
  ["summary", "Overview"],
  ["human-review", "Your review"],
  ["findings", "Findings"],
  ["verification", "Verification"],
  ["evidence-gaps", "Evidence gaps"],
  ["files", "Changed files"],
  ["agent-log", "Agent log"],
] as const;

export function ReportNavigation({ findings }: { findings: number }) {
  const [active, setActive] = useState<string>("workbench");
  useEffect(() => {
    const update = () => {
      const ordered = sections
        .map(([id]) => document.getElementById(id))
        .filter((element): element is HTMLElement => !!element)
        .sort(
          (a, b) =>
            a.getBoundingClientRect().top - b.getBoundingClientRect().top,
        );
      const current = ordered
        .filter((element) => element.getBoundingClientRect().top <= 160)
        .at(-1);
      setActive(current?.id || "workbench");
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return (
    <nav className="report-nav" aria-label="Report sections">
      {sections.map(([id, label]) => (
        <a
          key={id}
          href={`#${id}`}
          className={cn(active === id && "active")}
          aria-current={active === id ? "location" : undefined}
          onClick={() => setActive(id)}
        >
          {label}
          {id === "findings" && <span>{findings}</span>}
        </a>
      ))}
    </nav>
  );
}
