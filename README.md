# AI Change Verifier

An evidence-backed review workspace for public GitHub pull requests, built for the **Nebius × NVIDIA Global AI Hackathon**. Identify risky changes, inspect test evidence, and review proposed repairs.

## Features

- Analyze PR diffs, behavioral changes, affected systems, and explainable risk scores.
- Inspect changed files, findings, generated tests, execution output, and verification gaps in one workbench.
- Pause and resume investigations from saved checkpoints.
- **Reproduce → Repair → Recheck:** compare the same test at base/head commits, propose a bounded repair, and rerun checks.
- Save review decisions and notes, recover unsaved drafts, and follow a prioritized action plan.
- Search history, compare reports, check GitHub revision freshness, and export reports, tests, evidence, and proposed patches.

## Run locally

Requires **Node.js 22.13+ or 24 LTS** and npm.

```bash
npm ci
npm run dev
```

Open **http://127.0.0.1:3000** and select **Run the demo**. The demo uses a synthetic PR and real bundled fixture execution; no API key, Docker, or database is required.

## Live configuration

Copy [`.env.example`](.env.example) to `.env.local`. To enable real GitHub analysis with AI:

```dotenv
DEMO_MODE=false
NEBIUS_API_KEY=your-nebius-api-key
NEBIUS_MODEL=your-available-nvidia-model-id
```

Use the exact NVIDIA model ID available in your Nebius account. Restart the app after configuration changes. Keep `.env.local` and credentials out of Git.

| Capability                                         | Requirements                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| Public GitHub analysis without AI                  | `DEMO_MODE=false` and network access; `GITHUB_TOKEN` is optional.                 |
| AI analysis, test generation, and repair proposals | Nebius inference key and an available NVIDIA model.                               |
| Real repository test execution                     | Configured Docker or Nebius sandbox and an explicit trusted-repository allowlist. |

An inference key alone does not enable repository execution. See [Windows Docker setup](docs/DOCKER-WINDOWS.md) and [integration configuration](docs/INTEGRATIONS.md).

## Commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

After building, run `npm start` for the production server at **http://127.0.0.1:3000**.

## Scope and limitations

- Public repositories only. Live reproduction/repair supports compatible root Node.js projects using Vitest 3.2+ or 4.
- Findings and passing tests support only the recorded behavior; incomplete diffs and unexecuted checks remain evidence gaps. Applying patches and merging require human review.
- Single-owner workspace with one Node server process and persistent local storage. Reports and checkpoints live in `.data/`; the newest 100 completed reports are retained. Public hosting requires HTTPS and configured owner authentication.

For a walkthrough, open **How it works** in the app. See the [demo guide](docs/DEMO.md) and [validation record](docs/VALIDATION.md) for detailed usage and tested limits.
