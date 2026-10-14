# Validation record

## Workspace UI redesign — October 14, 2026

| Check                     | Result                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`            | Pass, no warnings                                                                                                                                                   |
| `npm run typecheck`       | Pass                                                                                                                                                                |
| `npm test`                | 227 passed; 2 opt-in sandbox integrations skipped (23 files)                                                                                                        |
| `npm run build`           | Pass, Next.js 16.3.6 production build                                                                                                                               |
| `git diff --check`        | Pass                                                                                                                                                                |
| Responsive browser checks | Workspace, history, and reports checked at 1440, 768, 390, and 320 pixels; no document-level horizontal overflow                                                    |
| Review interactions       | Finding filters, expanded generated tests/output, active report-section navigation, saved decision/note persistence, Markdown copy/download, and JSON export passed |
| Analysis states           | Invalid URL feedback, streamed demo investigation, GitHub 404 with retry/demo actions, and missing-report state checked                                             |
| Final production preview  | Workspace, history, saved demo report, persisted decisions, and missing-report state rendered successfully; browser logged no warnings or errors                    |

The redesign preserves the existing routes, API integration, analysis stages, and verification semantics. The overview now shows real local report activity; the shared report list retains accessible column headers on phones. Demo evidence remains explicitly labeled as execution against a synthetic fixture. One new demo report was created for UI validation; only that report received the test reviewer note.

The demo completed with three passing fixture assertions and the expected token-reuse assertion failure. This UI validation did not make credentialed Nebius inference or remote sandbox calls. The two integration tests remain opt-in; passing the regular suite does not establish live sandbox availability.

The initial restricted test process denied filesystem links required by store tests; the final suite passed with normal Windows permissions. An interrupted preview start was temporarily blocked by the automatic approval reviewer's usage limit; the subsequent approved start succeeded. The production preview is running at `http://127.0.0.1:3001`. Git emits Windows LF-to-CRLF notices, with no whitespace errors.

Screenshots are saved in ignored `artifacts/`: `ui-redesign-workspace-desktop.jpg`, `ui-redesign-workspace-mobile.jpg`, `ui-redesign-report-desktop.jpg`, and `ui-redesign-report-mobile.jpg`. The design system and page conventions are documented in [DESIGN.md](DESIGN.md).

## GitHub connection fixes — October 13, 2026

| Check                       | Result                                                                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`              | Pass, no warnings                                                                                                                                                                         |
| `npm run typecheck`         | Pass                                                                                                                                                                                      |
| `npm test`                  | 227 passed; 2 opt-in sandbox integrations skipped (23 files)                                                                                                                              |
| `npm run build`             | Pass, Next.js 16.3.6 production build                                                                                                                                                     |
| Production live PR analysis | `remzi-arpacidusseau/ostep-homework` #94 and #95, plus `octocat/Hello-World` #11297: real metadata/files retrieved, all 14 stages streamed, LIVE reports saved and rendered with HTTP 200 |
| Production demo and history | Demo completed with three fixture assertions passing and the expected token-reuse assertion failing; report and history pages returned HTTP 200                                           |
| Browser                     | Live report for PR #95 rendered successfully; saved review API returned HTTP 200                                                                                                          |

The original GitHub failures were reproduced in the restricted coding-agent process. The same public endpoints returned HTTP 200 with normal Windows permissions. Seven initial tests also failed because that process denied hard links and junctions; all passed under normal permissions without changing the working review store. A subsequent restricted build was denied access to a generated Next.js directory; the final build succeeded with normal permissions.

The installed Octokit fetch transport ignores the old `request.timeout` setting. GitHub requests now enforce a 20-second abort signal per attempt, allow at most two retries for transient read failures, preserve analysis cancellation, and distinguish server DNS/permission/timeout failures, upstream HTTP errors, access restrictions and exhausted rate limits. Nineteen client regression tests and one retrieval cancellation test were added. An intermediate test-logger TypeScript error was corrected before final validation.

Live smoke checks used public GitHub APIs without a token. AI inference and repository execution were explicitly disabled in the temporary smoke server; these checks do not establish live Nebius inference or sandbox execution. The temporary server was stopped. The regular development server was then started with the user's existing `.env.local` at `http://127.0.0.1:3001` and left running. Browser proof is saved at `artifacts/github-analysis-fixed.jpg`.

## Human review checklist — October 12, 2026

| Check                | Result                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run lint`       | Pass, no warnings                                                                              |
| `npm run typecheck`  | Pass                                                                                           |
| `npm test`           | 207 passed; 2 opt-in sandbox integrations skipped (22 files)                                   |
| `npm run build`      | Pass, Next.js 16.3.6 production build                                                          |
| Demo review workflow | Save decision and note, reload persistence, decision filter, Markdown copy and download passed |

Review notes are stored with each report and head commit. Exports retain the original verification evidence and identify reviewer decisions separately. No live API credentials or external GitHub writes were used for this feature validation.

## Remote sandbox completion — September 28, 2026

| Check                                             | Result                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `npm run lint`                                    | Pass, no warnings                                                                                            |
| `npm run typecheck`                               | Pass                                                                                                         |
| `npm test`                                        | 174 passed; 2 opt-in live integration tests skipped (19 files total)                                         |
| `npm run build`                                   | Pass, Next.js 16.3.6 production build                                                                        |
| Production browser demo                           | Home → streamed investigation → saved report passed on temporary port 3001                                   |
| Verification progress                             | Saved report records RUNNING before execution and COMPLETE after it; interrupted runs cannot appear complete |
| `npm run test:nebius-sandbox` without credentials | Correctly reports missing token, project ID and image UUID before any API request                            |

The Nebius ConTree stub has been replaced by a server-side REST provider and wired into provider selection. Twenty HTTP transport tests and nine provider workflow tests cover bounded/validated responses, cancellation and independent cleanup, credential exclusion, exact revision checks, checkpoint chaining, offline verification, generated file/report guards, and preservation of known failures. The default test suite makes no credentialed remote execution calls.

Real Docker execution remains skipped because Docker is unavailable on this host. Real Nebius execution and NVIDIA inference await user-supplied account configuration. The new remote smoke test is explicitly opt-in and potentially billable; it retains one tiny public checkpoint under Nebius's service policy. An implemented adapter and passing contract tests do not establish live account access or image compatibility.

No final lint/typecheck/test/build errors or warnings were emitted. Git additionally reported Windows LF-to-CRLF conversion notices; `git diff --check` reported no whitespace errors. An intermediate test used the demo's actual head SHA as its intended mismatch; that fixture was corrected before the final passing run.

The browser report screenshot is saved locally at `artifacts/completed-demo-report.png`. Temporary validation servers are stopped after testing. Setup and the credentialed validation commands are documented in [integration notes](INTEGRATIONS.md#nebius-remote-execution).

## Completion of partially implemented features — September 28, 2026

| Check                     | Result                                                                         |
| ------------------------- | ------------------------------------------------------------------------------ |
| `npm run lint`            | Pass, no warnings                                                              |
| `npm run typecheck`       | Pass                                                                           |
| `npm test`                | 141 passed; 1 opt-in Docker integration test skipped (15 files total)          |
| `npm run build`           | Pass, including the Next.js request proxy                                      |
| Production browser demo   | Home → streamed investigation → saved report passed on temporary port 3001     |
| Production CSP            | Nonce header matched rendered script nonce; no production unsafe-eval          |
| Invalid PR input          | HTTP 400                                                                       |
| Model configuration check | Correctly reported missing NEBIUS_API_KEY; no credentialed inference attempted |

New coverage includes AI category refinement through the live investigation pipeline, catalog validation without model substitution, API authentication/origin/body boundaries, provider selection, setup/cleanup/cancellation, dependency and API diff detection, subprocess limits, and an actual isolated Vitest harness on Windows. The harness rejects assertion-free tests and ignores adjacent repository workspace configuration. Sandbox contract tests exercise container resource flags, secret exclusion, the offline execution barrier, immutable revision arguments, and stale/incorrect test reports.

One attempted build found an already-running build holding Next.js's lock. No active process or lock was removed; the later validation build succeeded. Intermediate sandbox TypeScript errors were corrected before the final pass.

Docker is not installed on this host. `npm run test:sandbox` explicitly enables the real Linux-container integration test and requires a pre-pulled `node:22-bookworm` image. A separate CI job now runs this check on Ubuntu, but that job has not been run from this workspace. Normal test success does not establish real container isolation or npm/pnpm/Yarn compatibility in every repository.

At this earlier validation checkpoint, live NVIDIA inference still required credentials and the remote Nebius ConTree provider was an explicit stub; the section above records its subsequent implementation. Native execution remains trusted-development-only. Authenticated Docker deployment remains single-owner and needs a dedicated worker/VM; multitenant production readiness is not claimed.

## Initial MVP validation

Validated locally on September 27, 2026 (Asia/Dhaka).

| Check                                              | Result                                                                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                                     | Pass, no warnings                                                                                                    |
| `npm run typecheck`                                | Pass                                                                                                                 |
| `npm test`                                         | 51 tests passed across 7 files                                                                                       |
| `npm run build`                                    | Pass, optimized Next.js production build                                                                             |
| Browser demo: workspace → progress → saved report  | Pass                                                                                                                 |
| Failed fixture output and generated-test expansion | Pass                                                                                                                 |
| High-priority finding filter                       | Pass                                                                                                                 |
| Invalid GitHub URL error                           | Pass                                                                                                                 |
| Repository + PR number submission                  | Pass                                                                                                                 |
| Report history / mobile navigation                 | Pass                                                                                                                 |
| Mobile home and report at 390px viewport           | No document-level horizontal overflow                                                                                |
| Built app live GitHub smoke test                   | Public `octocat/Hello-World` PR #11297 retrieved; 1 changed file; 14 stages; persisted LIVE report returned HTTP 200 |

The live smoke test used no model credentials and disabled repository execution. All runtime checks remained NOT_RUN; no demo fixture evidence leaked into the LIVE report.

The test suite includes the intentionally defective demo fixture. Its **three passing assertions and one expected failing assertion** are the expected successful test-suite outcome. This is separate from the 51 application tests, which all pass.

### Environment limits at the initial validation

- A paid/authenticated Nebius request with an eligible NVIDIA model.
- The remote ConTree sandbox adapter and provisioned instance.
- Local repository execution on Linux/macOS/WSL with an explicitly trusted npm repository. The development host was Windows; the production execution gate was unit-tested, not bypassed.
- Hosted/multitenant deployment, authentication and distributed storage/queue operation.

Start the browser preview with `npm run dev` at `http://127.0.0.1:3000`. Temporary validation servers are stopped after testing.
