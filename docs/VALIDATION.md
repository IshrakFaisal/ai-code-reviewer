# Validation record

## Browser draft recovery — October 28, 2026

- Added tab-local draft recovery scoped to report/head, with a 24-hour expiry, bounded validation, storage-failure warnings, and comparison against the original saved baseline. Confirmed saves and resets clear recovery entries. Review unsaved drafts reveals and focuses the first edited finding even when filters hide it.
- Browser checks exposed saved-decision timestamps leaking into draft storage and PATCH payloads. Both boundaries now explicitly serialize only status/note; regression tests exercise edits derived from actual saved decisions.
- Final validation: **438 tests pass; 2 optional sandbox integrations skipped**. Lint, typecheck, production build, and `git diff --check` pass. Seventeen recovery tests cover isolation, expiry, malformed data, storage errors, partial saves, and changed baselines; seventeen client tests cover saving and request validation.
- Browser checks passed for navigation recovery, finding-filter reset with keyboard focus, save-all success, reset followed by reload, and a competing save in another tab producing the recovered-draft comparison warning. The final conflict/reset check ran against the production build. No browser warnings/errors were recorded in that production tab. Browser storage-denial behavior is unit-tested rather than simulated through browser settings.
- Used only synthetic report `373f33cd-95c6-4baf-ac1c-4cb38a7344b9`; its third finding was restored to an empty OPEN decision after smoke tests. Earlier test notes on the first two findings remain unchanged. Live inference and GitHub writes were not exercised.
- Production preview: `http://127.0.0.1:3001`. The earlier dev server and browser sessions had ended during the interruption; the production preview was restarted for verification.

## Draft saving and conflict recovery — October 27, 2026

- Added Save all drafts to Next steps and the review checklist, per-finding Reset draft, save progress, and inline comparison with the latest loaded saved decision. Saves run in order with the last confirmed revision; a failed or conflicting response stops the remaining work without clearing those drafts. Earlier confirmed saves remain saved.
- Review reads and each save have a 15-second deadline. Navigation cancels outstanding saves. Responses must match the report/head, increment the expected revision, and acknowledge the submitted status/note before the draft is cleared. A newer edit is never cleared by an older acknowledgement.
- `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check` pass. **420 tests pass; 2 optional sandbox integration tests remain skipped.** Sixteen new tests cover sequential revisions, partial failures, conflicts, malformed/mismatched acknowledgements, cancellation, deadlines, and draft preservation.
- Production HTTP verification created one new synthetic report (`373f33cd-95c6-4baf-ac1c-4cb38a7344b9`), saved two decisions at revisions 1 and 2, confirmed a stale update returns HTTP 409, and reloaded the unchanged saved decisions. The report renders both review sections with HTTP 200. The initial PowerShell stream parser missed the completion ID; the newly persisted demo report was verified before continuing the checks.
- Browser automation reported that local browser use is disabled in Work settings. Interactive save-button behavior and visual layout for these additions remain unverified this turn; unit and HTTP checks do not replace browser QA. Existing reviewer notes, live inference, repository execution, and GitHub data were not changed. The new synthetic report retains its clearly labeled smoke-test notes.
- The updated production preview runs at `http://127.0.0.1:3001`.

## Review workflow refinements — October 27, 2026

- Added saved-decision file filters, next-step category filters with counts, direct links to every failed/inconclusive evidence record, and a revision retry countdown. Action-plan downloads retain the full plan regardless of the selected category.
- Fixed navigation to filtered findings, opened the selected file’s full patch, exposed standalone generated checks, and corrected doubled anchor spacing. Evidence deduplication now preserves distinct outputs and timings. Unavailable saved decisions no longer appear to be loading indefinitely in the workbench.
- `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check` pass. The full suite passes **404 tests**, with **2 optional sandbox integrations skipped**. Five additional regression cases cover exact evidence targets, distinct execution outputs, saved-decision file filtering, and Retry-After parsing. Windows sandbox restrictions initially blocked existing temporary hardlink/symlink tests; the complete suite passed with the required filesystem access.
- Browser checks passed for saved-decision filters and empty states, action categories, exact evidence navigation after hiding findings, expanded output and keyboard focus, selected-file patch opening, and full Markdown download contents. The report has no page-level horizontal overflow at 390px. Section navigation selects Next steps after anchor navigation. No browser warnings/errors were recorded.
- A saved public `remzi-arpacidusseau/ostep-homework` PR #94 returned matching base/head commits and OPEN state. The retry button displayed a disabled countdown after success. No model inference, live repository execution, GitHub writes, environment edits, or reviewer-note changes were performed.
- Local production preview: `http://127.0.0.1:3001`. Screenshots are saved under `artifacts/review-improvements-*.png`.

## Revision freshness, review action plans, and workbench controls — October 26, 2026

- `npm run lint` and `npm run typecheck` pass without warnings. `npm test`: 399 passed, 2 opt-in sandbox integrations skipped across 37 files. The optimized production build passes with the new revision route.
- Added a manual, authenticated/origin-protected GitHub revision endpoint. A production HTTP check of saved `octocat/Hello-World` PR #11297 returned matching base/head SHAs and OPEN state with a no-store response. An immediate repeat returned HTTP 429 with Retry-After; demo revision checks returned HTTP 400 without calling GitHub.
- The production home, history, settings, guide, demo report, and reproduction pages returned HTTP 200 with the expected sections and no server-rendering error markers. The live report rendered its revision control; its existing saved-review endpoint remained available and matched the recorded head.
- New tests cover base/head drift, snapshot expiry, lifecycle/draft states, private-repository rejection, malformed upstream data, cancellation, authentication/origin/ID boundaries, per-PR cooldown, concurrency limits, deterministic action ordering, saved-decision/evidence separation, deduplication, missing checks, demo provenance, safe Markdown, and combined workbench filters.
- Browser use was disabled in Work settings during this change. Visual checks, live keyboard interaction, and browser-triggered downloads for these additions could not be performed; HTTP and unit validation do not replace that remaining check.
- No Nebius inference, real sandbox execution, GitHub writes, environment edits, or reviewer-note changes were needed. The revision snapshot is session-local and does not update or replace the original report. Docker/remote integration checks remain opt-in.

## Navy workbench interface — October 26, 2026

- `npm run lint`, `npm run typecheck`, and the optimized production build pass without warnings. The checks were repeated after the final UI fixes.
- `npm test`: 369 passed, with 2 optional sandbox integrations skipped across 36 files. Four new diff tests verify independent revision line numbers, multiple hunks, new-file/CRLF/no-newline handling, and metadata without invented source positions.
- Production browser checks passed for file selection/search/empty results, unified diff and generated-test switching, failed assertion output, unexecuted evidence labels, partial-patch scope, and full-finding navigation that clears active finding filters.
- Overview, history, workspace, settings, guide, report, and reproduction pages were inspected with the shared navy/ice-blue palette. History search and mode filtering retained URL state. Report layouts were checked at 1440, 768, 390, and 320 pixels with no document-level horizontal overflow at the narrow widths.
- Browser QA used existing saved reports and the synthetic sample. No live model requests, real sandbox executions, GitHub writes, reviewer-note edits, or environment changes were needed. Docker setup remains pending on this host; the skipped checks do not establish live container execution.

The updated production preview runs at `http://127.0.0.1:3001`. Browser console checks found no warnings or errors. Saved proof: `artifacts/navy-workbench-desktop.png` and `artifacts/navy-workbench-mobile.png`. Windows Git line-ending notices remain informational; `git diff --check` passes.

## Existing workflow improvements — October 26, 2026

| Check                 | Result                                                                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`        | Pass, no warnings                                                                                                                                                                                               |
| `npm run typecheck`   | Pass                                                                                                                                                                                                            |
| `npm test`            | 365 passed; 2 optional sandbox integrations skipped (35 files)                                                                                                                                                  |
| `npm run build`       | Pass                                                                                                                                                                                                            |
| Stream contracts      | Split UTF-8/CRLF, terminal JSON without newline, malformed messages, byte limits, stalled/cancelled reads, reader cleanup, HTML errors, authentication, rate-limit retry delay, and validated report IDs passed |
| Saved evidence        | Structural/hash/revision/verdict/repair validation, corrupt or oversized files, stale scope, preserved valid saves, and newline-containing assertion names covered                                              |
| Browser history       | Search + mode + priority survived reload, Back, Clear filters, and a report visit; new demo report appeared in history                                                                                          |
| Browser investigation | Full 14-stage demo completed through validated messages; returning to the input form left both actions enabled                                                                                                  |
| Browser reproduction  | Comparison, curated repair, saved-result reload, and assertion outcome table passed through validated streaming and persistence                                                                                 |
| Responsive checks     | Comparison at 1440, 768, 390 and 320 pixels; filtered history at 320 pixels; no document-level overflow                                                                                                         |
| Browser diagnostics   | No warnings or errors                                                                                                                                                                                           |

History uses the installed Next.js native-history integration so changing filters does not refetch report payloads. Search edits replace the current history entry; discrete mode/priority changes and Clear filters add entries for Back/Forward navigation. Only report summary metadata reaches the history controls.

Both streamed workflows now share bounded decoding, idle/deadline handling, terminal-message validation, and reader cancellation. Unexpected/truncated completion messages ask the user to reload saved results before retrying. Regression records are checked before display and before replacement; invalid or stale records offer recovery. The comparison retains raw outputs while presenting individual named assertions and explaining inconclusive results. The Docker setup helper now recognizes tabs/spacing and preserves Windows line endings without touching unrelated credential values.

Thirty-one meaningful regression tests were added. Browser QA created one new synthetic analysis report and refreshed only the sample reproduction artifact; no reviewer notes, `.env.local` settings, live model calls, real sandbox runs, or GitHub writes were changed. Docker installation/configuration remains the user's pending machine setup.

Saved proof: `artifacts/improved-assertion-comparison-desktop.jpg`, `artifacts/improved-assertion-comparison-mobile.jpg`, and `artifacts/improved-history-filters.jpg`. Preview: `http://127.0.0.1:3001`. Git emits Windows line-ending notices; whitespace checks pass.

## Reproduce, repair, and recheck — October 26, 2026

| Check                          | Result                                                                                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                 | Pass, no warnings                                                                                                                                                           |
| `npm run typecheck`            | Pass                                                                                                                                                                        |
| `npm test`                     | 334 passed; 2 opt-in sandbox integrations skipped (32 files)                                                                                                                |
| `npm run build`                | Pass, including the reproduction page and streamed action endpoint                                                                                                          |
| `npm run evaluate:regressions` | All five curated cases matched expected classifications; measured case times 234–392 ms in the standalone run                                                               |
| Actual Vitest compatibility    | Unchanged source executed twice per trusted fixture variant with the installed isolated Vitest harness; PASS/PASS at base and FAIL/FAIL at head parsed correctly            |
| Live NVIDIA/Nebius inference   | `npm run verify:nebius` passed catalog access and a Zod-validated structured completion for `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`                                         |
| Production browser workflow    | Repeated base/head fixture comparison, curated repair, assertion disclosure, saved-result reload, and cancellation preserving saved evidence passed                         |
| Downloads                      | Evidence bundle, unchanged test, proposed patch, and reproduction instructions downloaded successfully; source/patch/instructions exactly matched bundle files              |
| Responsive checks              | Workflow at 1440, 768, 390, and 320 pixels; no document-level horizontal overflow                                                                                           |
| Browser console                | No warnings or errors in the final checks                                                                                                                                   |
| Docker setup helper            | Eight tests cover exact-repository selection, preservation of unrelated credentials/configuration, repeated keys, production gate, line endings, and unsafe input rejection |
| `npm run docker:check`         | Expected prerequisite failure: Docker Desktop/CLI is not installed. No environment values were changed                                                                      |

Sixty-five new tests exercise stable assertion comparison, failure provenance, environment/test identity, repeatability, source integrity, repair rechecks, API authentication/origin/body limits, storage, exports, actual guarded source replacement, curated evaluation, and Docker configuration. Setup/type errors and unexpected failures remain inconclusive. Existing report evidence and reviewer decisions are not upgraded or rewritten by this workflow.

The five evaluation cases and browser walkthrough execute application-owned synthetic source only. Their curated repairs and illustrative commit identifiers are explicitly labeled; they are not model accuracy measurements or verification of GitHub code. The real Vitest compatibility check also uses trusted test fixtures and does not establish container isolation. Browser QA saved one separate demo reproduction artifact without creating or modifying an analysis report or reviewer note.

The live inference check made one small credentialed request and confirmed service connectivity/structured output. No real Docker/Nebius sandbox execution, arbitrary repository code, model-generated repair execution, GitHub writes, or public deployment was performed. The user selected Docker; installation/first-run setup remains their manual step. The exact-repository setup command only writes configuration after the Linux engine and official image are available; `.env.local` has not been changed during this task.

An initial test helper omitted the required `NODE_ENV` type and an unused type import produced a lint warning; both were fixed before the final passing checks. Git reports Windows line-ending notices; `git diff --check` passes.

The production preview is running at `http://127.0.0.1:3001`; open `/report/demo/reproduce/finding-1` for the fixture walkthrough. Saved proof: `artifacts/regression-workflow-desktop.jpg`, `artifacts/regression-workflow-mobile.jpg`, and `artifacts/regression-evaluation.txt`. The remaining Docker steps are in [DOCKER-WINDOWS.md](DOCKER-WINDOWS.md), and the submission demo outline is in [DEMO.md](DEMO.md).

## Workspace navigation and product guide — October 25, 2026

| Check                | Result                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| `npm run lint`       | Pass, no warnings                                                                                             |
| `npm run typecheck`  | Pass                                                                                                          |
| `npm test`           | 269 passed; 2 opt-in sandbox integrations skipped (26 files)                                                  |
| `npm run build`      | Pass, including `/workspace`, `/settings`, and `/how-it-works`                                                |
| Workspace navigation | Real report counts, repository groups, recent reports, and repository links to prefilled history passed       |
| Settings navigation  | Sidebar and header links, read-only configuration, execution prerequisites, and Refresh status passed         |
| Detailed guide       | Nine sections, contents links, all 14 investigation stages, FAQ disclosures, and analysis links passed        |
| Responsive checks    | New pages fit at 320 pixels; guide checked at 768 and 1440 pixels; no document-level horizontal overflow      |
| Existing report      | Saved report opened with findings, verification, gaps, comparison link, diffs, and investigation log retained |

Eight new tests cover workspace aggregation and a configuration summary that returns presence flags and fixed provider names without credential values. Settings makes no live provider requests, does not establish connectivity, and does not edit `.env.local`. Configuration changes still require a server restart. No new reports, reviewer notes, credentialed inference requests, sandbox runs, or GitHub writes were created during browser QA.

The sidebar now opens actual workspace and integration pages instead of presenting inactive identity controls. The dedicated guide explains risk, evidence provenance, execution gates, data limits, and the current product boundaries. An initial provider type inference error was corrected before the passing validations. Git emits Windows line-ending notices; whitespace checks pass.

The production preview is running at `http://127.0.0.1:3001`. Browser proof is saved in ignored `artifacts/`: `professional-guide-desktop.jpg`, `professional-guide-mobile.jpg`, `professional-settings-desktop.jpg`, and `professional-workspace.jpg`.

## Verification gaps and finding handoff — October 19, 2026

| Check                     | Result                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run lint`            | Pass, no warnings                                                                                                                                                                          |
| `npm run typecheck`       | Pass                                                                                                                                                                                       |
| `npm test`                | 261 passed; 2 opt-in sandbox integrations skipped (25 files)                                                                                                                               |
| `npm run build`           | Pass, Next.js 16.3.6 production build                                                                                                                                                      |
| Evidence contracts        | 18 new tests cover file-scope boundaries, execution/static/skipped/fixture states, duplicate records, filters, patch limits, export revision checks, Markdown escaping, and download names |
| Production gap explorer   | Summary, high-risk filter, static filter, path search, empty results/reset, ten-row expansion, and expanded evidence passed                                                                |
| File/finding navigation   | Correct original file index opens its diff; related-findings navigation clears filters and shows all findings                                                                              |
| Production handoff        | Unsaved-note export guard, saved decision/note inclusion, clipboard copy, Markdown download, and proposed-test download passed                                                             |
| Download integrity        | Downloaded test source exactly matched the recorded template; Markdown retained demo labeling, pinned commits, and the saved note                                                          |
| Responsive/browser checks | Desktop at 1440 pixels and phone layouts at 390/320 pixels; no document overflow or browser warnings/errors; export controls also checked by keyboard                                      |

The explorer uses exact evidence file-path links rather than assuming that a finding location or an unscoped passing build establishes file verification. Static PASS, NOT_RUN, and fixture-only evidence do not count as repository execution. Failed execution remains visible as a failure; path linkage is not line or behavioral coverage. Drafts are local exports and nothing is automatically posted to GitHub. Downloads never run proposed source.

One new demo report was created for QA, and only that report received the test reviewer note. The synthetic investigation completed its existing fixture workflow. No credentialed inference, remote sandbox run, or live PR reanalysis was performed. No additional dependencies or credentials are required for the new report tools. The local production preview is running at `http://127.0.0.1:3001`.

Browser proof is stored in ignored `artifacts/`: `verification-gaps-desktop.jpg`, `verification-gaps-mobile.jpg`, and `finding-handoff-desktop.jpg`. Git emits Windows line-ending notices; whitespace checks pass.

## Slate and copper palette — October 16, 2026

Replaced the green branding with dark slate navigation, burnt-orange actions, peach analysis panels, and warm stone backgrounds. Updated the shared colors, focus states, charts, code surfaces, mobile navigation, and favicon. Semantic green remains for low risk, passing/completed checks, and added diff lines. No application logic changed.

Lint, explicit type checking, the production build, and whitespace checks passed. The browser confirmed the new rendered colors on the workspace and no document overflow at 320 pixels on the workspace, report, or comparison. No browser warnings or errors were recorded. Key contrast checks include primary buttons (6.31:1), muted text on the darkest accent surface (4.67:1), and sidebar text (8.03:1). The current production preview is `http://127.0.0.1:3001`; its screenshot is saved at `artifacts/copper-workspace-desktop.jpg`.

## Color palette refinement — October 16, 2026

The workspace now uses a forest-green sidebar and mobile navigation, a warm ivory canvas, cream report surfaces, mint analysis tools, and sand/clay supporting accents. Primary controls, focused navigation, the favicon, report summaries, and comparisons follow the same palette. Risk and evidence labels retain their existing meanings.

`npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check` passed. Browser checks covered workspace, filtered history, saved reports, and comparison pages on desktop and small screens; no document-level overflow at 320 pixels or browser warnings/errors were observed. Key text pairs were checked for contrast, including sidebar navigation, primary buttons, semantic status badges, and muted text on tinted surfaces (minimum 4.62:1 among the final checked pairs).

This change touches styling and the favicon, with no changes to analysis or API behavior. No additional tests were added for color constants. The local production app is running at `http://127.0.0.1:3001`. Proof is saved in ignored `artifacts/`: `color-workspace-desktop.jpg`, `color-workspace-mobile.jpg`, and `color-report-desktop.jpg`.

## Follow-up review features — October 16, 2026

| Check                 | Result                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run lint`        | Pass, no warnings                                                                                                                                                                                                  |
| `npm run typecheck`   | Pass                                                                                                                                                                                                               |
| `npm test`            | 243 passed; 2 opt-in sandbox integrations skipped (24 files)                                                                                                                                                       |
| `npm run build`       | Pass, including `/report/[id]/compare`                                                                                                                                                                             |
| Comparison contracts  | 16 new tests cover PR/mode/time boundaries, matching after line/ID changes, ambiguity, evidence/provenance changes, multiple assertions, risk-area changes, metadata-only history, search filters, and rerun links |
| Production history    | Combined repository/PR search, mode and priority filters, zero-result feedback, and Clear filters passed                                                                                                           |
| Production comparison | Default and alternate eligible baselines, unrelated-baseline rejection, first-run empty state, full commit scope, and assertion-level result pairing passed                                                        |
| Production reruns     | Live rerun opened a canonical prefilled form; demo rerun completed and saved a separate report that compared with earlier runs                                                                                     |
| Responsive checks     | Comparison at 1440, 768, 390, and 320 pixels; history and report at 320 pixels; no document-level horizontal overflow                                                                                              |
| Browser console       | No warnings or errors in the final production checks                                                                                                                                                               |

The new comparison uses saved observations and retains original evidence statuses. A missing match does not establish a fix, checks are not re-executed by comparing, and reviewer decisions remain with their original report. Checks with the same type/files use descriptions to distinguish multiple assertions; ambiguous duplicates are not paired by array position. No new dependencies, credentials, or external GitHub writes were introduced.

UI validation created one new synthetic demo report. It used the existing fixture execution pipeline and made no credentialed inference or remote sandbox calls. Existing live reports were inspected locally; the live rerun form was not submitted. The optional Docker and Nebius integration tests remain skipped.

An initial restricted lint process stalled and was interrupted; the final lint run with normal Windows permissions passed. PowerShell dropped an npm-forwarded port argument on the first preview start; starting the installed Next.js CLI directly succeeded. The production preview is running at `http://127.0.0.1:3001`. Git reports Windows line-ending conversion notices; `git diff --check` passes.

Browser proof is saved in ignored `artifacts/`: `followup-comparison-desktop.jpg`, `followup-comparison-mobile.jpg`, and `followup-history-desktop.jpg`.

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
