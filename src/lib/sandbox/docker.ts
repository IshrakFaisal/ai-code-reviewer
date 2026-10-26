import { randomUUID } from "node:crypto";
import { sandboxFileProgram } from "./file-program";
import { validateRepairPath } from "@/lib/regression/repair";
import type { PullRequest } from "@/lib/types";
import type { CommandId, CommandResult, SandboxProvider } from "./provider";
import { sandboxAllowed, selectedSandboxProvider } from "./factory";
import { runProcess, type ProcessRunner } from "./process";
import {
  commandPlan,
  generatedPlan,
  installPlan,
  packageManager,
  requireVitest,
  optionalFile,
  readGeneratedReport,
  sandboxEnvironment,
  validateRelativePath,
  type PackageManager,
} from "./commands";

const ROOT = "/workspace";
const CHECKOUT = `${ROOT}/repo`;
export const DEFAULT_DOCKER_IMAGE = "node:22-bookworm";

function dockerEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of [
    "PATH",
    "SystemRoot",
    "WINDIR",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_CONFIG",
    "DOCKER_CERT_PATH",
    "DOCKER_TLS_VERIFY",
  ])
    if (process.env[key]) env[key] = process.env[key];
  return env;
}

const FILE_PROGRAM = sandboxFileProgram(CHECKOUT);

/** Bounded Linux container, also usable from Windows through Docker Desktop. */
export class DockerSandboxProvider implements SandboxProvider {
  private readonly name = `change-verifier-${randomUUID()}`;
  private readonly yarnRcFilename = `.change-verifier-${randomUUID()}.yarnrc.yml`;
  private created = false;
  private offline = false;
  private imageIdentity = "";
  private manager?: PackageManager;

  constructor(
    private readonly repository: string,
    private readonly signal?: AbortSignal,
    private readonly run: ProcessRunner = runProcess,
  ) {
    this.assertAllowed();
  }

  private assertAllowed() {
    if (
      selectedSandboxProvider() !== "docker" ||
      !sandboxAllowed(this.repository)
    )
      throw new Error(
        "Docker execution requires explicit enablement and an allowed repository.",
      );
  }

  private async cli(
    args: string[],
    options: {
      timeout?: number;
      input?: string;
      outputLimit?: number;
      cleanup?: boolean;
    } = {},
  ) {
    if (!options.cleanup) this.assertAllowed();
    return this.run("docker", args, {
      env: dockerEnvironment(),
      signal: options.cleanup ? undefined : this.signal,
      timeout: options.timeout ?? 60_000,
      input: options.input,
      outputLimit: options.outputLimit,
      onTerminate: options.cleanup ? undefined : () => this.destroySandbox(),
    });
  }

  async createSandbox() {
    if (this.created) throw new Error("Sandbox has already been created.");
    const engine = await this.cli(["info", "--format", "{{.OSType}}"], {
      timeout: 15_000,
    });
    if (
      engine.exitCode !== 0 ||
      engine.timedOut ||
      engine.output.trim() !== "linux"
    )
      throw new Error(
        "Docker is unavailable or not using Linux containers. Start Docker Desktop with Linux containers enabled.",
      );
    const image = process.env.SANDBOX_DOCKER_IMAGE || DEFAULT_DOCKER_IMAGE;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,255}$/.test(image))
      throw new Error("Invalid SANDBOX_DOCKER_IMAGE reference.");
    const inspect = await this.cli(
      ["image", "inspect", image, "--format", "{{.Id}}"],
      { timeout: 15_000 },
    );
    const imageId = inspect.output.trim();
    if (inspect.exitCode !== 0 || !/^sha256:[a-f0-9]{64}$/.test(imageId))
      throw new Error(
        `Sandbox image is not available locally. Pull the configured ${image} image before enabling execution.`,
      );
    this.imageIdentity = imageId;
    const args = [
      "create",
      "--name",
      this.name,
      "--label",
      "ai-change-verifier=sandbox",
      "--pull=never",
      "--init",
      "--read-only",
      "--user",
      "1000:1000",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges:true",
      "--cpus=2",
      "--memory=2g",
      "--memory-swap=2g",
      "--pids-limit=128",
      "--ulimit",
      "nofile=1024:1024",
      "--network=bridge",
      "--log-driver=none",
      "--tmpfs",
      "/workspace:rw,nosuid,nodev,size=1536m,uid=1000,gid=1000,mode=0700",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,nodev,size=64m,uid=1000,gid=1000,mode=0700",
      "--workdir",
      ROOT,
      "--entrypoint",
      "node",
    ];
    for (const [key, value] of Object.entries(
      sandboxEnvironment(ROOT, this.yarnRcFilename),
    ))
      args.push("--env", `${key}=${value}`);
    args.push(imageId, "-e", "setInterval(() => {}, 1000)");
    // Reserve our unpredictable name before creation so failures/abort can always clean up.
    this.created = true;
    const create = await this.cli(args);
    if (create.exitCode !== 0 || create.timedOut)
      throw new Error("Could not create the constrained Docker sandbox.");
    const start = await this.cli(["start", this.name]);
    if (start.exitCode !== 0 || start.timedOut)
      throw new Error("Could not start the Docker sandbox.");
    const identity = await this.exec(
      "node",
      ["-e", "if(process.getuid() === 0) process.exit(1);"],
      ROOT,
    );
    if (identity.exitCode !== 0)
      throw new Error("The sandbox must run as a non-root user.");
  }

  private async exec(
    command: string,
    args: string[],
    cwd = CHECKOUT,
    options: { timeout?: number; input?: string; outputLimit?: number } = {},
  ) {
    if (!this.created)
      throw new Error("Create the sandbox before executing commands.");
    const env = Object.entries(
      sandboxEnvironment(ROOT, this.yarnRcFilename),
    ).map(([key, value]) => `${key}=${value}`);
    return this.cli(
      [
        "exec",
        ...(options.input !== undefined ? ["-i"] : []),
        "--workdir",
        cwd,
        this.name,
        "env",
        "-i",
        ...env,
        command,
        ...args,
      ],
      options,
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
        CHECKOUT,
      ],
      ROOT,
    );
    if (result.exitCode !== 0 || result.timedOut)
      throw new Error("Repository clone failed.");
  }

  async checkoutPullRequest(pr: PullRequest) {
    this.validatePullRequest(pr);
    for (const args of [
      ["fetch", "--depth=1", "origin", pr.headSha],
      ["checkout", "--detach", pr.headSha],
    ]) {
      const result = await this.exec("git", [
        "-c",
        "core.hooksPath=/dev/null",
        ...args,
      ]);
      if (result.exitCode !== 0 || result.timedOut)
        throw new Error(
          "Could not check out the analyzed immutable PR revision.",
        );
    }
    const revision = await this.exec("git", ["rev-parse", "HEAD"]);
    if (revision.exitCode !== 0 || revision.output.trim() !== pr.headSha)
      throw new Error("Sandbox revision does not match the analyzed PR.");
  }

  async readFile(relative: string) {
    validateRelativePath(relative);
    const result = await this.exec(
      "node",
      ["-e", FILE_PROGRAM, "read", relative],
      CHECKOUT,
      { outputLimit: 256_000 },
    );
    if (result.exitCode === 44) {
      const error = new Error(
        `Sandbox file ${relative} is absent.`,
      ) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    if (result.exitCode !== 0 || result.timedOut)
      throw new Error(`Sandbox file ${relative} could not be read safely.`);
    return result.output;
  }

  private async writeArtifact(relative: string, content: string) {
    if (Buffer.byteLength(content) > 32_000)
      throw new Error("Generated file exceeds the size limit.");
    const result = await this.exec(
      "node",
      ["-e", FILE_PROGRAM, "write", relative],
      CHECKOUT,
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
    const result = await this.exec("node", [
      "-p",
      "JSON.stringify([process.version,process.platform,process.arch])",
    ]);
    if (result.exitCode !== 0 || result.timedOut)
      throw new Error("Runtime identity is unavailable.");
    return JSON.stringify([this.imageIdentity, JSON.parse(result.output)]);
  }

  async replaceSource(
    relative: string,
    expectedSha256: string,
    content: string,
  ) {
    if (!this.offline)
      throw new Error("Source repairs require offline execution.");
    validateRepairPath(relative);
    const result = await this.exec(
      "node",
      ["-e", FILE_PROGRAM, "replace", relative],
      CHECKOUT,
      { input: JSON.stringify({ expectedSha256, content }) },
    );
    if (result.exitCode !== 0 || result.timedOut)
      throw new Error(
        "Source replacement failed its path, size, or original-hash guard.",
      );
  }

  async installDependencies(): Promise<CommandResult> {
    this.manager = await packageManager((relative) => this.readFile(relative));
    const plan = installPlan(this.manager);
    let result: CommandResult;
    try {
      result = await this.exec(plan.command, plan.args, CHECKOUT, {
        timeout: 120_000,
      });
    } finally {
      await this.disableNetwork();
    }
    return result;
  }

  private async disableNetwork() {
    const disconnect = await this.cli([
      "network",
      "disconnect",
      "bridge",
      this.name,
    ]);
    if (disconnect.exitCode !== 0 || disconnect.timedOut)
      throw new Error(
        "Could not disable sandbox network access; execution refused.",
      );
    const inspect = await this.cli([
      "inspect",
      "--format",
      "{{json .NetworkSettings.Networks}}",
      this.name,
    ]);
    if (inspect.exitCode !== 0 || inspect.output.trim() !== "{}")
      throw new Error(
        "Sandbox still has a network connection; execution refused.",
      );
    this.offline = true;
  }

  async runCommand(
    command: CommandId,
    testFile?: string,
  ): Promise<CommandResult> {
    if (!this.offline || !this.manager)
      throw new Error(
        "Install dependencies and disable network access before verification.",
      );
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
    if (!this.created) return;
    const result = await this.cli(["rm", "--force", "--volumes", this.name], {
      timeout: 15_000,
      cleanup: true,
    });
    if (result.exitCode !== 0 && !/No such container/i.test(result.output))
      throw new Error(
        "Docker sandbox cleanup failed; inspect containers labelled ai-change-verifier=sandbox.",
      );
    this.created = false;
    this.offline = false;
  }
}
