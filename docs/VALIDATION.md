# Validation record

These commands ran once, in the order shown, from the project root on Windows with the installed lockfile dependencies. Dates use Asia/Dhaka. The two optional sandbox integrations were disabled. The test suite and production build ran with normal Windows filesystem permissions.

| Last verified | Command | Exit | Observed result |
| --- | --- | ---: | --- |
| 2026-11-23 | `npm run lint` | 0 | ESLint completed with no diagnostics. |
| 2026-11-23 | `npm run typecheck` | 0 | TypeScript completed with no diagnostics. |
| 2026-11-23 | `npm test` | 0 | 678 passed, 0 failed, 2 skipped. The Docker and Nebius integration tests were the two skips. |
| 2026-11-23 | `npm run build` | 0 | The Next.js production build compiled, completed type checking, generated pages, and collected build traces. |
| 2026-11-23 | `npm audit` | 1 | Seven moderate findings in the development tooling chain: minimatch, typescript-eslint, and five @typescript-eslint packages. [Reported advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249) |
| 2026-11-23 | `npm audit --omit=dev` | 0 | The registry reported zero production dependency vulnerabilities. |

The full audit traced minimatch through `@typescript-eslint/typescript-estree`, parser, type-utils, utils, and eslint-plugin. The two audit rows describe the registry response on that date.

## Not verified

- **Real GitHub Actions run: not verified.** Local tests exercise publication decisions and the sticky-comment API contract. Delivery with a real job token, comment updates, and fork permissions still need a hosted run.
- **Live integrations: not verified.** This pass did not use a real GitHub PR, Nebius account/model, Docker engine, or remote sandbox image to assess end-to-end behavior.
- **Interactive browser and deployment: not verified.** Manual clipboard access, browser downloads, reconnect after an actual server restart, and public HTTPS owner authentication were outside this run.
- **General review accuracy: not verified.** Curated fixture tests check known behavior and metric calculations. Evaluation of real findings requires blind human labels.
- **Private repositories and distributed operation: not verified.** The implemented retriever requires a public repository, and the run manager tracks activity in one process.

See the [walkthrough](DEMO.md) for the browser sequence and [integrations](INTEGRATIONS.md) for opt-in live checks.
