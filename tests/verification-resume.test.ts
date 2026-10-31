import { afterEach, describe, expect, it, vi } from "vitest";
import type { SandboxProvider, CommandResult } from "@/lib/sandbox/provider";
import type { Finding } from "@/lib/types";
import {
  samplePullRequest,
  sampleHypotheses,
} from "@/lib/demo/sample-analysis";
import { runLiveVerification } from "@/lib/verification/runner";
import { createSandboxProvider } from "@/lib/sandbox/factory";
import type { VerificationCheckpoint } from "@/lib/verification/checkpoint";
vi.mock("@/lib/sandbox/factory", () => ({ createSandboxProvider: vi.fn() }));
const result: CommandResult = {
  exitCode: 0,
  output: "ok",
  durationMs: 10,
  timedOut: false,
};
const testResult: CommandResult = {
  ...result,
  output: JSON.stringify({
    numTotalTests: 1,
    numPassedTests: 1,
    numFailedTests: 0,
  }),
};
function findings(): Finding[] {
  return [0, 1].map((index) => ({
    ...sampleHypotheses[0],
    id: `finding-${index + 1}`,
    riskScore: 30,
    severity: "MEDIUM",
    status: "UNVERIFIED_RISK",
    evidence: [],
    generatedTest: {
      filename: `case-${index}.test.ts`,
      framework: "vitest",
      strategy: "Check behavior",
      code: `test('case ${index}', () => expect(true).toBe(true));`,
    },
  }));
}
function sandbox(): SandboxProvider {
  return {
    createSandbox: vi.fn().mockResolvedValue(undefined),
    cloneRepository: vi.fn().mockResolvedValue(undefined),
    checkoutPullRequest: vi.fn().mockResolvedValue(undefined),
    installDependencies: vi.fn().mockResolvedValue(result),
    runCommand: vi
      .fn()
      .mockImplementation(async (command) =>
        command === "generated" ? testResult : result,
      ),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    destroySandbox: vi.fn().mockResolvedValue(undefined),
  };
}
afterEach(() => vi.clearAllMocks());
describe("verification command checkpoints", () => {
  it("retains confirmed commands/tests after interruption and runs only remaining tests in a fresh sandbox", async () => {
    const controller = new AbortController(),
      first = sandbox(),
      second = sandbox(),
      pr = samplePullRequest();
    vi.mocked(createSandboxProvider)
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    let checkpoint: VerificationCheckpoint | undefined;
    await expect(
      runLiveVerification(pr, findings(), controller.signal, {
        persist: async (saved) => {
          checkpoint = saved;
          if (saved.findings["finding-1"]) controller.abort();
        },
      }),
    ).rejects.toThrow();
    expect(first.destroySandbox).toHaveBeenCalledOnce();
    expect(checkpoint!.findings["finding-1"].evidence.status).toBe("PASS");
    expect(checkpoint!.findings).not.toHaveProperty("finding-2");
    const restored = findings();
    const checks = await runLiveVerification(pr, restored, undefined, {
      checkpoint,
      persist: async (saved) => {
        checkpoint = saved;
      },
    });
    expect(second.cloneRepository).toHaveBeenCalledWith(pr);
    expect(second.checkoutPullRequest).toHaveBeenCalledWith(pr);
    expect(second.runCommand).toHaveBeenCalledTimes(2);
    expect(second.runCommand).toHaveBeenNthCalledWith(1, "build");
    expect(second.runCommand).toHaveBeenNthCalledWith(
      2,
      "generated",
      "investigation-1.test.ts",
    );
    expect(checks.map((check) => check.type)).toEqual([
      "Dependency installation",
      "Build preparation on resume",
      "Build",
      "TypeScript",
      "Existing tests",
    ]);
    expect(
      restored.every(
        (finding) =>
          finding.evidence.length === 1 &&
          finding.evidence[0].status === "PASS",
      ),
    ).toBe(true);
    expect(second.destroySandbox).toHaveBeenCalledOnce();
    const complete = await runLiveVerification(pr, findings(), undefined, {
      checkpoint,
      persist: vi.fn(),
    });
    expect(complete).toEqual(checks);
    expect(createSandboxProvider).toHaveBeenCalledTimes(2);
  });
  it("rejects changed revisions or test source before reusing evidence", async () => {
    const provider = sandbox(),
      pr = samplePullRequest();
    vi.mocked(createSandboxProvider).mockReturnValue(provider);
    let checkpoint: VerificationCheckpoint | undefined;
    await runLiveVerification(pr, findings(), undefined, {
      persist: async (saved) => {
        checkpoint = saved;
      },
    });
    await expect(
      runLiveVerification(
        { ...pr, headSha: "c".repeat(40) },
        findings(),
        undefined,
        { checkpoint, persist: vi.fn() },
      ),
    ).rejects.toThrow("revisions");
    const changed = findings();
    changed[0].generatedTest!.code += " // changed";
    await expect(
      runLiveVerification(pr, changed, undefined, {
        checkpoint,
        persist: vi.fn(),
      }),
    ).rejects.toThrow("differs");
    expect(createSandboxProvider).toHaveBeenCalledOnce();
  });
  it("stops execution and cleans up when checkpoint persistence fails", async () => {
    const provider = sandbox();
    vi.mocked(createSandboxProvider).mockReturnValue(provider);
    await expect(
      runLiveVerification(samplePullRequest(), findings(), undefined, {
        persist: async () => {
          throw new Error("Disk full");
        },
      }),
    ).rejects.toThrow("checkpoint could not be saved");
    expect(provider.runCommand).not.toHaveBeenCalled();
    expect(provider.destroySandbox).toHaveBeenCalledOnce();
  });
});
