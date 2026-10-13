import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  ContreeClient,
  contreeConfiguration,
} from "@/lib/sandbox/contree-client";

// Explicitly opt in: this uses billable remote execution and retains a tiny public fixture checkpoint.
it.runIf(process.env.RUN_NEBIUS_SANDBOX_TESTS === "true")(
  "executes offline as non-root, carries checkpoint files, reports failures, and cancels",
  async () => {
    const config = contreeConfiguration();
    const remote = new ContreeClient(config);
    const file = `/tmp/change-verifier-smoke-${randomUUID()}`;
    try {
      const prepared = await remote.execute({
        command: "node",
        args: [
          "-e",
          `
          const fs = require('node:fs');
          const cp = require('node:child_process');
          if (process.getuid() !== 1000) process.exit(1);
          if (Number(process.versions.node.split('.')[0]) < 22) process.exit(2);
          for (const tool of ['git', 'npm', 'corepack']) {
            if (cp.spawnSync(tool, ['--version'], {stdio: 'pipe'}).status !== 0) process.exit(3);
          }
          fs.writeFileSync(${JSON.stringify(file)}, 'public smoke-test fixture', {flag: 'wx'});
          console.log('prepared');
        `,
        ],
        env: {
          PATH: "/usr/local/bin:/usr/bin:/bin",
          HOME: "/tmp",
          NODE_ENV: "test",
        },
        cwd: "/tmp",
        networking: false,
        timeoutSeconds: 30,
      });
      expect(prepared).toMatchObject({
        exitCode: 0,
        timedOut: false,
        truncated: false,
      });
      expect(prepared.imageId).toBeTruthy();
      const check = await remote.execute({
        image: prepared.imageId,
        command: "node",
        args: [
          "-e",
          `
          const fs = require('node:fs');
          const os = require('node:os');
          if (fs.readFileSync(${JSON.stringify(file)}, 'utf8') !== 'public smoke-test fixture') process.exit(1);
          if (Object.values(os.networkInterfaces()).flat().some(x => x && !x.internal)) process.exit(2);
          if (Object.keys(process.env).some(k => /TOKEN|SECRET|API_KEY|PASSWORD/.test(k))) process.exit(3);
          console.log('offline checkpoint verified');
          process.exit(7);
        `,
        ],
        env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
        networking: false,
        disposable: true,
        timeoutSeconds: 20,
      });
      expect(check).toMatchObject({
        exitCode: 7,
        timedOut: false,
        truncated: false,
      });
      expect(check.stdout).toContain("offline checkpoint verified");

      const controller = new AbortController();
      const cancellable = new ContreeClient(config, controller.signal);
      // Abort only after an operation ID has been returned, to exercise remote cleanup.
      const timer = setInterval(() => {
        if (cancellable.operationIds.size) controller.abort();
      }, 100);
      try {
        await expect(
          cancellable.execute({
            command: "node",
            args: ["-e", "setTimeout(() => {}, 20000)"],
            env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
            networking: false,
            disposable: true,
            timeoutSeconds: 25,
          }),
        ).rejects.toThrow(/cancelled/);
      } finally {
        clearInterval(timer);
        await cancellable.destroy();
      }
    } finally {
      await remote.destroy();
    }
  },
  120_000,
);
