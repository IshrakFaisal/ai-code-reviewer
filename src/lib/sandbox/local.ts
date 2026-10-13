import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdtemp, open, mkdir, rm, realpath, lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getConfig } from "@/lib/config";
import type { PullRequest } from "@/lib/types";
import type { SandboxProvider, CommandId, CommandResult } from "./provider";
import { runProcess } from "./process";
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

export function localAllowed(repo: string) {
  return (
    getConfig().localSandbox &&
    (process.env.LOCAL_SANDBOX_REPOSITORIES || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .includes(repo.toLowerCase())
  );
}

/** Trusted developer code only: native processes do not provide container isolation. */
export class LocalSandboxProvider implements SandboxProvider {
  private root = "";
  private checkout = "";
  private temporaryRoot = "";
  private manager?: PackageManager;
  private readonly yarnRcFilename = `.change-verifier-${randomUUID()}.yarnrc.yml`;

  constructor(
    private repository: string,
    private signal?: AbortSignal,
  ) {
    if (!localAllowed(repository))
      throw new Error(
        "Native execution requires development mode, ENABLE_LOCAL_SANDBOX=true and an explicitly trusted repository.",
      );
    if (process.platform === "win32")
      throw new Error(
        "Native execution requires Linux/macOS or WSL. On Windows, use SANDBOX_PROVIDER=docker with Docker Desktop Linux containers.",
      );
  }

  async createSandbox() {
    if (this.root) throw new Error("Sandbox has already been created.");
    // macOS /var often resolves to /private/var; use a canonical root throughout.
    this.temporaryRoot = await realpath(os.tmpdir());
    this.root = await mkdtemp(
      path.join(this.temporaryRoot, "change-verifier-"),
    );
    this.checkout = path.join(this.root, "repo");
  }

  private exec(
    command: string,
    args: string[],
    cwd = this.checkout,
    timeout = 60_000,
  ): Promise<CommandResult> {
    if (!localAllowed(this.repository))
      throw new Error("Native execution disabled.");
    if (!this.root)
      throw new Error("Create the sandbox before executing commands.");
    return runProcess(command, args, {
      cwd,
      timeout,
      signal: this.signal,
      env: {
        ...sandboxEnvironment(this.root, this.yarnRcFilename),
        PATH: process.env.PATH,
        TMPDIR: this.root,
      },
    });
  }

  private validatePullRequest(pr: PullRequest) {
    if (
      !/^[a-zA-Z0-9_.-]+$/.test(pr.owner) ||
      !/^[a-zA-Z0-9_.-]+$/.test(pr.repo) ||
      `${pr.owner}/${pr.repo}`.toLowerCase() !== this.repository.toLowerCase()
    )
      throw new Error("Repository does not match the trusted selection.");
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
      this.root,
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

  private async safePath(relative: string, allowContainedLinks = false) {
    validateRelativePath(relative);
    if (!this.checkout)
      throw new Error("Create the sandbox before accessing files.");
    if ((await lstat(this.checkout)).isSymbolicLink())
      throw new Error("Checkout symlinks are not allowed.");
    const root = await realpath(this.checkout);
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep))
      throw new Error("File escapes sandbox.");
    if (allowContainedLinks) {
      const resolved = await realpath(target);
      if (!resolved.startsWith(root + path.sep))
        throw new Error("File escapes sandbox.");
      return resolved;
    }
    let current = root;
    for (const segment of relative.split("/")) {
      current = path.join(current, segment);
      try {
        if ((await lstat(current)).isSymbolicLink())
          throw new Error("Symlink paths are not allowed.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return target;
  }

  async readFile(relative: string) {
    const handle = await open(
      await this.safePath(relative, true),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile())
        throw new Error("Sandbox file must be a regular file.");
      const buffer = Buffer.alloc(Math.min(stat.size, 256_000));
      const result = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, result.bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  }

  private async writeArtifact(relative: string, content: string) {
    if (Buffer.byteLength(content) > 32_000)
      throw new Error("Generated file exceeds the size limit.");
    const target = await this.safePath(relative);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await this.safePath(relative);
    const handle = await open(
      target,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(content);
    } finally {
      await handle.close();
    }
  }

  async writeFile(relative: string, content: string) {
    validateRelativePath(relative, true);
    await this.writeArtifact(relative, content);
  }

  async installDependencies() {
    this.manager = await packageManager((relative) => this.readFile(relative));
    const plan = installPlan(this.manager);
    return this.exec(plan.command, plan.args, this.checkout, 120_000);
  }

  async runCommand(
    command: CommandId,
    testFile?: string,
  ): Promise<CommandResult> {
    if (!this.manager)
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
    if (!this.root) return;
    if (
      path.dirname(this.root) !== this.temporaryRoot ||
      !path.basename(this.root).startsWith("change-verifier-")
    )
      throw new Error("Invalid native sandbox cleanup path.");
    await rm(this.root, { recursive: true, force: true });
    this.root = "";
    this.checkout = "";
  }
}
