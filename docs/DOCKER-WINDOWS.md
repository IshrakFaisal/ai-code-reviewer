# Docker setup on Windows

Docker Desktop supplies the isolated Linux environment used to run repository tests. Your Nebius inference token already handles the AI requests; no additional Nebius sandbox credentials are needed for Docker.

## Your remaining step: install and open Docker Desktop

1. Download Docker Desktop from the [official Windows installation page](https://docs.docker.com/desktop/setup/install/windows-install/). Follow the installer and any WSL 2 prompts. Complete any required Windows restart.
2. Open Docker Desktop, complete its first-run setup, and wait until its engine is running. Use **Linux containers**. Docker's [WSL setup guide](https://docs.docker.com/desktop/features/wsl/) covers WSL prerequisites if prompted.
3. Open a new PowerShell terminal in this project so it picks up Docker's PATH changes.

The application does not install Windows features, accept Docker's terms, or restart your computer for you.

## Configure the app

Choose a public repository whose scripts you intend to execute. Replace `OWNER/REPO` with its exact name; it must be a supported Node/Vitest project for the paired regression workflow.

```powershell
cd 'D:\Codex Projects\AI code reviewer'
npm run docker:setup -- --repo OWNER/REPO
npm run dev
```

The setup command checks the Linux engine, downloads the official `node:22-bookworm` image if needed, and updates only the Docker/mode settings in `.env.local`. It preserves inference keys and other unrelated configuration without printing their values. Execution is limited to the exact repository you specify. It does not analyze, clone, or run that repository during setup.

Open [the local app](http://127.0.0.1:3000). Analyze a real public PR, open a finding with a generated Vitest test, and select **Reproduce & repair**. If the same generated assertions pass at base and fail at head in stable repeats, **Propose repair & recheck** becomes available.

If you deliberately use a production build on loopback instead of the development server, add the explicit production gate:

```powershell
npm run docker:setup -- --repo OWNER/REPO --production
npm run build
npm start
```

Public hosting still requires the application's existing HTTPS/owner-authentication settings. This command does not change those settings.

## Check readiness

```powershell
npm run docker:check
```

This checks the Linux engine and local image without editing `.env.local`. A missing engine/image produces an actionable error. The app itself revalidates container isolation, network disconnection, repository selection, and commit identity during execution.

## Limits

- The paired workflow requires the same dependency/runtime fingerprint at both commits and Vitest 3.2+ or 4. Dependency-changing PRs or unsupported project structures remain inconclusive.
- Failed installation, missing scripts, test setup errors, unstable runs, and assertion mismatches do not establish a regression.
- Source repair affects existing application files only. The regression test stays unchanged. A validated live repair requires repeated assertion passes plus passing build, type, and existing-test commands.
- A local Docker run needs no remote sandbox credits. Model inference still uses your Nebius account and may be billable.
- Until Docker is installed, `/report/demo/reproduce/finding-1` remains a working, explicitly labeled fixture walkthrough. It does not verify GitHub code.
