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

Label blind. Open `labels.csv` and the source PRs first. Leave `anchors.csv`, the comments, `index.md`, and `summary.json` closed until scoring.
Each PR contributes up to 20 AI findings in finding-ID order. Inspect every cited location. Original citations come from the completed run checkpoint when available.
Enter `useful`, `false_positive`, or `unclear` for the verdict and `y` or `n` for an invented file, line, or symbol. Leave unknown labels blank.
In `prs.csv`, record whether the review caught the known issue for each reverted PR. Save both sheets as CSV and run `eval:score`.
`anchors.csv` records every AI finding’s status, reason, and comment rank. Older unchecked findings use `not-checked`.
`index.md` links the comments. It and `summary.json` count verified, path-only, unanchored, and omitted findings per PR. Omitted includes findings beyond the comment limit.

- Shown-only precision is useful findings divided by useful plus false positives among the findings shown.
- Guard recall is the fraction of human-labeled invented references flagged as path-only or unanchored.
- Guard precision is the fraction of flagged findings with a yes/no reference label that reviewers marked invented.
- Blind spots count verified locations that reviewers marked invented. Below 20 verdicts, scores are indicative only.

Sampling saves reusable URLs. Add `--run` to analyze them immediately. Defaults are 10 PRs (maximum 25), 10–400 changed lines, 30 files maximum, 60 candidates, and 2 seconds between reviews.
Three consecutive failures stop analysis. Ctrl+C preserves completed outputs. Configured AI reviews can incur charges.

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
