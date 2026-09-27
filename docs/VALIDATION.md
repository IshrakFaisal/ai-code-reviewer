# Validation record

Validated locally on September 27, 2026 (Asia/Dhaka).

| Check | Result |
| --- | --- |
| `npm run lint` | Pass, no warnings |
| `npm run typecheck` | Pass |
| `npm test` | 51 tests passed across 7 files |
| `npm run build` | Pass, optimized Next.js production build |
| Browser demo: workspace → progress → saved report | Pass |
| Failed fixture output and generated-test expansion | Pass |
| High-priority finding filter | Pass |
| Invalid GitHub URL error | Pass |
| Repository + PR number submission | Pass |
| Report history / mobile navigation | Pass |
| Mobile home and report at 390px viewport | No document-level horizontal overflow |
| Built app live GitHub smoke test | Public `octocat/Hello-World` PR #11297 retrieved; 1 changed file; 14 stages; persisted LIVE report returned HTTP 200 |

The live smoke test used no model credentials and disabled repository execution. All runtime checks remained NOT_RUN; no demo fixture evidence leaked into the LIVE report.

The test suite includes the intentionally defective demo fixture. Its **three passing assertions and one expected failing assertion** are the expected successful test-suite outcome. This is separate from the 51 application tests, which all pass.

## Still requires environment validation

- A paid/authenticated Nebius request with an eligible NVIDIA model.
- The remote ConTree sandbox adapter and provisioned instance.
- Local repository execution on Linux/macOS/WSL with an explicitly trusted npm repository. The development host was Windows; the production execution gate was unit-tested, not bypassed.
- Hosted/multitenant deployment, authentication and distributed storage/queue operation.

The browser preview remains available through `npm run dev` at `http://127.0.0.1:3000` while the development process is running.
