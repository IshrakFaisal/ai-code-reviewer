import { createSandboxProvider } from "@/lib/sandbox/factory";
import type { CommandId, SandboxProvider } from "@/lib/sandbox/provider";
import type { Evidence, Finding, PullRequest } from "@/lib/types";
import { executionEvidence, generatedEvidence, notRun } from "./execution";

export async function runLiveVerification(
  pr: PullRequest,
  findings: Finding[],
  signal?: AbortSignal,
): Promise<Evidence[]> {
  signal?.throwIfAborted();
  const types = ["Build", "TypeScript", "Existing tests"];
  const explain = (error: unknown) =>
    error instanceof Error
      ? error.message.slice(0, 2000)
      : "The execution provider is unavailable.";
  const unavailable = (reason: string) => {
    for (const f of findings)
      f.evidence.push({
        ...notRun("Generated test", reason),
        filePaths: f.affectedFiles.map((ref) => ref.path),
      });
    return types.map((t) => notRun(t, reason));
  };
  let sandbox: SandboxProvider;
  try {
    sandbox = createSandboxProvider(`${pr.owner}/${pr.repo}`, signal);
  } catch (e) {
    return unavailable(explain(e));
  }
  const checks: Evidence[] = [];
  try {
    await sandbox.createSandbox();
    signal?.throwIfAborted();
    await sandbox.cloneRepository(pr);
    signal?.throwIfAborted();
    await sandbox.checkoutPullRequest(pr);
    signal?.throwIfAborted();
    const install = await sandbox.installDependencies();
    signal?.throwIfAborted();
    checks.push(executionEvidence("Dependency installation", install));
    if (install.exitCode !== 0 || install.timedOut) {
      checks.push(
        ...unavailable(
          "Dependency installation failed or timed out; repository checks were not executed.",
        ),
      );
      return checks;
    }
    for (const [type, cmd] of [
      ["Build", "build"],
      ["TypeScript", "typecheck"],
      ["Existing tests", "tests"],
    ] as [string, CommandId][]) {
      signal?.throwIfAborted();
      try {
        const result = await sandbox.runCommand(cmd);
        signal?.throwIfAborted();
        const evidence = executionEvidence(type, result);
        evidence.description +=
          " Command ran at the analyzed PR revision; the base revision was not compared.";
        if (type === "Existing tests")
          evidence.description +=
            " This records the repository test command outcome, not an independently measured assertion count.";
        checks.push(evidence);
      } catch (e) {
        signal?.throwIfAborted();
        checks.push(notRun(type, explain(e)));
      }
    }
    for (const [i, f] of findings.entries()) {
      signal?.throwIfAborted();
      if (!f.generatedTest) {
        f.evidence.push(
          notRun(
            "Generated test",
            "No executable verification plan could be generated.",
          ),
        );
        continue;
      }
      if (f.generatedTest.framework !== "vitest") {
        f.evidence.push(
          notRun(
            "Generated test",
            "Live targeted execution currently supports Vitest plans only.",
          ),
        );
        continue;
      }
      try {
        const filename = `investigation-${i}.test.ts`;
        await sandbox.writeFile(
          `.change-verifier/${filename}`,
          f.generatedTest.code,
        );
        signal?.throwIfAborted();
        const result = await sandbox.runCommand("generated", filename);
        signal?.throwIfAborted();
        const evidence = generatedEvidence(result);
        evidence.filePaths = f.affectedFiles.map((r) => r.path);
        f.evidence.push(evidence);
      } catch (e) {
        signal?.throwIfAborted();
        f.evidence.push(notRun("Generated test", explain(e)));
      }
    }
    return checks;
  } catch (e) {
    signal?.throwIfAborted();
    checks.push(
      ...unavailable(`Sandbox setup could not complete: ${explain(e)}`),
    );
    return checks;
  } finally {
    await sandbox.destroySandbox().catch((e: unknown) => {
      checks.push({
        id: "sandbox-cleanup",
        type: "Sandbox cleanup",
        status: "WARNING",
        description: `Cleanup failed; the operator must remove remaining sandbox resources. ${explain(e)}`,
        provenance: "EXECUTED",
      });
    });
  }
}
