# Architecture

The Next.js App Router serves a single owner's workspace. The browser and CLI each call the same investigation implementation. A report identifies its source revisions, evidence, and limitations. Reviewer decisions have their own lifecycle.

## Follow one pull request

| Stage | What crosses the boundary |
| --- | --- |
| Input and retrieval | The [GitHub retriever](../src/lib/github/pull-request.ts) rejects private repositories, records the base/head SHAs, and pages through changed files. It rereads the revisions to detect drift. Missing patches and the file cap are recorded as limitations. |
| Initial analysis | The [investigator](../src/lib/agent/investigator.ts) orchestrates classification, behavioral observations, and deterministic risk signals. Demo mode substitutes a bundled PR. Live analysis can use heuristics alone. |
| Model inference | The [Nebius provider](../src/lib/ai/nebius.ts) requests structured hypotheses. Zod validates the output and the provider allows one repair retry. [Test context](../src/lib/ai/test-context.ts) retrieves bounded source and nearby tests at the recorded head when preparing a test proposal. |
| Risk and verification | The [risk engine](../src/lib/risk/engine.ts) scores review priority. [Static checks](../src/lib/verification/static.ts) inspect the diff. The [runner](../src/lib/verification/runner.ts) checks execution availability and records commands, skipped checks, and finding evidence. Demo verification executes [bundled fixture assertions](../src/lib/demo/fixture.ts). |
| Citations and final priority | After retrieval and verification, [citation anchoring](../src/lib/ai/anchor-references.ts) checks model paths and line ranges against the appropriate diff side or retrieved head-file extent. Unknown paths remain visible. The investigator updates deterministic scores using available evidence and orders findings for review. |
| Report | The [report schema](../src/lib/reports/schema.ts) validates storage reads and writes. Nine [report sections](../src/lib/reports/sections.ts) share one view. Separate workflows handle saved decisions, comparison, and [paired reproduction and repair](../src/lib/regression/workflow.ts). |
| Outputs | The [comment builder](../src/lib/reports/pr-comment.ts) selects eligible findings, drops unverifiable line numbers and counts unanchored omissions. The web header copies Markdown; the [CLI](../scripts/review-cli.ts) writes Markdown or full JSON. The [Action](../scripts/pr-action.ts) uses the CLI output for a job summary and, on same-repository PRs, a sticky bot comment. |
| Evaluation | The [harness](../scripts/eval.ts) joins original checkpoint citations to finding IDs when available. It writes blind labels and machine anchor decisions separately. The [scorer](../scripts/eval-score.ts) joins them by PR URL and finding ID. |

## Local state

| Location | Contents |
| --- | --- |
| `.data/runs/` | [Run records](../src/lib/agent/run-store.ts), step checkpoints, stage events, attempts, and completed report IDs. |
| `.data/reports/` | [Validated analyses](../src/lib/reports/store.ts). Saving retains the newest 100 valid reports. |
| `.data/reviews/` | [Saved reviewer decisions and notes](../src/lib/reports/review-store.ts) scoped to the report and head revision. Unsaved browser drafts use session storage. |
| `.data/regressions/` | [Reproduction and repair results](../src/lib/regression/store.ts), stored separately from the original report. |
| `eval-output/` | Per-run URL lists, comments, label sheets, summaries and scores written by the evaluation commands. |

## Run lifecycle

1. The browser starts a run through `POST /api/analyze`. The CLI calls the [same manager](../src/lib/agent/runs.ts) directly. Each process tracks its own active jobs; the disk checkpoint allows recovery.
2. Refreshing the progress URL reconnects to the same ID. Successful steps are checkpointed. Explicit pause aborts the active attempt and retains the record. A deadline or execution error can leave an interrupted run.
3. History lists unfinished records. A stored running record without an active job in this process appears interrupted. Resume explicitly restarts work from saved steps at the recorded revisions. Confirmed discard removes an inactive checkpoint; an active run receives a conflict.
4. Completion saves the validated report and records its ID. Returning to a completed report reads saved evidence. A new analysis creates its own run.

Coordinate the server and CLI as a single-owner installation with persistent disk. The in-memory active-job registry does not coordinate concurrent processes or distributed workers.
