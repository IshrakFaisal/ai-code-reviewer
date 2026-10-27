import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { STAGES } from "@/lib/types";

export const metadata: Metadata = {
  title: "How it works · AI Change Verifier",
  description:
    "A detailed guide to PR investigations, risk scoring, execution evidence, review decisions, and workspace setup.",
};

const contents = [
  ["quick-start", "Get started"],
  ["pipeline", "The investigation pipeline"],
  ["risk", "Risk and review priority"],
  ["evidence", "Read the evidence"],
  ["modes", "Demo and live modes"],
  ["execution", "Run verification checks"],
  ["review", "Review and follow up"],
  ["privacy", "Data and privacy"],
  ["questions", "Common questions"],
] as const;

const pipeline = [
  {
    title: "Retrieve the pull request",
    stages: "Stages 1–3",
    detail:
      "The server reads public GitHub repository metadata, the PR, and paginated changed files. It records the base and head commit SHAs so the report refers to a specific revision. Missing patches, large file sets, and abbreviated diffs remain visible as limitations.",
  },
  {
    title: "Understand the change",
    stages: "Stages 4–7",
    detail:
      "Files are categorized, behavioral changes are identified, and potentially affected systems are mapped. Without AI configuration, observations use path and diff heuristics. With Nebius configured, structured model output can add grounded context and categories. The system map shows inferred connections, not a verified import graph.",
  },
  {
    title: "Calculate review priority",
    stages: "Stage 8",
    detail:
      "A deterministic engine combines explainable signals such as authentication changes, database changes, removed validation, and failed checks. The same configured weights determine the score; the model cannot remove existing risk signals or assign execution status.",
  },
  {
    title: "Investigate concrete hypotheses",
    stages: "Stages 9–11",
    detail:
      "The agent selects a bounded set of risks and proposes focused verification strategies. When AI is available, the configured model generates structured hypotheses and Vitest test proposals. Zod validates the output, and file references are grounded in retrieved changes. The default limit is five investigations, configurable from one to ten.",
  },
  {
    title: "Inspect and execute checks",
    stages: "Stages 12–13",
    detail:
      "Static checks inspect the supplied diff. Repository execution requires an explicitly configured provider and an allowlisted repository. Build, type, existing-test, and proposed-test results retain their status and provenance. A generated test failure can be caused by test setup or validity, so live failures remain subject to human assessment.",
  },
  {
    title: "Assemble the review",
    stages: "Stage 14",
    detail:
      "The saved report brings together findings, evidence, behavior observations, risk areas, priority lines, and investigation events. You inspect the evidence, record your own decisions, compare saved runs, and prepare follow-up drafts. An analysis never automatically approves a merge.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="page guide-page">
      <header className="guide-header">
        <div className="page-eyebrow">Product guide</div>
        <h1>How Change Verifier works</h1>
        <p>
          Turn a pull request into a focused review: understand what changed,
          investigate the risks, and inspect the evidence before deciding what
          happens next.
        </p>
        <div className="guide-header-actions">
          <Button asChild>
            <Link href="/#analyze">
              Analyze a pull request
              <ArrowRight size={14} />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/report/demo" prefetch={false}>
              Explore the sample report
              <ArrowUpRight size={14} />
            </Link>
          </Button>
        </div>
      </header>
      <div className="guide-layout">
        <nav className="guide-contents" aria-label="Guide contents">
          <span>On this page</span>
          {contents.map(([id, label]) => (
            <a href={`#${id}`} key={id}>
              {label}
            </a>
          ))}
        </nav>
        <div className="guide-body">
          <section id="quick-start">
            <div className="guide-section-label">01 · Get started</div>
            <h2>Your first investigation</h2>
            <ol className="guide-steps">
              <li>
                <strong>Choose the source.</strong> Paste a public GitHub PR URL
                on the overview page. The accepted format is{" "}
                <code>https://github.com/owner/repo/pull/123</code>. For a
                credential-free walkthrough, choose{" "}
                <strong>Run the demo</strong>.
              </li>
              <li>
                <strong>Follow the investigation.</strong> The progress page
                shows actual stages and concise observations. A failed live
                request stays a failure; the app only launches the demo when you
                explicitly choose it.
              </li>
              <li>
                <strong>Review the saved report.</strong> Start with the
                workbench to connect changed code with findings and evidence.
                Use Next steps for a prioritized review plan, then inspect the
                summary and verification gaps. Save decisions and notes against
                the analyzed commit.
              </li>
            </ol>
            <aside className="guide-callout">
              <strong>The result is a review aid.</strong>
              <p>
                Risk priority, model observations, execution results, and your
                review decisions are separate pieces of information. A lower
                score or a passing check does not establish that the entire
                change is safe.
              </p>
            </aside>
          </section>

          <section id="pipeline">
            <div className="guide-section-label">
              02 · From diff to evidence
            </div>
            <h2>The investigation pipeline</h2>
            <p>
              Each analysis follows the same visible sequence. Providers and
              available evidence determine which checks can actually run.
            </p>
            <ol className="guide-pipeline">
              {pipeline.map((step, index) => (
                <li key={step.title}>
                  <span className="guide-step-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <small>{step.stages}</small>
                    <h3>{step.title}</h3>
                    <p>{step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
            <details className="guide-disclosure">
              <summary>View all {STAGES.length} investigation stages</summary>
              <ol>
                {STAGES.map((stage) => (
                  <li key={stage}>{stage}</li>
                ))}
              </ol>
            </details>
          </section>

          <section id="risk">
            <div className="guide-section-label">03 · Focus your attention</div>
            <h2>Risk scores guide review priority</h2>
            <p>
              Scores combine deterministic signals and are capped at 100. They
              describe where to spend review effort, rather than a probability
              that a defect exists.
            </p>
            <dl className="guide-definitions">
              <div>
                <dt>
                  <span className="risk-badge high">HIGH · 50–100</span>
                </dt>
                <dd>
                  Prioritize inspection of the changed behavior and its
                  evidence.
                </dd>
              </div>
              <div>
                <dt>
                  <span className="risk-badge medium">MEDIUM · 25–49</span>
                </dt>
                <dd>
                  Review the identified signals and check whether additional
                  context is needed.
                </dd>
              </div>
              <div>
                <dt>
                  <span className="risk-badge low">LOW · 0–24</span>
                </dt>
                <dd>
                  Fewer configured signals were detected. Unchecked behavior can
                  still contain defects.
                </dd>
              </div>
            </dl>
            <p>
              Default examples include authentication changes (+30),
              authorization changes (+35), database changes (+30), removed
              validation (+30), and an existing-test failure (+50). Each file
              shows the reasons behind its score. Operators can adjust supported
              weights in the server configuration.
            </p>
            <h3>The priority review surface</h3>
            <p>
              This counts unique changed lines associated with high-priority
              files or finding ranges. It helps locate the review surface; it is
              not a measure of test coverage. When patches are incomplete, the
              number is explicitly a lower bound.
            </p>
            <div className="guide-example">
              <span>Example from the synthetic demo</span>
              <strong>At least 16 / 1,437 changed lines</strong>
              <p>
                These lines deserve early inspection. The remaining lines have
                not been declared safe.
              </p>
            </div>
          </section>

          <section id="evidence">
            <div className="guide-section-label">
              04 · Interpret the results
            </div>
            <h2>Read status and provenance together</h2>
            <p>
              Every check has both a result and a source. Read its description
              and output before drawing a conclusion.
            </p>
            <dl className="guide-definitions">
              <div>
                <dt>PASS</dt>
                <dd>
                  The recorded check passed. A static pass is not a runtime
                  pass, and a test pass supports only its assertions.
                </dd>
              </div>
              <div>
                <dt>FAIL</dt>
                <dd>
                  The recorded check failed. Inspect the output and test
                  validity to distinguish product behavior from setup, syntax,
                  or environment failures.
                </dd>
              </div>
              <div>
                <dt>WARNING</dt>
                <dd>
                  Inspection or execution found something that requires review,
                  or a conclusive result was unavailable.
                </dd>
              </div>
              <div>
                <dt>NOT_RUN</dt>
                <dd>
                  The check did not execute. It must not be interpreted as a
                  pass.
                </dd>
              </div>
            </dl>
            <h3>Where the evidence came from</h3>
            <dl className="guide-definitions">
              <div>
                <dt>
                  <code>STATIC</code>
                </dt>
                <dd>
                  Deterministic inspection of supplied diff context. It can
                  identify signals without executing the repository.
                </dd>
              </div>
              <div>
                <dt>
                  <code>EXECUTED</code>
                </dt>
                <dd>
                  A repository command or test was attempted. Its status still
                  matters: an EXECUTED record marked NOT_RUN is not a completed
                  check.
                </dd>
              </div>
              <div>
                <dt>
                  <code>DEMO_FIXTURE</code>
                </dt>
                <dd>
                  Actual execution against the bundled synthetic fixture. It
                  does not verify a GitHub repository.
                </dd>
              </div>
            </dl>
            <h3>Finding conclusions</h3>
            <dl className="guide-definitions">
              <div>
                <dt>Unverified risk</dt>
                <dd>No executed test supports a behavioral conclusion yet.</dd>
              </div>
              <div>
                <dt>Inconclusive</dt>
                <dd>
                  A live failure, timeout, invalid test, or runner problem needs
                  human assessment.
                </dd>
              </div>
              <div>
                <dt>Verified for this test</dt>
                <dd>
                  A generated test passed within the recorded scope. Broader
                  behavior is not established.
                </dd>
              </div>
              <div>
                <dt>Verified issue · fixture</dt>
                <dd>
                  A trusted assertion failed against the deliberately defective
                  demo fixture. This automatic label is limited to the demo.
                </dd>
              </div>
            </dl>
          </section>

          <section id="modes">
            <div className="guide-section-label">
              05 · Choose an analysis mode
            </div>
            <h2>Demo and live workflows</h2>
            <dl className="guide-mode-list">
              <div>
                <dt>Demo</dt>
                <dd>
                  <p>
                    A synthetic <code>acme/platform #127</code> PR with 18
                    changed files. The bundled password-reset fixture executes
                    four assertions: three pass and the expected token-reuse
                    assertion fails. Its test template is curated demo content;
                    no live model request is made.
                  </p>
                  <small>
                    Requires: no API credentials, Docker, or remote sandbox.
                  </small>
                </dd>
              </div>
              <div>
                <dt>GitHub with static analysis</dt>
                <dd>
                  <p>
                    Real public PR metadata and diffs feed categorization,
                    heuristic observations, static checks, and deterministic
                    risk priorities. Without AI configuration, model-generated
                    findings and test proposals are not invented.
                  </p>
                  <small>
                    Requires: live mode and server access to GitHub.
                    GITHUB_TOKEN is optional.
                  </small>
                </dd>
              </div>
              <div>
                <dt>GitHub with AI</dt>
                <dd>
                  <p>
                    Nebius adds structured behavioral analysis, grounded risk
                    hypotheses, and proposed Vitest tests. The exact configured
                    model is checked against the account catalog; an alternate
                    model is not silently substituted. Inference failures
                    preserve deterministic observations and visible limitations.
                  </p>
                  <small>
                    Requires: live mode, NEBIUS_API_KEY, and an eligible exact
                    NEBIUS_MODEL. Inference may be billable.
                  </small>
                </dd>
              </div>
            </dl>
            <p>
              Repository execution is a separate capability in live workflows.
              Adding an AI key does not enable sandbox execution. See{" "}
              <Link href="/settings">Settings & integrations</Link> for the
              current configuration.
            </p>
          </section>

          <section id="execution">
            <div className="guide-section-label">
              06 · Verify at the analyzed revision
            </div>
            <h2>Running repository checks</h2>
            <p>
              Execution requires a selected sandbox provider, its enablement
              switch, and an exact repository allowlist. Supported Node projects
              use one root npm, pnpm, or Yarn lockfile; pnpm and Yarn also need
              an exact package-manager version. Unsupported checks remain
              unexecuted.
            </p>
            <dl className="guide-definitions">
              <div>
                <dt>Docker</dt>
                <dd>
                  Runs supported repositories in constrained Linux containers.
                  The configured image must be available locally; Windows can
                  use a suitable Docker Desktop setup.
                </dd>
              </div>
              <div>
                <dt>Nebius sandbox</dt>
                <dd>
                  Uses the configured remote sandbox account, project, and
                  trusted image. Sandbox credentials are separate from the
                  inference API key.
                </dd>
              </div>
              <div>
                <dt>Native development</dt>
                <dd>
                  An explicit opt-in for trusted development repositories on
                  supported Linux/macOS/WSL environments. It refuses production
                  execution.
                </dd>
              </div>
            </dl>
            <p>
              Docker and Nebius execution in production also require the
              production execution gate. Clone and dependency installation can
              use networking; repository verification runs without it in these
              providers. App credentials are not injected into the repository
              environment.
            </p>
            <aside className="guide-callout">
              <strong>Revision scope matters.</strong>
              <p>
                Standard analysis checks run against the head revision. Open
                <strong> Reproduce &amp; repair</strong> on a finding to run the
                same generated test twice at both pinned commits in separate
                Docker or Nebius sandboxes. Matching environment fingerprints
                and assertion identities are required. A stable base pass and
                head assertion failure support a regression finding; test
                validity still needs review. Dependency changes, unstable runs,
                and setup failures remain inconclusive. After reproduction,
                request one bounded Nebius repair and recheck the unchanged test
                plus build, type, and existing-test commands. Patches stay
                inside the sandbox and can be downloaded for review.
              </p>
            </aside>
            <p>
              Use <strong>Verification gaps</strong> to inspect exact
              file-linked evidence. An unscoped build pass does not mark all
              changed files verified. Demo-only, static, and skipped checks do
              not count as repository execution, and file links are not line
              coverage.
            </p>
          </section>

          <section id="review">
            <div className="guide-section-label">
              07 · Turn evidence into action
            </div>
            <h2>Review and follow up</h2>
            <ol className="guide-steps">
              <li>
                <strong>Check revision freshness.</strong> On a live report,
                choose Check GitHub revision to read current public PR metadata.
                A changed base or head commit requires a fresh analysis for that
                revision. Open, closed, merged, and draft states are shown as an
                as-of snapshot. Matching snapshots expire after five minutes;
                the app does not continuously monitor the PR. Synthetic demo
                reports cannot be checked against GitHub.
              </li>
              <li>
                <strong>Inspect findings and changed code.</strong> Read the
                behavioral change, impact, file references, recommendation, and
                evidence. Expand generated tests and outputs when available.
              </li>
              <li>
                <strong>Record a decision.</strong> Choose Needs review, Needs
                fix, Reviewed, or Dismissed and save an optional note. A
                decision stays attached to the report and head commit. It does
                not change the original evidence.
              </li>
              <li>
                <strong>Explore verification gaps.</strong> Search changed
                files, filter risk and evidence scope, and open the linked diff.
                Start with high-risk files lacking linked repository execution.
              </li>
              <li>
                <strong>Compare saved runs.</strong> Compare earlier and later
                observations for the same PR and mode. Matching uses title,
                category, and file paths/sides. A finding not observed again has
                not automatically been fixed.
              </li>
              <li>
                <strong>Prepare a handoff.</strong> Copy or download a full
                review summary or an individual finding draft. Saved notes,
                commits, provenance, and limitations are retained. Test-proposal
                downloads preserve recorded source; inspect their setup before
                running them.
              </li>
              <li>
                <strong>Use your next review steps.</strong> The deterministic
                action plan prioritizes changed revisions, saved needs-fix
                decisions, open findings, failed or inconclusive execution,
                missing repository checks, and high-risk evidence gaps. Review
                focus filters in the workbench narrow files by risk, findings,
                execution gaps, or saved Needs review / Needs fix decisions;
                arrow keys move through the visible file list. Filter next steps
                by category and open each failed or inconclusive check directly
                to inspect its output. Download action plan includes all steps
                regardless of the selected filter, pinned revisions, the
                session’s revision snapshot, next steps, and saved review notes.
                Save draft decisions before exporting. Completing these steps is
                not merge approval, and reproduction/repair results remain
                separate from the original report.
              </li>
            </ol>
            <p>
              Drafts and source downloads are local exports. The app does not
              automatically post PR comments, open issues, or approve a merge.
            </p>
          </section>

          <section id="privacy">
            <div className="guide-section-label">
              08 · Understand the boundaries
            </div>
            <h2>Data, configuration, and limits</h2>
            <ul className="guide-list">
              <li>
                Integration credentials stay on the server and are never passed
                as browser props or included in cloned repository environments.
              </li>
              <li>
                Live AI analysis sends bounded PR context to the configured
                inference provider. Treat public PR text and model-generated
                source as untrusted input.
              </li>
              <li>
                Reports are stored locally on the app server; the newest 100 are
                retained. Saved reviewer notes have separate revision snapshots
                and require the same persistent filesystem across restarts.
              </li>
              <li>
                Large PRs and missing/truncated patches can leave incomplete
                coverage. The current retrieval ceiling is 500 files; AI context
                is further bounded to 60 files and 75,000 patch characters.
              </li>
              <li>
                GitHub requests use bounded deadlines and retries.
                Authentication, access restrictions, and exhausted rate limits
                are reported explicitly.
              </li>
              <li>
                This is a local, single-owner workspace. Hosted multi-user
                operation and a durable job queue remain outside the current
                workflow. Paired verification currently supports generated
                Vitest tests with unchanged dependency environments; it does not
                establish complete coverage or automatic merge safety.
              </li>
            </ul>
            <Link href="/settings" className="text-link">
              Review connection setup
              <ArrowRight size={14} />
            </Link>
          </section>

          <section id="questions">
            <div className="guide-section-label">09 · Common questions</div>
            <h2>When a result needs more context</h2>
            <div className="guide-faq">
              <details>
                <summary>Can I use it without an AI key?</summary>
                <p>
                  Yes. The demo needs no credentials. For real GitHub-only
                  analysis, enable live mode and leave AI configuration empty.
                  The app retains real metadata, static checks, deterministic
                  priorities, and heuristic observations.
                </p>
              </details>
              <details>
                <summary>
                  Why does a check say NOT_RUN or not available?
                </summary>
                <p>
                  Execution may be disabled, a repository may not be
                  allowlisted, the environment may be unsupported, or a
                  prerequisite may have failed. Read the check description and
                  investigation log; absence of execution is not a passing
                  result.
                </p>
              </details>
              <details>
                <summary>
                  Why can GitHub fail when my browser has internet access?
                </summary>
                <p>
                  GitHub requests originate from the app server. Its DNS, proxy,
                  firewall, network permissions, authentication, and API limits
                  can differ from the browser. Read the specific error and retry
                  guidance. A token can raise limits but cannot repair blocked
                  network access.
                </p>
              </details>
              <details>
                <summary>What happens when AI output is invalid?</summary>
                <p>
                  Structured output is schema-validated, with one repair
                  attempt. If inference still fails, the report preserves
                  deterministic analysis and records the limitation. The app
                  does not silently switch models or replace a live analysis
                  with demo results.
                </p>
              </details>
              <details>
                <summary>
                  Does a disappeared finding prove that a fix worked?
                </summary>
                <p>
                  No. Model wording, investigation limits, providers, scope, or
                  available evidence may differ. Compare the pinned commits and
                  recorded results, inspect the affected code, and verify the
                  intended behavior.
                </p>
              </details>
              <details>
                <summary>
                  Can I analyze private repositories or automatically publish a
                  review?
                </summary>
                <p>
                  The current retrieval workflow supports public GitHub
                  repositories. Review drafts and test proposals are downloaded
                  or copied for your inspection; nothing is automatically
                  published to GitHub.
                </p>
              </details>
            </div>
          </section>
          <div className="guide-next">
            <div>
              <h2>Ready to inspect a change?</h2>
              <p>
                Start with a public PR or explore the complete synthetic
                example.
              </p>
            </div>
            <Button asChild>
              <Link href="/#analyze">
                Start an analysis
                <ArrowRight size={14} />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
