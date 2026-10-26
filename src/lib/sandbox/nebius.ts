import { randomUUID } from "node:crypto";
import type { PullRequest } from "@/lib/types";
import type { CommandId, CommandResult, SandboxProvider } from "./provider";
import { sandboxAllowed, selectedSandboxProvider } from "./factory";
import { ContreeClient, contreeConfiguration } from "./contree-client";
import { sandboxFileProgram } from "./file-program";
import { validateRepairPath } from "@/lib/regression/repair";
import {
  commandPlan,
  generatedPlan,
  installPlan,
  optionalFile,
  packageManager,
  readGeneratedReport,
  requireVitest,
  sandboxEnvironment,
  validateRelativePath,
  type PackageManager,
} from "./commands";

type RemoteClient = Pick<ContreeClient, "execute" | "destroy">;

/** ConTree checkpoints persist files; each command runs in a separate remote VM. */
export class NebiusSandboxProvider implements SandboxProvider {
  private readonly root = `/tmp/change-verifier-${randomUUID()}`;
  private readonly checkout = `${this.root}/repo`;
  private readonly fileProgram = sandboxFileProgram(this.checkout);
  private readonly yarnRcFilename = `.change-verifier-${randomUUID()}.yarnrc.yml`;
  private readonly client: RemoteClient;
  private image: string;
  private readonly originalImage: string;
  private created = false;
  private destroyed = false;
  private installed = false;
  private installationAttempted = false;
  private revisionChecked = false;
  private manager?: PackageManager;

  constructor(
    private readonly repository: string,
    private readonly signal?: AbortSignal,
    client?: RemoteClient,
  ) {
    this.assertAllowed();
    const config = contreeConfiguration();
    this.image = config.image;
    this.originalImage = config.image;
    this.client = client ?? new ContreeClient(config, signal);
  }

  private assertAllowed() {
    if (
      selectedSandboxProvider() !== "nebius" ||
      !sandboxAllowed(this.repository)
    )
      throw new Error(
        "Nebius execution requires ENABLE_NEBIUS_SANDBOX=true and an exact NEBIUS_SANDBOX_REPOSITORIES allowlist.",
      );
    if (this.signal?.aborted)
      throw new Error("Nebius sandbox request was cancelled.");
    if (this.destroyed)
      throw new Error("The Nebius sandbox has been destroyed.");
  }

  private async exec(
    command: string,
    args: string[],
    options: {
      cwd?: string;
      network?: boolean;
      disposable?: boolean;
      timeout?: number;
      input?: string;
      outputLimit?: number;
    } = {},
  ): Promise<CommandResult> {
    this.assertAllowed();
    if (!this.created) throw new Error("Create the Nebius sandbox first.");
    if (options.network && this.installationAttempted)
      throw new Error(
        "Network access is disabled after dependency installation.",
      );
    const environment = Object.fromEntries(
      Object.entries(sandboxEnvironment(this.root, this.yarnRcFilename)).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    const result = await this.client
      .execute({
        image: this.image,
        command,
        args,
        cwd: options.cwd ?? this.checkout,
        env: environment,
        networking: options.network === true,
        disposable: options.disposable === true,
        timeoutSeconds: Math.ceil((options.timeout ?? 60_000) / 1000),
        outputLimitBytes: options.outputLimit ?? 32_000,
        maxLayerBytes: 1_610_612_736,
        stdin: options.input,
      })
      .catch((error: unknown) => {
        if (!options.disposable) this.created = false;
        throw error;
      });
    if (!options.disposable) {
      // Never continue from an old checkpoint after an unknown/partial mutation.
      if (!result.imageId) {
        this.created = false;
        if (result.exitCode === 0 && !result.timedOut)
          throw new Error(
            "Nebius did not return a checkpoint; further execution was stopped.",
          );
      } else {
        this.image = result.imageId;
      }
    }
    return {
      exitCode: result.truncated && result.exitCode === 0 ? 1 : result.exitCode,
      output:
        result.stdout +
        (result.stderr ? `\n${result.stderr}` : "") +
        (result.truncated
          ? "\nOutput was truncated; execution evidence is incomplete."
          : ""),
      timedOut: result.timedOut,
      durationMs: result.durationMs,
    };
  }

  async createSandbox() {
    this.assertAllowed();
    if (this.created) throw new Error("Sandbox has already been created.");
    this.created = true;
    // /tmp is writable in the stock Node image; this unique directory must be new.
    const result = await this.exec(
      "node",
      [
        "-e",
        `
      const fs = require('node:fs');
      if (process.getuid() !== 1000) process.exit(1);
      fs.mkdirSync(${JSON.stringify(this.root)}, {mode: 0o700});
      fs.mkdirSync(${JSON.stringify(`${this.root}/home`)}, {mode: 0o700});
    `,
      ],
      { cwd: "/tmp" },
    );
    if (result.exitCode !== 0 || result.timedOut)
      throw new Error(
        "Nebius sandbox initialization failed. Use an imported image with Node.js 22+, Git and npm/Corepack and a writable /tmp for UID 1000.",
      );
  }

  private validatePullRequest(pr: PullRequest) {
    if (
      !/^[a-zA-Z0-9_.-]+$/.test(pr.owner) ||
      !/^[a-zA-Z0-9_.-]+$/.test(pr.repo) ||
      `${pr.owner}/${pr.repo}`.toLowerCase() !== this.repository.toLowerCase()
    )
      throw new Error("Repository does not match the allowed selection.");
    if (!/^[a-f0-9]{40}$/.test(pr.headSha))
      throw new Error("Invalid immutable revision.");
  }

  async cloneRepository(pr: PullRequest) {
    this.validatePullRequest(pr);
    const result = await this.exec(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "clone",
        "--no-checkout",
        "--depth=1",
        "--",
        `https://github.com/${pr.owner}/${pr.repo}.git`,
        this.checkout,
      ],
      { cwd: this.root, network: true },
    );
    if (result.exitCode !== 0 || result.timedOut)
      throw new Error("Remote repository clone failed.");
  }

  async checkoutPullRequest(pr: PullRequest) {
    this.validatePullRequest(pr);
    this.revisionChecked = false;
    for (const args of [
      ["fetch", "--depth=1", "origin", pr.headSha],
      ["checkout", "--detach", pr.headSha],
    ]) {
      const result = await this.exec(
        "git",
        ["-c", "core.hooksPath=/dev/null", ...args],
        {
          network: args[0] === "fetch",
        },
      );
      if (result.exitCode !== 0 || result.timedOut)
        throw new Error(
          "Could not check out the analyzed immutable PR revision remotely.",
        );
    }
    const revision = await this.exec("git", ["rev-parse", "HEAD"], {
      disposable: true,
    });
    if (
      revision.exitCode !== 0 ||
      revision.timedOut ||
      revision.output.trim() !== pr.headSha
    )
      throw new Error(
        "Remote sandbox revision does not match the analyzed PR.",
      );
    this.revisionChecked = true;
  }

  async readFile(relative: string) {
    validateRelativePath(relative);
    const result = await this.exec(
      "node",
      ["-e", this.fileProgram, "read", relative],
      {
        disposable: true,
        outputLimit: 256_000,
      },
    );
    if (result.exitCode === 44)
      throw Object.assign(new Error(`Sandbox file ${relative} is absent.`), {
        code: "ENOENT",
      });
    if (result.exitCode !== 0 || result.timedOut)
      throw new Error(`Sandbox file ${relative} could not be read safely.`);
    return result.output;
  }

  private async writeArtifact(relative: string, content: string) {
    if (Buffer.byteLength(content) > 32_000)
      throw new Error("Generated file exceeds the size limit.");
    const result = await this.exec(
      "node",
      ["-e", this.fileProgram, "write", relative],
      { input: content },
    );
    if (result.exitCode !== 0 || result.timedOut)
      throw new Error(
        "Generated file could not be written safely; existing files and symlinks are rejected.",
      );
  }

  async writeFile(relative: string, content: string) {
    validateRelativePath(relative, true);
    await this.writeArtifact(relative, content);
  }

  async runtimeIdentity() {
    const result = await this.exec(
      "node",
      ["-p", "JSON.stringify([process.version,process.platform,process.arch])"],
      { disposable: true },
    );
    if (result.exitCode !== 0 || result.timedOut)
      throw new Error("Runtime identity is unavailable.");
    return JSON.stringify([this.originalImage, JSON.parse(result.output)]);
  }

  async replaceSource(
    relative: string,
    expectedSha256: string,
    content: string,
  ) {
    if (!this.installed)
      throw new Error(
        "Source repairs require completed dependency installation.",
      );
    validateRepairPath(relative);
    const result = await this.exec(
      "node",
      ["-e", this.fileProgram, "replace", relative],
      { input: JSON.stringify({ expectedSha256, content }) },
    );
    if (result.exitCode !== 0 || result.timedOut)
      throw new Error(
        "Source replacement failed its path, size, or original-hash guard.",
      );
  }

  async installDependencies() {
    if (!this.revisionChecked)
      throw new Error(
        "Check out and confirm the PR revision before installation.",
      );
    if (this.installationAttempted)
      throw new Error("Dependency installation has already been attempted.");
    this.manager = await packageManager((relative) => this.readFile(relative));
    const plan = installPlan(this.manager);
    try {
      const result = await this.exec(plan.command, plan.args, {
        network: true,
        timeout: 120_000,
      });
      this.installed = result.exitCode === 0 && !result.timedOut;
      return result;
    } finally {
      // Subsequent instances have networking:false, even if installation failed.
      this.installationAttempted = true;
    }
  }

  async runCommand(
    command: CommandId,
    testFile?: string,
  ): Promise<CommandResult> {
    if (!this.installed || !this.manager)
      throw new Error("Install dependencies before verification.");
    if (!["build", "typecheck", "tests", "generated"].includes(command))
      throw new Error("Unsupported verification command.");
    if (command === "generated") {
      if (!testFile)
        throw new Error("Generated execution requires a valid test filename.");
      await requireVitest((relative) => this.readFile(relative));
      const plan = generatedPlan(testFile);
      if (
        (await optionalFile(
          (relative) => this.readFile(relative),
          plan.report,
        )) !== undefined
      )
        throw new Error(
          "Generated report already exists; refusing stale execution evidence.",
        );
      await this.writeArtifact(plan.config, plan.content);
      const result = await this.exec(plan.command, plan.args);
      if (result.timedOut) return result;
      try {
        return {
          ...result,
          output: await readGeneratedReport(
            (relative) => this.readFile(relative),
            plan.report,
            testFile,
          ),
        };
      } catch {
        return {
          ...result,
          output: "Vitest did not produce a readable JSON report.",
        };
      }
    }
    const plan = await commandPlan(command, this.manager, (relative) =>
      this.readFile(relative),
    );
    return this.exec(plan.command, plan.args);
  }

  async destroySandbox() {
    // Cancellation must still work after the request aborts or enablement changes.
    await this.client.destroy();
    this.created = false;
    this.destroyed = true;
    this.installed = false;
    this.image = "";
    // Nebius retains immutable checkpoints under its service retention policy.
    // No deletion endpoint is documented; do not pretend cancellation erases them.
  }
}

export function createNebiusSandbox(
  repository: string,
  signal?: AbortSignal,
): SandboxProvider {
  return new NebiusSandboxProvider(repository, signal);
}
