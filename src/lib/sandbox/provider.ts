import type { PullRequest } from "@/lib/types";
export type CommandId = "build" | "typecheck" | "tests" | "generated";
export interface CommandResult {
  exitCode: number;
  output: string;
  durationMs: number;
  timedOut: boolean;
}
export interface SandboxProvider {
  createSandbox(): Promise<void>;
  cloneRepository(pr: PullRequest): Promise<void>;
  checkoutPullRequest(pr: PullRequest): Promise<void>;
  installDependencies(): Promise<CommandResult>;
  runCommand(command: CommandId, testFile?: string): Promise<CommandResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  /** Optional capabilities used only by isolated regression/repair workflows. */
  runtimeIdentity?(): Promise<string>;
  replaceSource?(
    path: string,
    expectedSha256: string,
    content: string,
  ): Promise<void>;
  destroySandbox(): Promise<void>;
}
