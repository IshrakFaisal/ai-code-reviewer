# AI Change Verifier

An evidence-backed review workspace for public GitHub pull requests, built for the **Nebius × NVIDIA Global AI Hackathon**. Identify risky changes, inspect test evidence, and review proposed repairs.

## Features

- Analyze PR diffs, behavioral changes, affected systems, and explainable risk scores.
- Inspect changed files, findings, generated tests, execution output, and verification gaps in one workbench.
- Pause and resume investigations from saved checkpoints.
- **Reproduce → Repair → Recheck:** compare the same test at base/head commits, propose a bounded repair, and rerun checks.
- Save review decisions and notes, recover unsaved drafts, and follow a prioritized action plan.
- Search history, compare reports, check GitHub revision freshness, and download PDF reports, with Markdown and JSON options. Export tests, evidence, and proposed patches separately.

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

## Command line

For automated PR summaries and a sticky review comment, see the [GitHub Action setup](docs/INTEGRATIONS.md#github-action).

Run from the project root after `npm ci`. The CLI reads the environment and
`.env.local` and saves reports in the same `.data/` store as the web app.

```bash
npm run --silent review -- --demo
npm run --silent review -- https://github.com/OWNER/REPO/pull/123
npm run --silent review -- --demo --format json --out report.json
```

Use `DEMO_MODE=false` for real PRs. `--demo` always selects the bundled fixture.
Stdout contains Markdown by default or JSON with `--format json`. Progress and
the run ID go to stderr. `--quiet` suppresses progress. Windows PowerShell 5.1
writes UTF-16 with `>` redirection. Use `--out <file>` for UTF-8 without BOM.

For CI, set `DEMO_MODE=false` and supply the public PR URL:

```sh
npm ci
npm run --silent review -- "$PR_URL" --fail-on high --out review.md
```

`--fail-on` accepts `none` (default), `medium`, or `high`. Exit codes are
0 for success, 1 for usage or configuration, 2 for failed, timed-out or paused
analysis, 3 for meeting the review-priority threshold, and 130 for Ctrl+C.

## Evaluation

Set `DEMO_MODE=false` and leave execution providers and allowlists disabled.
Sample recent merged PRs or the original PRs identified in revert descriptions:

```bash
npm run --silent eval -- --sample-merged OWNER/REPO --limit 10
npm run --silent eval -- --sample-reverted OWNER/REPO --limit 10
npm run --silent eval -- --urls eval-output/TIMESTAMP/urls.txt --dry-run
npm run --silent eval -- --urls eval-output/TIMESTAMP/urls.txt
npm run --silent eval:score -- eval-output/RUN_TIMESTAMP/labels.csv
```

Sampling writes a reusable URL list. Add `--run` to sample and analyze in one command.
Each run has its own directory. Open its `index.md` to read the comments, then open
`labels.csv` and `prs.csv` in a spreadsheet. Mark verdicts as `useful`,
`false_positive`, or `unclear`. Mark invented file, line, or symbol references
with `y` or `n`. For reverted originals, record whether the review caught the
known issue. Save both sheets as CSV before scoring. Blank cells stay unlabeled.

Defaults are 10 PRs (maximum 25), 10–400 changed lines, at most 30 files,
60 candidates scanned, and 2 seconds between reviews. Three consecutive failures
stop analysis. Ctrl+C preserves completed outputs. Each selected PR incurs one
potentially billable AI analysis when the Nebius key and model are configured.
The scores describe a small hand-labeled sample, not a benchmark.

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
