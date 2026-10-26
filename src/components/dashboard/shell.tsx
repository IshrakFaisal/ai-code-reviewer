"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  FileClock,
  FlaskConical,
  GitPullRequest,
  LayoutGrid,
  Layers3,
  ScanLine,
  Settings2,
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
  const label =
    pathname === "/workspace"
      ? "Workspace overview"
      : pathname === "/settings"
        ? "Settings & integrations"
        : pathname === "/how-it-works"
          ? "How it works"
          : pathname.startsWith("/report")
            ? pathname.includes("/reproduce/")
              ? "Reproduce & repair"
              : pathname.endsWith("/compare")
                ? "Analysis comparison"
                : "Verification report"
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
  const mobileNavigation = [
    ...navigation.map((item) => ({
      ...item,
      label:
        item.label === "Analysis history"
          ? "History"
          : item.label === "New analysis"
            ? "Analyze"
            : item.label,
    })),
    {
      href: "/how-it-works",
      label: "Guide",
      icon: BookOpen,
      active: pathname === "/how-it-works",
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
        <Link
          href="/workspace"
          className={cn("workspace", pathname === "/workspace" && "active")}
          aria-current={pathname === "/workspace" ? "page" : undefined}
          title="Open local workspace"
          aria-label="Local workspace"
        >
          <span className="workspace-avatar">
            <Layers3 size={17} />
          </span>
          <span>
            Local workspace<small>Reports & activity</small>
          </span>
          <ChevronRight size={14} className="workspace-chevron" />
        </Link>
        <div className="nav-label">Workspace</div>
        <nav aria-label="Main navigation">
          {navigation.map(({ href, label: name, icon: Icon, active }) => (
            <Link
              key={href}
              href={href}
              className={cn("nav-item", active && "active")}
              aria-current={active ? "page" : undefined}
              title={name}
              aria-label={name}
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
            aria-label="Sample report"
          >
            <FlaskConical size={18} strokeWidth={1.7} />
            <span>Sample report</span>
          </Link>
          <Link
            className={cn("nav-item", pathname === "/how-it-works" && "active")}
            href="/how-it-works"
            title="How it works"
            aria-label="How it works"
            aria-current={pathname === "/how-it-works" ? "page" : undefined}
          >
            <BookOpen size={18} strokeWidth={1.7} />
            <span>How it works</span>
          </Link>
          <a
            className="nav-item"
            href="https://docs.tokenfactory.nebius.com"
            target="_blank"
            rel="noreferrer"
            title="Nebius documentation"
            aria-label="Nebius documentation"
          >
            <ArrowUpRight size={18} strokeWidth={1.7} />
            <span>Nebius documentation</span>
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="powered">
            Powered by{" "}
            <span>
              Nebius <i>×</i> NVIDIA
            </span>
          </div>
          <Link
            className={cn("profile", pathname === "/settings" && "active")}
            href="/settings"
            aria-current={pathname === "/settings" ? "page" : undefined}
            title="Settings & integrations"
            aria-label="Settings & integrations"
          >
            <span className="settings-icon">
              <Settings2 size={18} />
            </span>
            <span>
              Settings & integrations<small>Connection status & setup</small>
            </span>
            <ChevronRight size={14} className="workspace-chevron" />
          </Link>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="topbar-breadcrumb">
            <Link href="/" className="topbar-product">
              Change Verifier
            </Link>
            <Link href="/" className="mobile-brand" aria-label="Workspace home">
              <ScanLine size={20} />
            </Link>
            <Link href="/workspace" className="topbar-muted">
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
            <Link
              href="/settings"
              className={cn(
                "topbar-settings",
                pathname === "/settings" && "active",
              )}
              aria-label="Open settings and integrations"
              title="Settings & integrations"
            >
              <Settings2 size={17} />
            </Link>
          </div>
        </header>
        <nav className="mobile-nav" aria-label="Mobile navigation">
          {mobileNavigation.map(({ href, label: name, icon: Icon, active }) => (
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
          <nav className="footer-links" aria-label="Workspace resources">
            <Link href="/workspace">Workspace</Link>
            <Link href="/how-it-works">How it works</Link>
            <Link href="/settings">Settings</Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}
