import { afterEach, describe, expect, it, vi } from "vitest";
import { NebiusSandboxProvider } from "@/lib/sandbox/nebius";
import { createSandboxProvider, sandboxAllowed } from "@/lib/sandbox/factory";
import type {
  ContreeExecution,
  ContreeResult,
} from "@/lib/sandbox/contree-client";
import { samplePullRequest } from "@/lib/demo/sample-analysis";

afterEach(() => vi.unstubAllEnvs());
const initialImage = "12345678-1234-1234-1234-123456789abc";
function enabled() {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("SANDBOX_PROVIDER", "nebius");
  vi.stubEnv("ENABLE_NEBIUS_SANDBOX", "true");
  vi.stubEnv("NEBIUS_SANDBOX_REPOSITORIES", "acme/platform");
  vi.stubEnv("NEBIUS_SANDBOX_TOKEN", "test-iam-secret");
  vi.stubEnv("NEBIUS_SANDBOX_PROJECT_ID", "test-project");
  vi.stubEnv("NEBIUS_SANDBOX_IMAGE", initialImage);
  vi.stubEnv("NEBIUS_API_KEY", "inference-secret");
  vi.stubEnv("GITHUB_TOKEN", "github-secret");
}
function remote(
  options: { installExit?: number; sha?: string; wrongReport?: boolean } = {},
) {
  let counter = 0;
  let lastImage = initialImage;
  let checkout = "";
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      scripts: { build: "node build.js", typecheck: "tsc", test: "vitest" },
      devDependencies: { vitest: "^3.2.0" },
    }),
    "package-lock.json": "{}",
    "node_modules/vitest/package.json": '{"version":"3.2.0"}',
  };
  const execute = vi.fn(
    async (spec: ContreeExecution): Promise<ContreeResult> => {
      // Every mutating operation must advance from the latest returned image.
      expect(spec.image).toBe(lastImage);
      counter++;
      const imageId = `${String(counter).padStart(8, "0")}-1234-1234-1234-123456789abc`;
      if (!spec.disposable) lastImage = imageId;
      const result = {
        operationId: imageId,
        imageId: spec.disposable ? undefined : imageId,
        stdout: "",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        truncated: false,
        durationMs: 1,
      };
      const args = spec.args || [];
      if (args.includes("clone")) checkout = args.at(-1)!;
      if (args.includes("rev-parse"))
        result.stdout = options.sha ?? samplePullRequest().headSha;
      if (args.includes("read")) {
        const content = files[args.at(-1)!];
        result.stdout = content ?? "";
        result.exitCode = content === undefined ? 44 : 0;
      }
      if (args.includes("write")) {
        const filename = args.at(-1)!;
        if (files[filename] !== undefined) result.exitCode = 1;
        else files[filename] = spec.stdin || "";
      }
      if (args.includes("ci")) result.exitCode = options.installExit ?? 0;
      if (args.includes("node_modules/vitest/vitest.mjs")) {
        files[".change-verifier/one.report.json"] = JSON.stringify({
          numTotalTests: 1,
          numPassedTests: 1,
          numFailedTests: 0,
          testResults: [
            {
              name: `${checkout}/.change-verifier/${options.wrongReport ? "other" : "one"}.test.ts`,
            },
          ],
        });
      }
      return result;
    },
  );
  return { execute, destroy: vi.fn(async () => {}), files };
}
async function prepared(mock = remote(), signal?: AbortSignal) {
  enabled();
  const sandbox = new NebiusSandboxProvider("acme/platform", signal, mock);
  await sandbox.createSandbox();
  await sandbox.cloneRepository(samplePullRequest());
  await sandbox.checkoutPullRequest(samplePullRequest());
  const installation = await sandbox.installDependencies();
  return { sandbox, mock, installation };
}

describe("Nebius provider workflow", () => {
  it("requires its own enablement, exact allowlist, credentials and production opt-in", () => {
    enabled();
    expect(createSandboxProvider("acme/platform")).toBeInstanceOf(
      NebiusSandboxProvider,
    );
    expect(sandboxAllowed("ACME/PLATFORM")).toBe(true);
    expect(sandboxAllowed("acme/platform-fork")).toBe(false);
    vi.stubEnv("ENABLE_NEBIUS_SANDBOX", "false");
    vi.stubEnv("ENABLE_LOCAL_SANDBOX", "true");
    vi.stubEnv("LOCAL_SANDBOX_REPOSITORIES", "acme/platform");
    expect(() => createSandboxProvider("acme/platform")).toThrow(
      /allowed repository/,
    );
    vi.stubEnv("ENABLE_NEBIUS_SANDBOX", "true");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_PRODUCTION_SANDBOX", "false");
    expect(() => createSandboxProvider("acme/platform")).toThrow();
    vi.stubEnv("ENABLE_PRODUCTION_SANDBOX", "true");
    expect(createSandboxProvider("acme/platform")).toBeInstanceOf(
      NebiusSandboxProvider,
    );
    vi.stubEnv("NEBIUS_SANDBOX_TOKEN", "");
    expect(() => createSandboxProvider("acme/platform")).toThrow(
      /NEBIUS_SANDBOX_TOKEN/,
    );
  });

  it("chains checkpoints, keeps credentials out of guests, and runs checks offline", async () => {
    const { sandbox, mock } = await prepared();
    const installedAt = mock.execute.mock.calls.length;
    for (const command of ["build", "typecheck", "tests"] as const)
      expect((await sandbox.runCommand(command)).exitCode).toBe(0);
    await sandbox.writeFile(
      ".change-verifier/one.test.ts",
      "test('example', () => expect(1).toBe(1));",
    );
    const generated = await sandbox.runCommand("generated", "one.test.ts");
    expect(JSON.parse(generated.output).numPassedTests).toBe(1);
    const commands = mock.execute.mock.calls.map(([spec]) => spec);
    expect(commands.filter((spec) => spec.networking)).toHaveLength(3); // clone, fetch, install
    expect(
      commands.slice(installedAt).every((spec) => spec.networking === false),
    ).toBe(true);
    expect(
      commands
        .filter((spec) => spec.args?.includes("read"))
        .every((spec) => spec.disposable),
    ).toBe(true);
    expect(JSON.stringify(commands)).not.toMatch(
      /test-iam-secret|inference-secret|github-secret/,
    );
    expect(commands.find((spec) => spec.args?.includes("ci"))?.args).toContain(
      "--ignore-scripts",
    );
    expect(
      commands.find((spec) => spec.args?.includes("fetch"))?.args,
    ).toContain(samplePullRequest().headSha);
    await sandbox.destroySandbox();
    expect(mock.destroy).toHaveBeenCalledOnce();
    await expect(sandbox.runCommand("build")).rejects.toThrow();
  });

  it("rejects a mismatched repository or mutable/incorrect revision", async () => {
    enabled();
    const mock = remote({ sha: "c".repeat(40) });
    const sandbox = new NebiusSandboxProvider("acme/platform", undefined, mock);
    await sandbox.createSandbox();
    await expect(
      sandbox.cloneRepository({ ...samplePullRequest(), owner: "elsewhere" }),
    ).rejects.toThrow(/selection/);
    await expect(
      sandbox.checkoutPullRequest({ ...samplePullRequest(), headSha: "main" }),
    ).rejects.toThrow(/immutable/);
    await sandbox.cloneRepository(samplePullRequest());
    await expect(
      sandbox.checkoutPullRequest(samplePullRequest()),
    ).rejects.toThrow(/does not match/);
    await expect(sandbox.installDependencies()).rejects.toThrow(/confirm/);
  });

  it("refuses execution and network retries after a failed dependency installation", async () => {
    const { sandbox, mock, installation } = await prepared(
      remote({ installExit: 1 }),
    );
    expect(installation.exitCode).toBe(1);
    const count = mock.execute.mock.calls.length;
    await expect(sandbox.runCommand("build")).rejects.toThrow(
      /Install dependencies/,
    );
    await expect(sandbox.installDependencies()).rejects.toThrow(
      /already been attempted/,
    );
    await expect(sandbox.cloneRepository(samplePullRequest())).rejects.toThrow(
      /Network access is disabled/,
    );
    expect(mock.execute).toHaveBeenCalledTimes(count);
  });

  it("rejects traversal, oversized/overwritten files and stale reports", async () => {
    const { sandbox, mock } = await prepared();
    await expect(sandbox.readFile("../secrets")).rejects.toThrow(/path/);
    await expect(sandbox.writeFile("package.json", "bad")).rejects.toThrow(
      /limited/,
    );
    await expect(
      sandbox.writeFile(".change-verifier/one.test.ts", "x".repeat(32001)),
    ).rejects.toThrow(/size/);
    await sandbox.writeFile(".change-verifier/one.test.ts", "test content");
    await expect(
      sandbox.writeFile(".change-verifier/one.test.ts", "replacement"),
    ).rejects.toThrow(/existing/);
    mock.files[".change-verifier/one.report.json"] = "{}";
    await expect(
      sandbox.runCommand("generated", "one.test.ts"),
    ).rejects.toThrow(/stale/);
  });

  it("does not accept another file's report as generated evidence", async () => {
    const { sandbox } = await prepared(remote({ wrongReport: true }));
    await sandbox.writeFile(".change-verifier/one.test.ts", "test content");
    expect((await sandbox.runCommand("generated", "one.test.ts")).output).toBe(
      "Vitest did not produce a readable JSON report.",
    );
  });

  it("stops after an uncertain mutation instead of reusing an old checkpoint", async () => {
    const { sandbox, mock } = await prepared();
    mock.execute.mockImplementationOnce(async () => {
      throw new Error("Nebius sandbox request was cancelled or timed out.");
    });
    await expect(
      sandbox.writeFile(".change-verifier/one.test.ts", "content"),
    ).rejects.toThrow(/timed out/);
    await expect(sandbox.runCommand("build")).rejects.toThrow(
      /Create the Nebius sandbox first/,
    );
    await sandbox.destroySandbox();
    expect(mock.destroy).toHaveBeenCalledOnce();
  });

  it("keeps a known command failure but stops further work if its checkpoint is missing", async () => {
    const { sandbox, mock } = await prepared();
    const original = mock.execute.getMockImplementation()!;
    mock.execute.mockImplementation(async (spec) =>
      spec.args?.includes("run")
        ? {
            operationId: initialImage,
            exitCode: 7,
            stdout: "build failed",
            stderr: "",
            timedOut: false,
            truncated: false,
            durationMs: 1,
          }
        : original(spec),
    );
    expect(await sandbox.runCommand("build")).toMatchObject({
      exitCode: 7,
      output: "build failed",
    });
    await expect(sandbox.runCommand("tests")).rejects.toThrow(
      /Create the Nebius sandbox first/,
    );
  });

  it("rejects missing checkpoint output and cleans up even after cancellation or disablement", async () => {
    enabled();
    const controller = new AbortController();
    const mock = remote();
    mock.execute.mockResolvedValueOnce({
      operationId: initialImage,
      stdout: "",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      truncated: false,
      durationMs: 1,
    });
    const sandbox = new NebiusSandboxProvider(
      "acme/platform",
      controller.signal,
      mock,
    );
    await expect(sandbox.createSandbox()).rejects.toThrow(/checkpoint/);
    controller.abort(new Error("private cancellation reason"));
    await expect(sandbox.readFile("package.json")).rejects.toThrow(
      "Nebius sandbox request was cancelled.",
    );
    vi.stubEnv("ENABLE_NEBIUS_SANDBOX", "false");
    await sandbox.destroySandbox();
    expect(mock.destroy).toHaveBeenCalledOnce();
  });
});
