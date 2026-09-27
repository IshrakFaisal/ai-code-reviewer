import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleDot,
  Code2,
  GitBranch,
  GitPullRequest,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Target,
  Terminal,
} from "lucide-react";
import { getConfig } from "@/lib/config";
import { PRInput } from "@/components/github/pr-input";
import { Button } from "@/components/ui/button";
export default function Home() {
  const { demo } = getConfig();
  return (
    <div className="page home-page">
      <div className="page-eyebrow">
        <span className="accent-line" />
        AUTONOMOUS CHANGE VERIFICATION
        <span className="edition">NEBIUS × NVIDIA HACKATHON</span>
      </div>
      <section className="hero">
        <div>
          <h1>AI writes code faster than humans can review it.</h1>
          <p className="hero-lead">
            We verify what actually needs human attention.
          </p>
          <p className="hero-description">
            AI Change Verifier investigates pull requests, runs targeted
            verification, and shows you exactly what deserves human attention.
          </p>
        </div>
        <div
          className="hero-diagram"
          aria-label="Change to evidence to human review"
        >
          <div className="diagram-code">
            <Code2 size={23} />
            <span>CODE CHANGES</span>
            <div>
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
          <div className="diagram-connector" />
          <div className="diagram-core">
            <ScanSearch size={32} />
            <span>INVESTIGATE</span>
          </div>
          <div className="diagram-connector second" />
          <div className="diagram-result">
            <ShieldCheck size={22} />
            <span>EVIDENCE</span>
            <div>
              <Check size={13} />
              Verified results
            </div>
            <div>
              <Target size={13} />
              Review priorities
            </div>
          </div>
        </div>
      </section>
      <PRInput demo={demo} />
      <section
        className="workflow-grid"
        id="workflow"
        aria-label="How it works"
      >
        {[
          {
            n: "01",
            icon: ScanSearch,
            title: "Understand the change",
            label: "UNDERSTAND",
            text: "Go beyond the diff. Identify behavioral changes and the systems they could affect.",
          },
          {
            n: "02",
            icon: Terminal,
            title: "Put risk to the test",
            label: "VERIFY",
            text: "Form hypotheses, generate targeted checks, and examine execution evidence.",
          },
          {
            n: "03",
            icon: Target,
            title: "Focus human attention",
            label: "PRIORITIZE",
            text: "Get an ordered review map, with verified findings separated from open questions.",
          },
        ].map((item) => (
          <div className="workflow-item" key={item.n}>
            <div className="workflow-top">
              <item.icon size={20} />
              <span>
                {item.n} / {item.label}
              </span>
            </div>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
          </div>
        ))}
      </section>
      <div className="section-heading">
        <div>
          <h2>From pull request to proof</h2>
          <p>A closer look at the password reset investigation.</p>
        </div>
        <Link href="/report/demo" className="text-link">
          Explore sample report
          <ArrowUpRight size={15} />
        </Link>
      </div>
      <section className="sample-preview">
        <div className="sample-header">
          <div className="pr-symbol">
            <GitPullRequest size={23} />
          </div>
          <div>
            <div className="sample-repo">
              acme / platform <span>#127</span>
              <span className="mini-badge">SAMPLE PR</span>
            </div>
            <h3>Add password reset functionality</h3>
            <p>
              <GitBranch size={12} />
              feat/password-reset <ArrowRight size={12} /> main{" "}
              <span>18 files changed</span>
            </p>
          </div>
          <span className="risk-badge high">HIGH RISK</span>
        </div>
        <div className="sample-body">
          <div className="sample-finding">
            <div className="overline">
              <CircleDot size={14} /> TARGETED INVESTIGATION
            </div>
            <h3>Password reset token reuse</h3>
            <p>
              A successful reset may leave the token valid. The agent checks
              what happens when the same link is used twice.
            </p>
            <div className="sample-code">
              <span>01</span>
              <code>resetPassword(token, firstPassword)</code>
              <b className="green">200</b>
              <span>02</span>
              <code>resetPassword(token, secondPassword)</code>
              <b className="red">200</b>
            </div>
            <div className="sample-note">
              <span className="red">Expected 400. Received 200.</span>
              <span>Bundled demo scenario</span>
            </div>
          </div>
          <div className="sample-risk">
            <div className="overline">REVIEW PRIORITIES</div>
            {[
              ["Authentication", "HIGH", 90],
              ["Database", "MEDIUM", 56],
              ["Email", "UNVERIFIED", 35],
              ["UI", "LOW", 17],
            ].map(([label, level, width]) => (
              <div className="risk-row" key={label}>
                <div>
                  <span>{label}</span>
                  <small
                    className={
                      level === "HIGH"
                        ? "red"
                        : level === "MEDIUM"
                          ? "amber"
                          : "muted"
                    }
                  >
                    {level}
                  </small>
                </div>
                <div className="risk-track">
                  <i
                    style={{ width: `${width}%` }}
                    className={
                      level === "HIGH"
                        ? "bar-red"
                        : level === "MEDIUM"
                          ? "bar-amber"
                          : "bar-muted"
                    }
                  />
                </div>
              </div>
            ))}
            <div className="sample-evidence">
              <ShieldCheck size={16} />
              <span>Evidence-backed, human-reviewed.</span>
            </div>
          </div>
        </div>
      </section>
      <div className="home-bottom">
        <Sparkles size={16} />
        <span>
          AI inference is a starting point. Executed evidence is what changes
          the conversation.
        </span>
        <Button asChild variant="ghost" size="small">
          <Link href="/analyze?demo=true">
            See it work
            <ArrowRight size={14} />
          </Link>
        </Button>
      </div>
    </div>
  );
}
