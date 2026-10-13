import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  symlink,
  rm,
} from "node:fs/promises";
import path from "node:path";
import {
  commandPlan,
  generatedPlan,
  installPlan,
  packageManager,
  requireVitest,
  validateRelativePath,
  readGeneratedReport,
} from "@/lib/sandbox/commands";
import { createSandboxProvider, sandboxAllowed } from "@/lib/sandbox/factory";
import { DockerSandboxProvider } from "@/lib/sandbox/docker";
import {
  runProcess,
  type ProcessOptions,
  type ProcessRunner,
} from "@/lib/sandbox/process";
import { samplePullRequest } from "@/lib/demo/sample-analysis";

afterEach(() => vi.unstubAllEnvs());
const ok = (output = "", exitCode = 0) => ({
  output,
  exitCode,
  durationMs: 1,
  timedOut: false,
});
function enableDocker() {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("ENABLE_LOCAL_SANDBOX", "true");
  vi.stubEnv("SANDBOX_PROVIDER", "docker");
  vi.stubEnv("LOCAL_SANDBOX_REPOSITORIES", "acme/platform");
}
function reader(files: Record<string, string | undefined>) {
  return async (relative: string) => {
    if (files[relative] === undefined)
      throw Object.assign(new Error("absent"), { code: "ENOENT" });
    return files[relative];
  };
}
function mockDocker(options: { network?: string; installExit?: number } = {}) {
  const calls: { args: string[]; options: ProcessOptions }[] = [];
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      scripts: { build: "node build.js", test: "vitest" },
      devDependencies: { vitest: "^3.2.0", typescript: "^5.0.0" },
    }),
    "package-lock.json": "{}",
    "tsconfig.json": "{}",
    "node_modules/vitest/package.json": '{"version":"3.2.0"}',
  };
  const run: ProcessRunner = async (_command, args, opts) => {
    calls.push({ args, options: opts });
    if (args[0] === "info") return ok("linux\n");
    if (args[0] === "image") return ok(`sha256:${"b".repeat(64)}\n`);
    if (args[0] === "inspect") return ok(options.network ?? "{}");
    if (args.includes("rev-parse")) return ok(samplePullRequest().headSha);
    if (args.includes("read")) {
      const filename = args.at(-1)!;
      return files[filename] === undefined
        ? ok("absent", 44)
        : ok(files[filename]);
    }
    if (args.includes("write")) {
      const filename = args.at(-1)!;
      if (files[filename] !== undefined) return ok("exists", 1);
      files[filename] = opts.input || "";
    }
    if (args.includes("ci")) return ok("installed", options.installExit ?? 0);
    if (args.includes("node_modules/vitest/vitest.mjs"))
      files[".change-verifier/one.report.json"] = JSON.stringify({
        numTotalTests: 1,
        numPassedTests: 1,
        numFailedTests: 0,
        testResults: [{ name: "/workspace/repo/.change-verifier/one.test.ts" }],
      });
    return ok();
  };
  return { calls, files, run };
}

describe("sandbox selection and Docker isolation contract", () => {
  it("defaults to disabled and gates repository and production execution", () => {
    vi.stubEnv("SANDBOX_PROVIDER", "");
    vi.stubEnv("ENABLE_LOCAL_SANDBOX", "false");
    expect(() => createSandboxProvider("acme/platform")).toThrow(/disabled/);
    enableDocker();
    expect(sandboxAllowed("other/repo")).toBe(false);
    expect(() => createSandboxProvider("other/repo")).toThrow(
      /allowed repository/,
    );
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_PRODUCTION_SANDBOX", "false");
    expect(() => createSandboxProvider("acme/platform")).toThrow();
    vi.stubEnv("ENABLE_PRODUCTION_SANDBOX", "true");
    expect(createSandboxProvider("acme/platform")).toBeInstanceOf(
      DockerSandboxProvider,
    );
    vi.stubEnv("SANDBOX_PROVIDER", "native");
    expect(() => createSandboxProvider("acme/platform")).toThrow();
  });

  it("constrains containers, pins the resolved image and passes no app credentials", async () => {
    enableDocker();
    vi.stubEnv("NEBIUS_API_KEY", "must-not-reach-container");
    vi.stubEnv("GITHUB_TOKEN", "must-not-reach-cli");
    const mock = mockDocker();
    const sandbox = new DockerSandboxProvider(
      "acme/platform",
      undefined,
      mock.run,
    );
    await sandbox.createSandbox();
    const create = mock.calls.find(({ args }) => args[0] === "create")!;
    for (const required of [
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges:true",
      "--cpus=2",
      "--memory=2g",
      "--memory-swap=2g",
      "--pids-limit=128",
      "1000:1000",
      `sha256:${"b".repeat(64)}`,
    ])
      expect(create.args).toContain(required);
    expect(create.args).not.toContain("--privileged");
    expect(create.args).not.toContain("--volume");
    expect(create.args).not.toContain("--mount");
    expect(create.args.join(" ")).not.toContain("must-not-reach");
    expect(create.options.env.GITHUB_TOKEN).toBeUndefined();
    expect(create.options.env.NEBIUS_API_KEY).toBeUndefined();
    await sandbox.destroySandbox();
    expect(mock.calls.at(-1)?.args.slice(0, 3)).toEqual([
      "rm",
      "--force",
      "--volumes",
    ]);
  });

  it("checks out and confirms the immutable SHA, blocks execution before offline state", async () => {
    enableDocker();
    const mock = mockDocker();
    const sandbox = new DockerSandboxProvider(
      "acme/platform",
      undefined,
      mock.run,
    );
    await sandbox.createSandbox();
    await expect(sandbox.runCommand("build")).rejects.toThrow(
      /disable network/,
    );
    await expect(
      sandbox.cloneRepository({ ...samplePullRequest(), owner: "other" }),
    ).rejects.toThrow(/selection/);
    await expect(
      sandbox.checkoutPullRequest({ ...samplePullRequest(), headSha: "main" }),
    ).rejects.toThrow(/immutable/);
    await sandbox.cloneRepository(samplePullRequest());
    await sandbox.checkoutPullRequest(samplePullRequest());
    expect(
      mock.calls.find(({ args }) => args.includes("fetch"))?.args,
    ).toContain(samplePullRequest().headSha);
    await sandbox.installDependencies();
    await sandbox.runCommand("typecheck");
    const disconnect = mock.calls.findIndex(
      ({ args }) => args[0] === "network",
    );
    const tsc = mock.calls.findIndex(({ args }) =>
      args.includes("node_modules/typescript/bin/tsc"),
    );
    expect(tsc).toBeGreaterThan(disconnect);
    await sandbox.destroySandbox();
  });

  it("refuses execution when network detachment cannot be confirmed", async () => {
    enableDocker();
    const mock = mockDocker({ network: '{"bridge":{}}' });
    const sandbox = new DockerSandboxProvider(
      "acme/platform",
      undefined,
      mock.run,
    );
    await sandbox.createSandbox();
    await expect(sandbox.installDependencies()).rejects.toThrow(
      /still has a network/,
    );
    await expect(sandbox.runCommand("tests")).rejects.toThrow(
      /disable network/,
    );
    await sandbox.destroySandbox();
  });

  it("detaches the network even when installation fails", async () => {
    enableDocker();
    const mock = mockDocker({ installExit: 1 });
    const sandbox = new DockerSandboxProvider(
      "acme/platform",
      undefined,
      mock.run,
    );
    await sandbox.createSandbox();
    expect((await sandbox.installDependencies()).exitCode).toBe(1);
    expect(mock.calls.some(({ args }) => args[0] === "network")).toBe(true);
    await sandbox.destroySandbox();
  });

  it("uses one isolated test config, assertion enforcement and its JSON report", async () => {
    enableDocker();
    const mock = mockDocker();
    const sandbox = new DockerSandboxProvider(
      "acme/platform",
      undefined,
      mock.run,
    );
    await sandbox.createSandbox();
    await sandbox.installDependencies();
    await sandbox.writeFile(".change-verifier/one.test.ts", "test contents");
    expect((await sandbox.runCommand("generated", "one.test.ts")).output).toBe(
      mock.files[".change-verifier/one.report.json"],
    );
    const config = JSON.parse(
      mock.files[".change-verifier/one.config.mjs"]
        .replace(/^export default /, "")
        .trim()
        .slice(0, -1),
    );
    expect(config.test.include).toEqual([".change-verifier/one.test.ts"]);
    expect(config.test.expect.requireAssertions).toBe(true);
    await expect(
      sandbox.writeFile(".change-verifier/one.test.ts", "overwrite"),
    ).rejects.toThrow(/existing files/);
    await sandbox.destroySandbox();
  });

  it("removes the container on subprocess cancellation independently of its signal", async () => {
    enableDocker();
    const controller = new AbortController();
    const mock = mockDocker();
    const sandbox = new DockerSandboxProvider(
      "acme/platform",
      controller.signal,
      mock.run,
    );
    await sandbox.createSandbox();
    controller.abort();
    await mock.calls.at(-1)!.options.onTerminate!();
    const cleanup = mock.calls.at(-1)!;
    expect(cleanup.args[0]).toBe("rm");
    expect(cleanup.options.signal).toBeUndefined();
  });
});

describe("supported package strategies and file boundaries", () => {
  it.each([
    ["npm", "package-lock.json", undefined, ["ci", "--ignore-scripts"]],
    [
      "pnpm",
      "pnpm-lock.yaml",
      "pnpm@10.2.0",
      [
        "pnpm@10.2.0",
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--ignore-pnpmfile",
      ],
    ],
    [
      "yarn",
      "yarn.lock",
      "yarn@1.22.22",
      ["yarn@1.22.22", "install", "--frozen-lockfile", "--ignore-scripts"],
    ],
    [
      "yarn",
      "yarn.lock",
      "yarn@4.9.0",
      ["yarn@4.9.0", "install", "--immutable", "--mode=skip-build"],
    ],
  ])(
    "uses reproducible %s installation",
    async (name, lock, declaration, args) => {
      const manager = await packageManager(
        reader({
          "package.json": JSON.stringify({ packageManager: declaration }),
          [lock as string]: "large lockfile presence",
        }),
      );
      expect(manager.name).toBe(name);
      expect(installPlan(manager).args).toEqual(
        expect.arrayContaining(args as string[]),
      );
    },
  );
  it.each([
    { "package.json": "{}" },
    { "package.json": "{}", "package-lock.json": "{}", "yarn.lock": "" },
    {
      "package.json": '{"packageManager":"pnpm@latest"}',
      "pnpm-lock.yaml": "",
    },
    {
      "package.json": '{"packageManager":"pnpm@10.2.0"}',
      "package-lock.json": "{}",
    },
    { "package.json": "{}", "pnpm-lock.yaml": "" },
  ])(
    "rejects missing, ambiguous or unpinned package configurations",
    async (files) => {
      await expect(packageManager(reader(files))).rejects.toThrow();
    },
  );
  it("adds non-watch arguments only to direct test runner scripts", async () => {
    const file = (test: string) =>
      reader({ "package.json": JSON.stringify({ scripts: { test } }) });
    expect(
      (await commandPlan("tests", { name: "npm" }, file("vitest"))).args,
    ).toEqual(["run", "test", "--", "--run"]);
    expect(
      (await commandPlan("tests", { name: "npm" }, file("setup && vitest")))
        .args,
    ).toEqual(["run", "test"]);
  });
  it.each([
    "../escape",
    "/etc/passwd",
    "C:/secret",
    "a\\secret",
    "a//b",
    "a/./b",
    "a/../b",
    "a\0b",
  ])("rejects unsafe path %s", (file) => {
    expect(() => validateRelativePath(file)).toThrow();
  });
  it("limits writes and rejects unsupported Vitest assertion semantics", async () => {
    expect(() => validateRelativePath("package.json", true)).toThrow();
    expect(() =>
      validateRelativePath(".change-verifier/check.test.ts", true),
    ).not.toThrow();
    for (const version of ["2.1.0", "3.0.0", "3.1.9"])
      await expect(
        requireVitest(
          reader({
            "package.json": '{"devDependencies":{"vitest":"*"}}',
            "node_modules/vitest/package.json": JSON.stringify({ version }),
          }),
        ),
      ).rejects.toThrow(/Vitest 3.2/);
  });
  it("rejects stale reports and reports identifying unrelated tests", async () => {
    enableDocker();
    const mock = mockDocker();
    const sandbox = new DockerSandboxProvider(
      "acme/platform",
      undefined,
      mock.run,
    );
    await sandbox.createSandbox();
    await sandbox.installDependencies();
    mock.files[".change-verifier/one.report.json"] = "stale";
    await expect(
      sandbox.runCommand("generated", "one.test.ts"),
    ).rejects.toThrow(/stale/);
    await expect(
      readGeneratedReport(
        reader({
          report: JSON.stringify({
            testResults: [{ name: "/repo/unrelated.test.ts" }],
          }),
        }),
        "report",
        "one.test.ts",
      ),
    ).rejects.toThrow(/selected test/);
    await sandbox.destroySandbox();
  });
});

describe("real bounded subprocess and generated harness", () => {
  const env = (): NodeJS.ProcessEnv => ({
    NODE_ENV: "test",
    SystemRoot: process.env.SystemRoot,
    PATH: process.env.PATH,
  });
  it("passes arguments without a shell and excludes application secrets", async () => {
    vi.stubEnv("NEBIUS_API_KEY", "do-not-inherit");
    const result = await runProcess(
      process.execPath,
      [
        "-e",
        "process.stdout.write(JSON.stringify([process.argv[1], process.env.NEBIUS_API_KEY]))",
        "$(echo unsafe);&",
      ],
      { env: env() },
    );
    expect(JSON.parse(result.output)).toEqual(["$(echo unsafe);&", null]);
  });
  it("terminates excessive output and timeouts", async () => {
    const flooded = await runProcess(
      process.execPath,
      ["-e", "setInterval(() => process.stdout.write('x'.repeat(1000)), 1)"],
      { env: env(), outputLimit: 1024 },
    );
    expect(flooded.exitCode).not.toBe(0);
    expect(Buffer.byteLength(flooded.output)).toBeLessThanOrEqual(1024);
    const timeout = await runProcess(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { env: env(), timeout: 100 },
    );
    expect(timeout.timedOut).toBe(true);
    expect(timeout.exitCode).not.toBe(0);
  });
  it("executes exactly the selected generated file and fails an assertion-free test", async () => {
    const base = path.resolve(".sandbox");
    await mkdir(base, { recursive: true });
    const root = await mkdtemp(path.join(base, "verifier-harness-test-"));
    try {
      await mkdir(path.join(root, ".change-verifier"));
      await symlink(
        path.resolve("node_modules"),
        path.join(root, "node_modules"),
        process.platform === "win32" ? "junction" : "dir",
      );
      await writeFile(path.join(root, "package.json"), '{"type":"module"}');
      await writeFile(
        path.join(root, ".change-verifier/selected.test.ts"),
        "import {it} from 'vitest'; it('must assert', () => {});",
      );
      await writeFile(
        path.join(root, ".change-verifier/other.test.ts"),
        "throw Error('must not execute another finding');",
      );
      await writeFile(
        path.join(root, ".change-verifier/vitest.workspace.ts"),
        "throw Error('must not discover a repository workspace');",
      );
      const plan = generatedPlan("selected.test.ts");
      await writeFile(path.join(root, plan.config), plan.content);
      const result = await runProcess(process.execPath, plan.args, {
        env: env(),
        cwd: root,
        timeout: 15_000,
      });
      expect(result.exitCode).toBe(1);
      const report = JSON.parse(
        await readFile(path.join(root, plan.report), "utf8").catch((error) => {
          throw new Error(`${String(error)}; child output: ${result.output}`);
        }),
      );
      expect(report.numTotalTests).toBe(1);
      expect(report.numFailedTests).toBe(1);
      expect(
        report.testResults[0].assertionResults[0].failureMessages.join(" "),
      ).toMatch(/assert/i);
    } finally {
      if (
        path.dirname(path.resolve(root)) !== base ||
        !path.basename(root).startsWith("verifier-harness-test-")
      )
        throw new Error("Invalid test cleanup path.");
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});
