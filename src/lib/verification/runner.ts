import { createSandboxProvider } from "@/lib/sandbox/factory";
import type { CommandId, SandboxProvider } from "@/lib/sandbox/provider";
import type { Evidence, Finding, PullRequest } from "@/lib/types";
import { executionEvidence, generatedEvidence, notRun } from "./execution";
import { createHash } from "node:crypto";
import type { VerificationCheckpoint } from "./checkpoint";
class CheckpointFailure extends Error {}

export async function runLiveVerification(
  pr: PullRequest,
  findings: Finding[],
  signal?: AbortSignal,
  recovery?: {
    checkpoint?: VerificationCheckpoint;
    persist: (value: VerificationCheckpoint) => Promise<void>;
  },
): Promise<Evidence[]> {
  signal?.throwIfAborted();
  const saved: VerificationCheckpoint = structuredClone(
    recovery?.checkpoint ?? {
      headSha: pr.headSha,
      baseSha: pr.baseSha,
      preparation: [],
      commands: {},
      findings: {},
    },
  );
  const restoredFindings = new Set(Object.keys(saved.findings));
  if (
    recovery &&
    new Set(findings.map((finding) => finding.id)).size !== findings.length
  )
    throw new Error("Finding IDs must be unique for resumable verification.");
  if (saved.headSha !== pr.headSha || saved.baseSha !== pr.baseSha)
    throw new Error(
      "Verification checkpoint revisions do not match this analysis.",
    );
  const hash = (finding: Finding) =>
    createHash("sha256")
      .update(
        `${finding.generatedTest?.framework ?? ""}\0${finding.generatedTest?.code ?? ""}`,
      )
      .digest("hex");
  for (const finding of findings) {
    const previous = saved.findings[finding.id];
    if (previous && previous.testHash !== hash(finding))
      throw new Error(
        "Saved verification test differs from the generated test; start a new analysis.",
      );
    if (previous) finding.evidence = [previous.evidence];
  }
  const persist = async () => {
    signal?.throwIfAborted();
    try {
      await recovery?.persist(structuredClone(saved));
    } catch {
      throw new CheckpointFailure(
        "Verification checkpoint could not be saved. Execution stopped before starting another check.",
      );
    }
  };
  const commands: [string, Exclude<CommandId, "generated">][] = [
    ["Build", "build"],
    ["TypeScript", "typecheck"],
    ["Existing tests", "tests"],
  ];
  if (
    commands.every(([, command]) => saved.commands[command]) &&
    findings.every((finding) => saved.findings[finding.id])
  )
    return [
      ...saved.preparation,
      ...commands.map(([, command]) => saved.commands[command]!),
    ];
  const explain = (error: unknown) =>
    error instanceof Error
      ? error.message.slice(0, 2000)
      : "The execution provider is unavailable.";
  const unavailable = (reason: string) => {
    for (const f of findings) {
      if (restoredFindings.has(f.id)) continue;
      f.evidence.push({
        ...notRun("Generated test", reason),
        filePaths: f.affectedFiles.map((ref) => ref.path),
      });
    }
    return commands.map(
      ([type, command]) => saved.commands[command] ?? notRun(type, reason),
    );
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
    saved.preparation = [...checks];
    if (install.exitCode !== 0 || install.timedOut) {
      checks.push(
        ...unavailable(
          "Dependency installation failed or timed out; repository checks were not executed.",
        ),
      );
      return checks;
    }
    if (saved.commands.build?.status === "PASS") {
      // Restore build artifacts in the fresh sandbox without rewriting the original evidence.
      const preparation = executionEvidence(
        "Build preparation on resume",
        await sandbox.runCommand("build"),
      );
      signal?.throwIfAborted();
      checks.push(preparation);
      saved.preparation.push(preparation);
      if (preparation.status !== "PASS") {
        checks.push(
          ...unavailable(
            "Build preparation failed on resume; remaining checks were not executed.",
          ),
        );
        return checks;
      }
    }
    await persist();
    for (const [type, cmd] of commands) {
      signal?.throwIfAborted();
      if (saved.commands[cmd]) {
        checks.push(saved.commands[cmd]!);
        continue;
      }
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
        saved.commands[cmd] = evidence;
      } catch (e) {
        signal?.throwIfAborted();
        const evidence = notRun(type, explain(e));
        checks.push(evidence);
        saved.commands[cmd] = evidence;
      }
      await persist();
    }
    for (const [i, f] of findings.entries()) {
      signal?.throwIfAborted();
      if (restoredFindings.has(f.id)) continue;
      const acknowledge = async () => {
        saved.findings[f.id] = {
          testHash: hash(f),
          evidence: f.evidence.at(-1)!,
        };
        await persist();
      };
      if (!f.generatedTest) {
        f.evidence.push(
          notRun(
            "Generated test",
            "No executable verification plan could be generated.",
          ),
        );
        await acknowledge();
        continue;
      }
      if (f.generatedTest.framework !== "vitest") {
        f.evidence.push(
          notRun(
            "Generated test",
            "Live targeted execution currently supports Vitest plans only.",
          ),
        );
        await acknowledge();
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
      await acknowledge();
    }
    return checks;
  } catch (e) {
    signal?.throwIfAborted();
    if (e instanceof CheckpointFailure) throw e;
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
