import { beforeEach, describe, expect, it, vi, type Mocked } from "vitest";
import { createSandboxProvider } from "@/lib/sandbox/factory";
import type { CommandResult, SandboxProvider } from "@/lib/sandbox/provider";
import {
  sampleHypotheses,
  samplePullRequest,
} from "@/lib/demo/sample-analysis";
import type { Finding } from "@/lib/types";
import { runLiveVerification } from "@/lib/verification/runner";
import { findingStatus } from "@/lib/verification/execution";

vi.mock("@/lib/sandbox/factory", () => ({ createSandboxProvider: vi.fn() }));

const result = (options: Partial<CommandResult> = {}): CommandResult => ({
  exitCode: 0,
  output: "command completed",
  durationMs: 10,
  timedOut: false,
  ...options,
});
const testResult = (failed = false) =>
  result({
    exitCode: failed ? 1 : 0,
    output: JSON.stringify({
      numTotalTests: 1,
      numPassedTests: failed ? 0 : 1,
      numFailedTests: failed ? 1 : 0,
    }),
  });
const finding = (planned = true): Finding => ({
  ...sampleHypotheses[0],
  id: "finding-1",
  severity: "HIGH",
  status: "UNVERIFIED_RISK",
  riskScore: 60,
  evidence: [],
  ...(planned
    ? {
        generatedTest: {
          filename: "model-name.test.ts",
          framework: "vitest" as const,
          strategy: "Check the affected behavior",
          code: 'import { expect, test } from "vitest"; test("check", () => expect(true).toBe(true));',
        },
      }
    : {}),
});

let sandbox: Mocked<SandboxProvider>;
beforeEach(() => {
  vi.resetAllMocks();
  sandbox = {
    createSandbox: vi
      .fn<SandboxProvider["createSandbox"]>()
      .mockResolvedValue(),
    cloneRepository: vi
      .fn<SandboxProvider["cloneRepository"]>()
      .mockResolvedValue(),
    checkoutPullRequest: vi
      .fn<SandboxProvider["checkoutPullRequest"]>()
      .mockResolvedValue(),
    installDependencies: vi
      .fn<SandboxProvider["installDependencies"]>()
      .mockResolvedValue(result()),
    runCommand: vi
      .fn<SandboxProvider["runCommand"]>()
      .mockImplementation(async (command) =>
        command === "generated" ? testResult() : result(),
      ),
    readFile: vi.fn<SandboxProvider["readFile"]>().mockResolvedValue(""),
    writeFile: vi.fn<SandboxProvider["writeFile"]>().mockResolvedValue(),
    destroySandbox: vi
      .fn<SandboxProvider["destroySandbox"]>()
      .mockResolvedValue(),
  };
  vi.mocked(createSandboxProvider).mockReturnValue(sandbox);
});

describe("verification orchestration", () => {
  it("selects a provider, checks out the immutable PR and runs commands before attributed targeted tests", async () => {
    const pr = samplePullRequest(),
      f = finding();
    const checks = await runLiveVerification(pr, [f]);
    expect(createSandboxProvider).toHaveBeenCalledWith(
      "acme/platform",
      undefined,
    );
    expect(sandbox.checkoutPullRequest).toHaveBeenCalledWith(pr);
    expect(sandbox.runCommand.mock.calls).toEqual([
      ["build"],
      ["typecheck"],
      ["tests"],
      ["generated", "investigation-0.test.ts"],
    ]);
    expect(sandbox.writeFile).toHaveBeenCalledWith(
      ".change-verifier/investigation-0.test.ts",
      f.generatedTest!.code,
    );
    expect(checks.map((check) => check.status)).toEqual([
      "PASS",
      "PASS",
      "PASS",
      "PASS",
    ]);
    expect(
      checks.find((check) => check.type === "Build")?.description,
    ).toContain("base revision was not compared");
    expect(f.evidence[0].filePaths).toEqual(
      f.affectedFiles.map((ref) => ref.path),
    );
    expect(findingStatus(f.evidence)).toBe("VERIFIED_FOR_TEST");
    expect(sandbox.destroySandbox).toHaveBeenCalledOnce();
  });

  it("retains each finding's own evidence and treats live assertion failures as inconclusive", async () => {
    const first = finding(),
      second = finding();
    sandbox.runCommand.mockImplementation(async (command, filename) =>
      command === "generated"
        ? testResult(filename === "investigation-1.test.ts")
        : result(),
    );
    await runLiveVerification(samplePullRequest(), [first, second]);
    expect(first.evidence[0].status).toBe("PASS");
    expect(second.evidence[0].status).toBe("FAIL");
    expect(findingStatus(second.evidence)).toBe("INCONCLUSIVE");
  });

  it("reports disabled providers as unexecuted without attempting setup", async () => {
    vi.mocked(createSandboxProvider).mockImplementation(() => {
      throw new Error("Execution is disabled.");
    });
    const f = finding(),
      checks = await runLiveVerification(samplePullRequest(), [f]);
    expect(checks.every((check) => check.status === "NOT_RUN")).toBe(true);
    expect(f.evidence[0].status).toBe("NOT_RUN");
    expect(sandbox.createSandbox).not.toHaveBeenCalled();
  });

  it.each([
    "createSandbox",
    "cloneRepository",
    "checkoutPullRequest",
    "installDependencies",
  ] as const)(
    "cleans up and preserves setup failure details from %s",
    async (stage) => {
      sandbox[stage].mockRejectedValue(new Error("Fixture setup error."));
      const f = finding(),
        checks = await runLiveVerification(samplePullRequest(), [f]);
      expect(checks.every((check) => check.status === "NOT_RUN")).toBe(true);
      expect(checks[0].description).toContain("Fixture setup error");
      expect(sandbox.runCommand).not.toHaveBeenCalled();
      expect(sandbox.destroySandbox).toHaveBeenCalledOnce();
    },
  );

  it.each([result({ exitCode: 1 }), result({ timedOut: true })])(
    "stops execution when dependency installation fails or times out",
    async (installation) => {
      sandbox.installDependencies.mockResolvedValue(installation);
      const f = finding(),
        checks = await runLiveVerification(samplePullRequest(), [f]);
      expect(
        checks.find((check) => check.type === "Dependency installation")
          ?.status,
      ).toBe("FAIL");
      expect(
        checks
          .filter((check) => check.type !== "Dependency installation")
          .every((check) => check.status === "NOT_RUN"),
      ).toBe(true);
      expect(f.evidence[0].status).toBe("NOT_RUN");
      expect(sandbox.runCommand).not.toHaveBeenCalled();
      expect(sandbox.destroySandbox).toHaveBeenCalledOnce();
    },
  );

  it("continues after missing scripts or frameworks without manufacturing passes", async () => {
    sandbox.runCommand.mockRejectedValue(
      new Error("No compatible test framework or script is available."),
    );
    const f = finding(),
      checks = await runLiveVerification(samplePullRequest(), [f]);
    expect(
      checks
        .filter((check) => check.type !== "Dependency installation")
        .every((check) => check.status === "NOT_RUN"),
    ).toBe(true);
    expect(f.evidence[0].status).toBe("NOT_RUN");
    expect(sandbox.destroySandbox).toHaveBeenCalledOnce();
  });

  it("does not execute findings without supported plans", async () => {
    const missing = finding(false),
      unsupported = finding();
    unsupported.generatedTest!.framework = "node:test";
    await runLiveVerification(samplePullRequest(), [missing, unsupported]);
    expect(sandbox.writeFile).not.toHaveBeenCalled();
    expect(
      [missing, unsupported].every((f) => f.evidence[0].status === "NOT_RUN"),
    ).toBe(true);
  });

  it("keeps runtime errors or a zero-test run inconclusive", async () => {
    sandbox.runCommand.mockImplementation(async (command) =>
      command === "generated"
        ? result({ exitCode: 1, output: "SyntaxError" })
        : result(),
    );
    const f = finding();
    await runLiveVerification(samplePullRequest(), [f]);
    expect(f.evidence[0].status).toBe("WARNING");
    expect(findingStatus(f.evidence)).toBe("INCONCLUSIVE");
  });

  it("rejects pre-cancelled work without allocating a provider", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runLiveVerification(samplePullRequest(), [finding()], controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(createSandboxProvider).not.toHaveBeenCalled();
  });

  it("stops on cancellation during execution and always releases provider resources", async () => {
    const controller = new AbortController();
    sandbox.runCommand.mockImplementation(async () => {
      controller.abort();
      return result();
    });
    await expect(
      runLiveVerification(samplePullRequest(), [finding()], controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(sandbox.runCommand).toHaveBeenCalledTimes(1);
    expect(sandbox.destroySandbox).toHaveBeenCalledOnce();
  });

  it("surfaces cleanup failures without erasing completed evidence", async () => {
    sandbox.destroySandbox.mockRejectedValue(
      new Error("Resource is still busy."),
    );
    const checks = await runLiveVerification(samplePullRequest(), [finding()]);
    expect(checks.find((check) => check.type === "Build")?.status).toBe("PASS");
    expect(
      checks.find((check) => check.type === "Sandbox cleanup")?.status,
    ).toBe("WARNING");
  });
});
