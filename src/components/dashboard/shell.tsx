"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  ChevronRight,
  FileClock,
  FlaskConical,
  GitPullRequest,
  LayoutGrid,
  Layers3,
  ScanLine,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function Shell({
  children,
  demo,
}: {
  children: React.ReactNode;
  demo: boolean;
}) {
  const pathname = usePathname();
  const label = pathname.startsWith("/report")
    ? "Verification report"
    : pathname === "/history"
      ? "Analysis history"
      : pathname === "/analyze"
        ? "Investigation"
        : "Overview";
  const navigation = [
    {
      href: "/",
      label: "Overview",
      icon: LayoutGrid,
      active: pathname === "/",
    },
    {
      href: "/#analyze",
      label: "New analysis",
      icon: GitPullRequest,
      active: pathname === "/analyze",
    },
    {
      href: "/history",
      label: "Analysis history",
      icon: FileClock,
      active: pathname === "/history",
    },
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="AI Change Verifier home">
          <span className="brand-icon">
            <ScanLine size={21} strokeWidth={1.8} />
          </span>
          <span>
            Change Verifier<small>AI verification workspace</small>
          </span>
        </Link>
        <div className="workspace">
          <span className="workspace-avatar">W</span>
          <span>
            My workspace<small>Local environment</small>
          </span>
        </div>
        <div className="nav-label">Workspace</div>
        <nav aria-label="Main navigation">
          {navigation.map(({ href, label: name, icon: Icon, active }) => (
            <Link
              key={href}
              href={href}
              className={cn("nav-item", active && "active")}
              aria-current={active ? "page" : undefined}
              title={name}
            >
              <Icon size={18} strokeWidth={1.7} />
              <span>{name}</span>
            </Link>
          ))}
        </nav>
        <div className="nav-label nav-second">Explore</div>
        <nav aria-label="Resources">
          <Link
            className={cn("nav-item", pathname === "/report/demo" && "active")}
            href="/report/demo"
            aria-current={pathname === "/report/demo" ? "page" : undefined}
            title="Sample report"
          >
            <FlaskConical size={18} strokeWidth={1.7} />
            <span>Sample report</span>
          </Link>
          <Link className="nav-item" href="/#workflow" title="How it works">
            <Layers3 size={18} strokeWidth={1.7} />
            <span>How it works</span>
          </Link>
          <a
            className="nav-item"
            href="https://docs.tokenfactory.nebius.com"
            target="_blank"
            rel="noreferrer"
            title="Nebius documentation"
          >
            <ArrowUpRight size={18} strokeWidth={1.7} />
            <span>Nebius documentation</span>
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-note">
            <strong>Evidence, with context.</strong>
            <p>
              Inspect what was checked.
              <br />
              Decide what happens next.
            </p>
          </div>
          <div className="powered">
            Powered by{" "}
            <span>
              Nebius <i>×</i> NVIDIA
            </span>
          </div>
          <div className="profile">
            <span className="avatar">D</span>
            <span>
              Developer<small>Local workspace · v0.1</small>
            </span>
          </div>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="topbar-breadcrumb">
            <Link href="/" className="mobile-brand" aria-label="Workspace home">
              <ScanLine size={20} />
            </Link>
            <Link href="/" className="topbar-muted">
              Workspace
            </Link>
            <ChevronRight size={13} />
            <span>{label}</span>
          </div>
          <div className="topbar-status">
            <span className={demo ? "mode-badge" : "live-badge"}>
              {demo ? "Demo mode" : "Live mode"}
            </span>
            <span className="topbar-divider" />
            <span className="avatar small" aria-label="Developer workspace">
              D
            </span>
          </div>
        </header>
        <nav className="mobile-nav" aria-label="Mobile navigation">
          {navigation.map(({ href, label: name, icon: Icon, active }) => (
            <Link
              key={href}
              href={href}
              className={cn(active && "active")}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={16} />
              <span>{name}</span>
            </Link>
          ))}
        </nav>
        <main id="main-content">{children}</main>
        <footer className="app-footer">
          <span>AI Change Verifier</span>
          <span>Evidence informs. You decide.</span>
        </footer>
      </div>
    </div>
  );
}
