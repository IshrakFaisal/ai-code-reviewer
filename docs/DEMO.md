# Reproduce → Repair → Recheck demo

Keep the recording under three minutes. Clearly distinguish the live model connection, curated fixture execution, and any real repository execution. Never show credential values.

## Suggested sequence

1. **0:00–0:20 — Problem.** “A plausible review comment leaves developers asking whether a changed behavior actually fails. AI Change Verifier investigates that question with repeatable tests and scoped evidence.”
2. **0:20–0:45 — Investigate.** Open a saved report and show a hypothesis, changed code, and the original evidence. Explain that standard head-only checks do not establish a regression.
3. **0:45–1:25 — Reproduce.** Open **Reproduce & repair**. Run the base/head comparison. Show the identical test hash and both repeats at each revision: original PASS, changed FAIL. Expand the failing assertion. If using the bundled walkthrough, say explicitly: “These are real executions of deliberately constructed fixture variants, not a GitHub repository or AI-generated repair.”
4. **1:25–2:00 — Repair and recheck.** Run the fixture repair, or the live model-generated repair when a real sandbox is configured. Show the unchanged test passing twice. For live execution, also show build, typecheck, existing tests, original source hashes, and the proposed patch. Explain that the app never changes the regression test to obtain a pass and never merges a change.
5. **2:00–2:25 — Evidence.** Download the reproduction bundle. Show its exact commits, environment fingerprints, harness, test, instructions, and patch. Explain the limits of the claim: evidence supports the tested behavior, not complete safety.
6. **2:25–2:50 — Evaluation and integration.** Show the five curated cases (three known regressions and two healthy changes) with measured runtime. Label this as a deterministic fixture evaluation, not model accuracy. Show the successful live NVIDIA/Nebius integration separately, or demonstrate an actual live PR workflow when configured.

## Commands

```bash
npm run dev
npm run evaluate:regressions
npm run verify:nebius
```

`verify:nebius` makes a small, potentially billable inference request using the server configuration. It verifies catalog access and structured output, not review accuracy. A successful inference request does not enable repository execution.

The fixture workflow starts at `/report/demo/reproduce/finding-1`, also linked from the overview. It needs no credentials. Live execution requires the Docker/Nebius enablement, an exact repository allowlist, and a supported Vitest project; live repair additionally requires inference credentials. Use the public repository and image actually tested rather than implying support for arbitrary repositories.

## Submission language

“AI Change Verifier turns pull-request risks into reproducible regression tests, then checks whether a proposed repair resolves the observed failure.”

Current scope: one generated Vitest test per finding, repeated base/head execution with matching dependency environments, one bounded repair attempt, and explicit human review. Dependency-changing PRs, unsupported projects, and incomplete/unstable execution remain inconclusive. The original analysis and reviewer decisions remain unchanged.
