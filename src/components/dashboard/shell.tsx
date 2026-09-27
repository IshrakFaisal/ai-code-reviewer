"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ArrowUpRight,
  Boxes,
  ChevronRight,
  FileClock,
  GitPullRequest,
  Layers3,
  Plus,
  ScanLine,
  ShieldCheck,
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
        ? "Investigation in progress"
        : "Overview";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-icon">
            <ScanLine size={23} />
          </span>
          <span>
            change<span className="brand-muted">verifier</span>
            <small>AI VERIFICATION WORKSPACE</small>
          </span>
        </Link>
        <div className="workspace">
          <span className="workspace-avatar">A</span>
          <span>
            Acme workspace<small>Hackathon edition</small>
          </span>
          <ChevronRight size={15} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          <Link
            className={cn("nav-item", pathname === "/" && "active")}
            href="/"
          >
            <Boxes size={18} />
            Overview
          </Link>
          <Link
            className={cn("nav-item", pathname === "/analyze" && "active")}
            href="/#analyze"
          >
            <GitPullRequest size={18} />
            New analysis
            <Plus size={14} className="nav-end" />
          </Link>
          <Link
            className={cn("nav-item", pathname === "/history" && "active")}
            href="/history"
          >
            <FileClock size={18} />
            Analysis history
          </Link>
        </nav>
        <div className="nav-label nav-second">RESOURCES</div>
        <nav aria-label="Resources">
          <Link className="nav-item" href="/#workflow">
            <Layers3 size={18} />
            How it works
          </Link>
          <a
            className="nav-item"
            href="https://docs.tokenfactory.nebius.com"
            target="_blank"
            rel="noreferrer"
          >
            <Activity size={18} />
            Nebius docs
            <ArrowUpRight size={14} className="nav-end" />
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="engine-card">
            <ShieldCheck size={20} />
            <strong>Evidence over assumptions.</strong>
            <p>Every conclusion has a source. Every unknown stays visible.</p>
          </div>
          <div className="powered">
            BUILT FOR
            <span>
              Nebius <i>×</i> NVIDIA
            </span>
          </div>
          <div className="profile">
            <span className="avatar">D</span>
            <span>
              Developer workspace<small>Local · v0.1.0</small>
            </span>
          </div>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div>
            <Link href="/" className="mobile-brand" aria-label="Workspace home">
              <ScanLine size={21} />
            </Link>
            <span className="topbar-muted">Workspace</span>
            <ChevronRight size={14} />
            <span>{label}</span>
          </div>
          <div>
            <Link
              href="/history"
              className="mobile-history"
              aria-label="Analysis history"
            >
              <FileClock size={18} />
            </Link>
            {demo ? (
              <span className="mode-badge">DEMO MODE</span>
            ) : (
              <span className="live-badge">LIVE ANALYSIS</span>
            )}
            <span className="topbar-divider" />
            <span className="avatar small">D</span>
          </div>
        </header>
        <main id="main-content">{children}</main>
        <footer className="app-footer">
          <span>AI Change Verifier</span>
          <span>Reason. Verify. Prioritize.</span>
          <span>Human judgment stays in the loop.</span>
        </footer>
      </div>
    </div>
  );
}
