import { spawn } from "node:child_process";
import type { CommandResult } from "./provider";

export interface ProcessOptions {
  cwd?: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeout?: number;
  outputLimit?: number;
  input?: string;
  onTerminate?: () => Promise<void>;
}
export type ProcessRunner = (
  command: string,
  args: string[],
  options: ProcessOptions,
) => Promise<CommandResult>;

/** Never invokes a host shell. Child output, lifetime and inherited environment are bounded. */
export const runProcess: ProcessRunner = (command, args, options) => {
  if (options.signal?.aborted)
    return Promise.reject(new Error("Sandbox operation aborted."));
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = Buffer.alloc(0);
    let timedOut = false;
    let terminated = false;
    let termination: Promise<void> | undefined;
    const kill = () => {
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const terminate = () => {
      if (terminated) return;
      terminated = true;
      // Killing a Docker CLI does not stop its container: remove it independently.
      termination = options.onTerminate?.().catch(() => undefined);
      kill();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeout ?? 60_000);
    const abort = () => {
      timedOut = true;
      terminate();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const limit = options.outputLimit ?? 32_000;
    const append = (chunk: Buffer) => {
      const remaining = limit - output.length;
      if (remaining > 0) output = Buffer.concat([output, chunk.subarray(0, remaining)]);
      if (chunk.length > remaining) terminate();
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input);
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    };
    child.on("error", () => {
      cleanup();
      reject(new Error(`${command} is unavailable. Install the configured execution tool and ensure it is on PATH.`));
    });
    child.on("close", async (code) => {
      cleanup();
      // Native commands can leave children behind after their own exit.
      if (process.platform !== "win32") kill();
      await termination;
      resolve({
        exitCode: terminated ? -1 : (code ?? -1),
        output: output.toString("utf8"),
        durationMs: Date.now() - start,
        timedOut,
      });
    });
  });
};
