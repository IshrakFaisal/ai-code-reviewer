# Integration notes

Official documentation checked during implementation (September 26–28, 2026). Account-level model access and hackathon eligibility still require confirmation with your own credentials.

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

## Nebius remote execution

The **Reproduce & repair** workflow uses the same provider gate and repository allowlist. It prepares separate immutable base/head checkouts, compares matching environment fingerprints, and runs the same generated Vitest source twice per revision. A subsequent repair request confirms the head failure, calls the configured Nebius model for a bounded source replacement, and runs unchanged assertions plus repository checks. Source writes are limited to supplied existing application files with matching SHA-256 hashes; test/configuration paths and symlink/hardlink files are rejected. Native execution is not offered for this workflow. No GitHub write integration is added.

The bundled reproduction/repair walkthrough does not invoke this remote provider. Its five-case evaluation is curated fixture execution, not live model evaluation. Use a supported public repository and explicit execution settings to validate account/image compatibility end to end.

- [Official sandbox overview](https://docs.tokenfactory.nebius.com/sandboxes/overview)
- [Sandbox authentication and image listing](https://docs.tokenfactory.nebius.com/api-reference/sandboxes/images/list-publicly-available-images)
- [Create an execution operation](https://docs.tokenfactory.nebius.com/api-reference/sandboxes/instances/spawn-a-new-container-instance)
- [Read operation status and results](https://docs.tokenfactory.nebius.com/api-reference/sandboxes/operations/get-an-operation-status)
- [Cancel an operation](https://docs.tokenfactory.nebius.com/api-reference/sandboxes/operations/cancel-an-operation)
- [Import an OCI image](https://docs.tokenfactory.nebius.com/api-reference/sandboxes/images/import-a-container-image-from-a-registry)
- [ConTree image setup guide](https://docs.tokenfactory.nebius.com/sandboxes/cli/tutorial/images)

`src/lib/sandbox/nebius.ts` implements `SandboxProvider` through the REST API. It uses server-configured `NEBIUS_SANDBOX_BASE_URL`, defaulting to `https://api.tokenfactory.nebius.com/sandboxes`. It needs no local Docker daemon or Python SDK. Credentials are a Nebius IAM bearer token (`NEBIUS_SANDBOX_TOKEN`) and project ID (`NEBIUS_SANDBOX_PROJECT_ID`, sent as the `Project` header). Inference settings do not automatically configure sandbox access.

### Setup

1. Enable sandbox access for your Nebius project and obtain an IAM token with the required project permissions. This is an account prerequisite; creating an API adapter does not grant service access.
2. Import a trusted Linux image into that project using Nebius's documented tooling. It must contain Node 22 or newer, git, npm, and Corepack when using pnpm/Yarn. `/tmp` must be writable by UID/GID 1000; the adapter creates a unique `/tmp/change-verifier-UUID` workspace. Images must contain no credentials or private source. Importing an OCI image is an operator action; the application never imports or retags images.
3. Set `NEBIUS_SANDBOX_IMAGE` to the imported image's immutable UUID. A Docker image name or mutable ConTree tag is not accepted.
4. Set `SANDBOX_PROVIDER=nebius`, `ENABLE_NEBIUS_SANDBOX=true`, and an exact comma-separated public `OWNER/REPO` allowlist in `NEBIUS_SANDBOX_REPOSITORIES`. Configure the token and project ID in `.env.local` or the server secret store. Production also requires `ENABLE_PRODUCTION_SANDBOX=true` and the normal public-origin/owner-authentication configuration.
5. Set `DEMO_MODE=false` and restart the app. Analyze an allowlisted public pull request. Execution and dependency failures remain visible in the report; missing configuration never produces demo evidence or a fabricated pass.

### Execution and lifecycle

The adapter creates operations with `POST /instances`, polls `GET /operations/{id}`, and uses `DELETE /operations/{id}` to request cancellation. It advances the workspace through returned checkpoints. Commands run with explicit argument arrays, a minimal environment, a non-root UID/GID, and time/output limits. Authentication headers stay in the application process and are never forwarded into repository commands. Redirects and malformed service responses fail closed.

Clone and dependency installation enable networking. Clone checks out and confirms the exact analyzed `headSha`; dependency acquisition uses the existing controlled npm/pnpm/Yarn plans with lifecycle scripts disabled. All verification operations explicitly disable networking. The adapter supports the same root Node project and Vitest 3.2+/4 boundaries as local execution. Generated files and result reads retain path/symlink, size and stale-report checks. Live assertion failures remain `INCONCLUSIVE` until assessed; a failed generated test alone cannot establish a product defect.

Cleanup cancels active operations and clears local handles. This is **not remote data deletion**: state-producing commands create checkpoint images. The public API documents operation cancellation and image tagging but does not document immediate checkpoint erasure. The beta [retention policy](https://docs.tokenfactory.nebius.com/sandboxes/overview) is currently 180 days, after which Nebius may remove untagged, unreferenced images. The adapter creates no tags. Only public repositories are accepted, and execution opt-in should account for remote checkpoint retention and service billing.

Run `npm run test:nebius-sandbox` after configuring the three required sandbox values in `.env.local`. This opt-in test uses billable remote execution: it checks the image toolchain, non-root execution, checkpoint file persistence, disabled networking, nonzero exits, and cancellation. It creates one tiny public smoke-test checkpoint subject to Nebius retention; it does not upload project files or clone a repository. Missing configuration fails before any API request. Normal `npm test` skips this live check.

Contract tests exercise HTTP payloads, operation completion/failure/cancellation, credential isolation, and checkpoint handling. Live inference and sandbox requests were not validated with account credentials on the implementation host. Validate the configured image and account before relying on execution results in a deployment. Remote checks rely on Nebius's service isolation; application access control remains the single-owner boundary described in the README. If a submission response is lost before its operation ID arrives, the client cannot address that operation for cancellation; its server-side execution deadline remains the backstop. No automatic submission retries can duplicate billable operations.

## GitHub

The app uses Octokit REST methods for repository metadata, pull request metadata, and paginated files. It is read-only. Public repositories only are accepted even if a configured token could read private repositories. The UI supports full PR URLs, `OWNER/REPO` with a number, or a repository URL with a number. GitHub 401/403/404/429 and network failures receive actionable messages. A second metadata read checks that base/head revisions did not change while file pages were fetched.

GitHub connections use a fresh 20-second abort signal for each attempt, combined with analysis cancellation. The installed Octokit native fetch transport does not implement the older `request.timeout` option. Read requests retry transient transport failures and HTTP 408/500/502/503/504 at most twice, after 250 ms and 500 ms; persistent DNS/permission errors, authentication/access errors, missing PRs and rate limits are not repeatedly requested. DNS, server permission, timeout, upstream availability and exhausted rate limits receive distinct messages. Error messages never echo raw transport errors or credentials.

The app server must have outbound access to `api.github.com:443`. If a restricted coding-agent process prevents networking, launch the app from a regular terminal as described in the README. `GITHUB_TOKEN` is optional for public PRs and does not override network restrictions.

No GitHub App installation, PR comments, webhooks, or external writes are included.
