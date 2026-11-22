# AI Change Verifier

AI Change Verifier reviews a public GitHub pull request at recorded base and head commits. It ranks changes for human review and shows how each finding was reached. Reviewers can inspect the diff, check execution evidence, save decisions, and prepare a PR comment.

## Quick starts

The [CI workflow](.github/workflows/ci.yml) uses Node.js 22 and the [Action](action.yml) defaults to Node.js 24. For the browser and CLI, start at the project root. On a fresh clone, use npm’s `ci` subcommand to install the lockfile dependencies, including development tools.

### 1. Run the demo in a browser

```sh
npm run dev
```

Open [the local app](http://127.0.0.1:3000) and select **Run the demo**. It loads a synthetic password-reset PR and executes bundled assertions locally. You can try it without GitHub, a model key, or a sandbox provider. Follow the [walkthrough](docs/DEMO.md) to inspect the token-reuse failure.

### 2. Print a demo PR comment

```sh
npm run --silent review -- --demo
```

The CLI writes the comment to stdout and the run ID and progress to stderr. Add `--format json --out report.json` to save the full report as UTF-8. See the [CLI options and exit codes](docs/INTEGRATIONS.md#command-line).

### 3. Add the GitHub Action

In the repository being reviewed, save this workflow under `.github/workflows/`. Replace `<trusted-full-commit-sha>` with an immutable revision of this action that you trust.

```yaml
name: Review pull request
on: pull_request
permissions:
  contents: read
  pull-requests: write
concurrency:
  group: change-verifier-${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: IshrakFaisal/ai-code-reviewer@<trusted-full-commit-sha>
```

With the default inputs, the Action uses heuristics. A successful review writes a job summary and creates or updates one bot comment on a same-repository PR. Fork PRs receive the summary only. [Action inputs and publication policy](docs/INTEGRATIONS.md#github-action)

## Features

| To do this | Start here |
| --- | --- |
| Analyze a live PR using its diff and optional Nebius inference | Set `DEMO_MODE=false`, then use the form in `npm run dev` or pass the public PR URL to `npm run --silent review --`. [Configuration](docs/INTEGRATIONS.md#live-analysis) |
| Inspect a finding and decide what to share | In the browser report, use **Findings**, **Workbench**, and **Verification**. Save a decision in **Your review**, then use **Preview comment** or **Copy PR comment**. PDF, Markdown, and JSON downloads are also available. |
| Recover an investigation | In **History → Unfinished analyses**, open a run, resume a paused or interrupted run, or confirm discard of an inactive checkpoint. History also supports searching and comparing completed reports. |
| Compare behavior at base and head | Select **Reproduce & repair** on a finding with a supported test. The demo has a curated repair. Live paired runs require a configured Docker or Nebius provider. [Walkthrough](docs/DEMO.md) |
| Evaluate findings against human labels | Use `npm run --silent eval` to sample or review PRs, then `npm run --silent eval:score` to score the saved labels. [Evaluation workflow](#evaluation) |

## Reading the evidence

- **AI inference** proposes behavioral changes, risks, and tests. Citation checks establish which referenced paths and lines can be located.
- **Static analysis** inspects retrieved patches and applies deterministic rules. The risk score sets review priority.
- **Actual execution** records which checks ran, where they ran, and their results. Demo assertions exercise bundled code. A failed generated test needs human inspection.

A verified citation has a confirmed line or range. A path-only citation keeps its path. An unanchored finding stays in the report and contributes to the omission count in the PR comment. Older reports can have unchecked citations.

## Evaluation

Sampling and analysis require live mode. The harness keeps repository execution disabled. Sampling reads GitHub, and analysis can incur inference charges when configured.

```sh
npm run --silent eval -- --sample-merged owner/repo --limit 10
npm run --silent eval -- --sample-reverted owner/repo --limit 10
npm run --silent eval -- --urls eval-output/sample-timestamp/urls.txt --dry-run
npm run --silent eval -- --urls eval-output/sample-timestamp/urls.txt
npm run --silent eval:score -- eval-output/run-timestamp/labels.csv
```

Replace the repository and timestamp placeholders with your own. Sampling saves reusable URLs. Each review run has its own output directory. Label blind using the original PRs and `labels.csv` (up to 20 AI findings per PR). Enter `useful`, `false_positive`, or `unclear`, and mark invented references with `y` or `n`. Leave unknown labels blank. Record whether a reverted PR's known issue was caught in `prs.csv`.

Keep `anchors.csv`, the comments, `index.md`, and `summary.json` closed until scoring. The scorer joins human labels to citation status and comment rank by finding key. Shown-only precision measures usefulness among decisive verdicts on displayed findings. Guard recall measures the share of invented references flagged. Guard precision measures the share of flagged findings labeled invented. Blind spots count verified locations reviewers labeled invented.

## Limitations

- Live retrieval accepts public GitHub PRs. The retriever rejects private repositories. Private-repository support is **not verified**.
- Live generated tests target isolated Node Vitest projects. Missing source, unsupported tooling, and incomplete diffs limit what can be checked.
- Repository execution requires an enabled provider and an exact repository allowlist. The CLI does not turn execution on. The Action refuses inherited execution opt-ins.
- One owner uses one Node process and persistent local filesystem storage. There is no database or distributed worker coordination.
- A real GitHub Actions run and sticky-comment publication are **not verified**. Local fixture tests cover the publication logic.
- Evaluation is a small, hand-labeled sample. Review accuracy on a representative benchmark is **not verified**.

## Project guides

[Demo walkthrough](docs/DEMO.md) · [Integrations](docs/INTEGRATIONS.md) · [Architecture](docs/ARCHITECTURE.md) · [Validation record](docs/VALIDATION.md) · [Coding-session handoff](docs/HANDOFF.md)
