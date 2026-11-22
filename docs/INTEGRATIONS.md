# Integration guide

## Live analysis

Start from the project root. Copy the settings you need from [the environment template](../.env.example) into a local `.env.local`, or supply them through the server environment. Keep credentials out of Git and restart the server after changing settings. The browser form accepts a public GitHub PR URL, or a repository and PR number.

| Purpose | Settings and behavior |
| --- | --- |
| Public GitHub retrieval | Set `DEMO_MODE=false`. The server needs outbound access to GitHub's API. `GITHUB_TOKEN` is optional for public PRs and can raise the API rate limit. Browser analysis and the evaluation harness accept public repositories only. |
| Optional inference | Set `NEBIUS_API_KEY` and `NEBIUS_MODEL` to an account-enabled model ID. The adapter checks the model catalog and validates structured responses. Live mode without a model uses deterministic analysis. |
| Model endpoint and family | `NEBIUS_BASE_URL` selects the HTTPS inference endpoint. `NEBIUS_REQUIRE_NVIDIA` defaults to true and requires the NVIDIA namespace. Account access is **not verified**. |
| Investigation budget | `MAX_INVESTIGATIONS` bounds the hypotheses selected. `RISK_WEIGHTS_JSON` accepts numeric overrides for recognized deterministic risk signals. |
| Public web access | Configure an HTTPS `APP_ORIGIN`, `APP_AUTH_USERNAME`, and `APP_AUTH_PASSWORD` of at least 24 characters. The default local server binds to loopback. [Request checks](../src/lib/security.ts) |

If retrieval fails, check outbound access to GitHub's API and the error reported by the server. Each read attempt has a 20-second deadline. The client retries transient read failures up to twice. A change to the base or head during retrieval requires a new analysis. [GitHub client](../src/lib/github/client.ts)

The optional `npm run verify:nebius` makes a potentially billable model request. Credentialed inference is **not verified** in the [validation record](VALIDATION.md).

## Command line

The CLI loads the environment and local `.env.local`, starts a resumable investigation, and uses the same report storage as the web app. Use npm's `--silent` option for clean stdout. Replace the example URL with the public PR you want to inspect.

```sh
npm run --silent review -- --demo
npm run --silent review -- https://github.com/owner/repo/pull/123
npm run --silent review -- --demo --format json --out report.json
```

Markdown is the default output. `--format json` selects the full analysis. The run ID and progress go to stderr. `--quiet` suppresses progress. Use `--out` for UTF-8 output, particularly in Windows PowerShell 5.1 where `>` writes UTF-16. Ctrl+C or a CLI timeout requests a pause. Public runs can resume from History.

| Exit | Meaning |
| --- | --- |
| 0 | Review completed below the selected failure threshold, or the threshold is disabled. |
| 1 | Invalid input, configuration, or output error. |
| 2 | Analysis failed, paused, or timed out. |
| 3 | Review priority met `--fail-on medium` or `--fail-on high`. The default is `none`. |
| 130 | Interrupted by Ctrl+C. |

The CLI reads the PR and prints or saves its output. It does not publish comments or enable execution. A separately configured execution provider still applies its repository gate. [CLI implementation](../scripts/review-cli.ts)

## Private repositories

For a static review, set `DEMO_MODE=false` and supply a `GITHUB_TOKEN` that can read the repository and PR. Run:

```sh
npm run --silent review -- https://github.com/owner/repo/pull/123 --allow-private
```

The equivalent Action input is `allow-private: 'true'`. Private PRs are opt-in for each invocation. If inference is configured, a private review without AI consent records “AI analysis skipped: private repository without --allow-private-ai” in CLI stderr, the PR comment and the Action summary.

To send private data to the configured Nebius endpoint, also pass `--allow-private-ai` or set the Action input `allow-private-ai: 'true'`. Both Action inputs default to `'false'` and accept only `'true'` or `'false'`. Both permissions and the configured inference key and model are required for private AI.

Inference receives the PR title, description, head SHA, changed paths, categories, risk scores and reasons, and bounded patches (up to 60 files and 75,000 patch characters). Test planning also sends the hypothesis, context limitations, and up to 12 excerpts of source, nearby tests, configuration, or dependencies from the pinned head, with file paths and blob metadata (60,000 excerpt characters total).

Local reports and checkpoints in the git-ignored `.data/` directory contain private source excerpts. A full JSON export also contains patches. Private reviews do not execute repository code. A successful Action publishes the review summary in the job and, for same-repository PRs, in a sticky comment. Restart an interrupted private review from the CLI with the intended flags. A real private-repository run is **not verified**.

## GitHub Action

Use the [consumer workflow snippet](../README.md#3-add-the-github-action) for a public PR, or add the inputs above for a private PR. Pin the Action to a trusted full commit. The Action reads the pull request through GitHub's API and installs the verifier's own dependencies with lifecycle scripts disabled. It refuses inherited local or remote execution opt-ins. [Composite action](../action.yml)

| Input | Effect |
| --- | --- |
| `github-token` | Defaults to the job token. Grant contents read and pull requests write for same-repository comments. Use the default bot identity. |
| `nebius-api-key` | Optional inference secret. If supplied, set `NEBIUS_MODEL` in the step environment. Limit access to trusted events. |
| `fail-on` | Accepts `none`, `medium`, or `high`. A threshold failure is reported after the successful review is published. |
| `strict` | Defaults to false. A CLI error writes an unavailable summary. Strict mode also fails the job on that error. Publication errors fail the job. |
| `node-version` | Selects the Node version used to run the verifier. Defaults to 24. |

A successful same-repository review updates the existing marker-tagged bot comment or creates it on the first run. A fork review writes only the job summary. The [project's own workflow](../.github/workflows/pr-review.yml) runs the implementation from the PR head, so same-repository contributors must be trusted. It withholds the inference secret from forks. Real GitHub Actions publication is **not verified**. [Publisher](../scripts/pr-action.ts)

## Repository execution

Leave `SANDBOX_PROVIDER=disabled` for a review that only reads GitHub. For execution, a provider must be enabled **and** the public repository must match an exact entry in its comma-separated allowlist.

| Provider | Required operator configuration |
| --- | --- |
| Docker | `SANDBOX_PROVIDER=docker`, `ENABLE_LOCAL_SANDBOX=true`, and `LOCAL_SANDBOX_REPOSITORIES`. `SANDBOX_DOCKER_IMAGE` selects the pre-pulled Linux image. [Windows setup](DOCKER-WINDOWS.md) |
| Native development | `SANDBOX_PROVIDER=native` uses the same local enable flag and allowlist. It runs trusted code on the host, requires development mode and refuses native Windows. Paired reproduction requires Docker or Nebius. |
| Nebius remote | `SANDBOX_PROVIDER=nebius`, `ENABLE_NEBIUS_SANDBOX=true`, `NEBIUS_SANDBOX_REPOSITORIES`, an IAM `NEBIUS_SANDBOX_TOKEN`, `NEBIUS_SANDBOX_PROJECT_ID`, and an imported image UUID in `NEBIUS_SANDBOX_IMAGE`. `NEBIUS_SANDBOX_BASE_URL` selects the service endpoint. |

Production execution also requires `ENABLE_PRODUCTION_SANDBOX=true` with Docker or Nebius. The [provider gate](../src/lib/sandbox/factory.ts) checks the process mode and repository. Docker and Nebius use networking for clone/install and disable it for verification. The remote adapter uses checkpoint images. Cancellation releases local handles and requests cancellation of active operations. Remote retention and immediate deletion are **not verified**.

For paired reproduction, the verifier runs the same test twice at both pinned revisions. The package manifest, lockfile, installed Vitest, runtime and image fingerprints must match. A live repair also needs model inference. It rechecks the original head failure, limits proposed edits to existing application source, then reruns the same assertions and repository checks. Download the proposed patch and evidence for human review. [Paired workflow](../src/lib/regression/workflow.ts)

The opt-in `npm run test:sandbox` and `npm run test:nebius-sandbox` require their respective infrastructure. The latter can incur charges. Live sandbox operation is **not verified** in this pass.

## Evaluation

Use the [sampling and scoring commands](../README.md#evaluation) to produce a local `eval-output/` directory. The harness disables repository execution during review. Open the source PRs and blind label sheets first. The scored output is meaningful only for the labeled sample. [Harness](../scripts/eval.ts) · [Scorer](../scripts/eval-score.ts)
