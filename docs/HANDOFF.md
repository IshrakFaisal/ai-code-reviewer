# Handoff for a coding session

AI Change Verifier inspects behavior changes in public GitHub PRs. The review target is a pinned pair of revisions. Reviewers inspect findings and decide what to share. Demo findings, model inference, static checks, and executed tests have distinct provenance.

## Before editing

1. Read [AGENTS.md](../AGENTS.md) first. This installed Next.js version can change APIs, conventions, and file structure. Before writing code, read the relevant guide in `node_modules/next/dist/docs/` relative to AGENTS.md and heed deprecation notices. Next's dev server regenerates the marked block.
2. From the project root, run the commands below to identify local work, branch, last commit and diff. Observe the current task's clean-tree or preservation rule. Verify results afresh when a baseline is required.

```sh
git status --short
git branch --show-current
git log -1 --oneline
git diff --stat
```

3. Read [Architecture](ARCHITECTURE.md) for module boundaries, storage and lifecycle. Use [Integrations](INTEGRATIONS.md) for configuration, CLI exits, Action behavior and execution gates. The [demo walkthrough](DEMO.md) provides a repeatable user path.
4. Preserve local credentials and data. Keep `.env.local`, `.data/`, `.sandbox/`, `.next/`, and generated evaluation output out of commits. Do not log credentials or include them in fixtures.

## Verify a change

Run from the project root with development dependencies installed. Run sequentially so tests and builds have their own temporary files and outputs.

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm audit
npm audit --omit=dev
```

Read pass, fail, and skipped totals from the test runner. Record the two audit scopes separately. The [dated validation record](VALIDATION.md) describes a specific checkout and run. A fresh audit can differ with the registry's advisory data.

For an offline product check, `npm run --silent review -- --demo` prints the bundled report comment. For the browser, `npm run dev` exposes the report, saved review decisions, and unfinished analyses in History. Live inference, repository execution, and GitHub publication require separate operator configuration.

## Boundaries worth preserving

- Read the [investigator](../src/lib/agent/investigator.ts) before changing stage order, resume behavior, or how model output reaches the report. Both model output and repository content are untrusted inputs.
- A citation marked verified establishes a location. Keep path-only and unanchored results distinct from evidence of behavior. The report retains model findings that the PR comment omits.
- Keep deterministic review priority separate from defect probability. A live generated-test failure requires inspection of the test and its assumptions.
- Keep the exact repository allowlist and provider enablement in the [sandbox gate](../src/lib/sandbox/factory.ts). CLI flags and Action inputs do not grant execution.
- Preserve report compatibility on read, revision-scoped reviewer decisions, and draft recovery. History's pause, resume, and discard perform different operations.

## Environment quirks

- On restricted Windows filesystems, hardlinks and directory junctions used by filesystem tests can fail with `EPERM`. Check the failing operation and path. Reproduce the same test with normal filesystem permissions before attributing it to the application.
- If typecheck identifies malformed or stale generated files under `.next/dev/types`, check whether a dev server is writing them. Stop that server, move aside the generated cache, regenerate it through a build, and compare diagnostics. Errors in tracked source need their own investigation.

## Outstanding verification

- Real same-repository Action publication, updating the existing bot comment, and fork summary-only behavior are **not verified** on GitHub.
- Credentialed inference and live Docker/Nebius verification are **not verified** by the default suite. Use the integration guide for opt-in checks.
- Review the full dependency audit against the production-only result. Evaluate compatible updates in a separate dependency change.
- Populate blind human labels before interpreting evaluation metrics. Representative review accuracy, private-repository support, and multi-process operation are **not verified**.
