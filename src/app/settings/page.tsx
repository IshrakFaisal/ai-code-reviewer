import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Info, RefreshCw } from "lucide-react";
import { getConfig } from "@/lib/config";
import { integrationSummary } from "@/lib/workspace/summary";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Settings & integrations · AI Change Verifier",
};
const providers = {
  docker: "Docker sandbox",
  native: "Native development sandbox",
  nebius: "Nebius sandbox",
  disabled: "Disabled",
};

export default function SettingsPage() {
  const { demo, maxInvestigations } = getConfig();
  const status = integrationSummary(process.env);
  const aiConfigured = status.aiKeyPresent && status.aiModelPresent;
  return (
    <div className="page settings-page">
      <div className="page-heading">
        <div>
          <div className="page-eyebrow">Workspace configuration</div>
          <h1>Settings & integrations</h1>
          <p>
            See how this workspace is configured and what each integration
            needs.
          </p>
        </div>
        <form action="/settings" method="get">
          <Button variant="outline" type="submit">
            <RefreshCw size={14} />
            Refresh status
          </Button>
        </form>
      </div>
      <div className="settings-readonly">
        <Info size={18} />
        <div>
          <strong>Configuration is managed on the server</strong>
          <p>
            Edit <code>.env.local</code> in the project directory and restart
            the app to apply changes. This page shows configuration presence; it
            does not send test requests or reveal credentials.
          </p>
        </div>
      </div>
      <section
        className="settings-section"
        aria-labelledby="analysis-settings-heading"
      >
        <div className="section-heading">
          <div>
            <h2 id="analysis-settings-heading">Analysis defaults</h2>
            <p>These settings apply to new investigations.</p>
          </div>
          <Link href="/how-it-works#modes" className="text-link">
            Understand the modes
            <ArrowRight size={13} />
          </Link>
        </div>
        <dl className="settings-definitions">
          <div>
            <dt>Default mode</dt>
            <dd>
              <span className={demo ? "mode-badge" : "live-badge"}>
                {demo ? "Demo" : "Live GitHub analysis"}
              </span>
              <p>
                {demo
                  ? "New analyses use the bundled synthetic scenario. Set DEMO_MODE=false to analyze public GitHub PRs."
                  : "New analyses retrieve real public GitHub PRs. AI and execution depend on the configuration below."}
              </p>
            </dd>
          </div>
          <div>
            <dt>Investigation limit</dt>
            <dd>
              <strong>{maxInvestigations} hypotheses per analysis</strong>
              <p>
                Configured with <code>MAX_INVESTIGATIONS</code>, from 1 to 10. A
                bounded investigation is not an exhaustive review.
              </p>
            </dd>
          </div>
        </dl>
      </section>
      <section
        className="settings-section"
        aria-labelledby="integrations-heading"
      >
        <div className="section-heading">
          <div>
            <h2 id="integrations-heading">Integrations</h2>
            <p>
              Configured values do not establish network access, account
              permissions, or provider availability.
            </p>
          </div>
        </div>
        <div className="integration-list">
          <article className="integration-row">
            <div>
              <h3>GitHub</h3>
              <p>Public PR metadata, changed files, and diff retrieval.</p>
            </div>
            <span className="configuration-badge">
              {status.githubTokenPresent ? "Token configured" : "Public access"}
            </span>
            <div className="integration-detail">
              <p>
                {status.githubTokenPresent
                  ? "A server-side token is configured. Repository access and rate limits are checked when a request is made."
                  : "Public PRs work without a token. An optional GITHUB_TOKEN raises API limits; it does not repair network or access failures."}
              </p>
              <code>GITHUB_TOKEN</code>
            </div>
          </article>
          <article className="integration-row">
            <div>
              <h3>Nebius AI</h3>
              <p>
                Structured behavioral analysis, risk hypotheses, and targeted
                test proposals.
              </p>
            </div>
            <span className="configuration-badge">
              {aiConfigured ? "Configuration present" : "Setup required"}
            </span>
            <div className="integration-detail">
              <div className="configuration-checks">
                <span>API key: {status.aiKeyPresent ? "Set" : "Missing"}</span>
                <span>
                  Model selection: {status.aiModelPresent ? "Set" : "Missing"}
                </span>
              </div>
              <p>
                {aiConfigured
                  ? "The exact model is validated against the account catalog when inference starts. No model request is made from this page."
                  : "Without both values, live reports retain deterministic risk analysis and heuristic observations. No AI findings or tests are invented."}
              </p>
              <div className="integration-variables">
                <code>NEBIUS_API_KEY</code>
                <code>NEBIUS_MODEL</code>
                <code>DEMO_MODE</code>
              </div>
            </div>
          </article>
          <article className="integration-row">
            <div>
              <h3>Repository execution</h3>
              <p>
                Build, type, existing-test, and proposed-test checks at the
                analyzed revision.
              </p>
            </div>
            <span className="configuration-badge">
              {status.provider === "disabled"
                ? "Disabled"
                : status.executionConfigured
                  ? "Configuration present"
                  : "Setup incomplete"}
            </span>
            <div className="integration-detail">
              <p>
                Selected provider: <strong>{providers[status.provider]}</strong>
                . Runtime availability is checked during analysis. A configured
                provider only executes explicitly allowed repositories.
              </p>
              <details className="settings-prerequisites">
                <summary>View execution prerequisites</summary>
                <dl className="settings-definitions">
                  <div>
                    <dt>Provider selected</dt>
                    <dd>{providers[status.provider]}</dd>
                  </div>
                  <div>
                    <dt>Execution switch</dt>
                    <dd>
                      {status.executionEnabled ? "Enabled" : "Not enabled"}
                    </dd>
                  </div>
                  <div>
                    <dt>Repository allowlist</dt>
                    <dd>
                      {status.allowlistPresent ? "Present" : "Not configured"}
                    </dd>
                  </div>
                  <div>
                    <dt>Environment gate</dt>
                    <dd>
                      {status.environmentPermitsExecution
                        ? "Permits execution"
                        : "Does not permit execution"}
                    </dd>
                  </div>
                  {status.provider === "nebius" && (
                    <div>
                      <dt>Sandbox credentials</dt>
                      <dd>
                        {status.sandboxCredentialsPresent
                          ? "Required values present"
                          : "Required values missing"}
                      </dd>
                    </div>
                  )}
                </dl>
              </details>
              <div className="integration-variables">
                <code>SANDBOX_PROVIDER</code>
                <code>ENABLE_LOCAL_SANDBOX</code>
                <code>ENABLE_NEBIUS_SANDBOX</code>
                <code>ENABLE_PRODUCTION_SANDBOX</code>
                {(status.provider === "nebius"
                  ? [
                      "NEBIUS_SANDBOX_REPOSITORIES",
                      "NEBIUS_SANDBOX_TOKEN",
                      "NEBIUS_SANDBOX_PROJECT_ID",
                      "NEBIUS_SANDBOX_IMAGE",
                    ]
                  : ["LOCAL_SANDBOX_REPOSITORIES"]
                ).map((name) => (
                  <code key={name}>{name}</code>
                ))}
              </div>
              <Link href="/how-it-works#execution" className="text-link">
                Execution requirements
                <ArrowRight size={13} />
              </Link>
            </div>
          </article>
        </div>
      </section>
      <section className="settings-section" aria-labelledby="setup-heading">
        <div className="section-heading">
          <h2 id="setup-heading">Update this workspace</h2>
        </div>
        <ol className="settings-setup">
          <li>
            Use <code>.env.example</code> as the configuration reference and
            keep credentials in the server’s <code>.env.local</code>.
          </li>
          <li>
            Choose demo or live GitHub analysis. Add Nebius credentials and an
            exact eligible model only when AI inference is needed.
          </li>
          <li>
            For execution, select a provider, enable it, and configure the exact
            repository allowlist. Production requires its additional execution
            gate. Native execution is limited to trusted development
            environments.
          </li>
          <li>
            Restart the app, then return here and refresh the status. Real
            provider access is established by a successful analysis, not
            configuration presence.
          </li>
        </ol>
        <Link href="/how-it-works" className="text-link">
          Read the full workflow and limitations
          <ArrowRight size={14} />
        </Link>
      </section>
    </div>
  );
}
