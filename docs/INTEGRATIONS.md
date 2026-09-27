# Integration notes

Official documentation checked during implementation (September 26, 2026). Account-level model access and hackathon eligibility still require confirmation with your own credentials.

## Token Factory inference

- [Official API reference](https://api.tokenfactory.nebius.com/docs)
- [Official structured JSON guide](https://docs.tokenfactory.nebius.com/ai-models-inference/json)
- [Official documentation index](https://docs.tokenfactory.nebius.com/llms.txt)
- [Nebius model catalog access example](https://dev.nebius.com/cookbook/opencode-nebius-token-factory)
- [Authenticated model catalog API](https://docs.tokenfactory.nebius.com/api-reference/models/list-models)
- [NVIDIA Nemotron on Nebius](https://nebius.com/services/token-factory/nemotron)

The adapter first calls authenticated `GET /v1/models` and validates the documented `{object: "list", data: [{id: ...}]}` response. The exact `NEBIUS_MODEL` must be present. NVIDIA `nvidia/` namespace selection is required unless the operator explicitly sets `NEBIUS_REQUIRE_NVIDIA=false`. This is model-family selection, not a claim of hackathon eligibility. The catalog check is cached for one provider instance/investigation.

Inference calls `POST https://api.tokenfactory.nebius.com/v1/chat/completions` using a bearer token and JSON-object mode. Task-specific Zod schemas validate every result, with one repair attempt. Redirects are refused so credentials cannot follow redirects to another origin. Not every model supports identical structured-output capabilities; use the credentialed validation command to check the selected model. `NEBIUS_MODEL` is mandatory and never silently replaced.

Example model discovery (PowerShell, with your key already in the environment):

```powershell
$headers = @{ Authorization = "Bearer $env:NEBIUS_API_KEY" }
$models = Invoke-RestMethod -Uri 'https://api.tokenfactory.nebius.com/v1/models' -Headers $headers
$models.data | Where-Object { $_.id -match 'nvidia|nemotron' } | Select-Object id
```

Do not paste the key into the UI or commit `.env.local`. The provider's structured methods can be swapped behind `AIProvider`; the shipped implementation always identifies itself as Nebius.

The included script loads `.env.local`: `node scripts/verify-nebius.mjs --list` lists accessible NVIDIA IDs without inference, and `npm run verify:nebius` performs one small structured completion (potentially billable). It reports only model IDs and validation outcomes, never credentials or raw upstream errors. Without a key it exits with an actionable configuration error.

AI category refinements are grounded to the supplied changed-file context and add to heuristic categories. They cannot remove risk signals or reclassify production files as tests. Scores are recalculated using existing deterministic weights before hypotheses are selected. Failed refinement leaves heuristic results intact.

## Docker and native execution

`SandboxProvider` is now selected through `src/lib/sandbox/factory.ts`. `SANDBOX_PROVIDER=docker` uses Docker Desktop Linux containers on Windows or a Linux-container engine on other supported hosts. The image must already be pulled (`docker pull node:22-bookworm`); its local immutable ID is used for creation. Set `ENABLE_LOCAL_SANDBOX=true` and list exact trusted public repositories in `LOCAL_SANDBOX_REPOSITORIES`. Production additionally requires `ENABLE_PRODUCTION_SANDBOX=true` and a correctly protected deployment.

No repository or Docker socket from the host is mounted into the container. The non-root process has a read-only root, bounded scratch storage, dropped capabilities, no-new-privileges, and CPU/memory/PID limits. Clone/install uses network access with package lifecycle scripts disabled. Before verification the provider disconnects the network and verifies that no network remains. Application secrets are excluded. Root npm, pinned pnpm and pinned Yarn projects are supported; dependency acquisition can fail if offline, unsupported, or larger than the resource limits. Generated Vitest checks use dedicated configuration and JSON output; missing assertions and runtime errors cannot become a verified pass.

Run `npm run test:sandbox` on a Docker-enabled host to validate real container creation, file boundaries, execution, and cleanup. The normal suite uses subprocess contract tests and skips actual container tests when not explicitly enabled. Native execution remains development-only for fully trusted repositories; it does not isolate the host and refuses native Windows.

Docker's [security documentation](https://docs.docker.com/engine/security/) and [rootless mode guidance](https://docs.docker.com/engine/security/rootless/) describe the remaining daemon/kernel boundary. Use a dedicated disposable worker/VM for repository execution. Container constraints and owner authentication do not make this a hostile multitenant service.

## Remote sandbox boundary

- [Official sandbox overview](https://docs.tokenfactory.nebius.com/sandboxes/overview)
- [Official ConTree Python SDK getting started](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/getting-started)
- [Official command execution guide](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/running-commands)

The current documentation describes the ConTree Python SDK with an instance-specific base URL and authenticated client. It does not establish an account-ready sandbox endpoint for this workspace. `src/lib/sandbox/nebius.ts` therefore fails explicitly rather than pretending an instance exists.

To connect it, provision a ConTree instance and server-side credentials, then implement `SandboxProvider` in a remote worker or adapter. The interface is this application's contract, **not a claim about Nebius SDK method names**:

1. Create an isolated per-analysis execution environment with resource/network limits.
2. Clone the validated public repository and check out the exact analyzed `headSha`.
3. Install dependencies using the selected supported package manager.
4. Map the four controlled command IDs (`build`, `typecheck`, `tests`, `generated`) to fixed worker operations. Never accept browser-supplied shell text.
5. Transfer bounded generated-test files; return bounded command output and exit status.
6. Destroy the environment in `finally`, including cancellation/failure paths.

Add the future remote adapter to the existing factory used by `runLiveVerification`, retaining evidence classification rules. Keep remote credentials out of executed repository code. Add base/head differential testing and independent test validity checks before automatically classifying live failures as verified bugs.

No remote adapter has been tested with actual sandbox credentials. Inference keys alone do not enable execution.

## GitHub

The app uses Octokit REST methods for repository metadata, pull request metadata, and paginated files. It is read-only. Public repositories only are accepted even if a configured token could read private repositories. The UI supports full PR URLs, `OWNER/REPO` with a number, or a repository URL with a number. GitHub 401/403/404/429 and network failures receive actionable messages. A second metadata read checks that base/head revisions did not change while file pages were fetched.

No GitHub App installation, PR comments, webhooks, or external writes are included.
