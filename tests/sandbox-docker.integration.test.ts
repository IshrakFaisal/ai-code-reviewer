import { afterEach, expect, it, vi } from "vitest";
import { DockerSandboxProvider } from "@/lib/sandbox/docker";
import { runProcess, type ProcessRunner } from "@/lib/sandbox/process";

afterEach(() => vi.unstubAllEnvs());

// Opt-in: this executes a fixed local fixture in a real pre-pulled Linux image.
// GitHub clone/SHA argument construction is covered separately by contract tests.
it.skipIf(process.env.RUN_DOCKER_SANDBOX_TESTS !== "true")(
  "runs a non-root offline fixture, enforces file boundaries and removes its container",
  async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SANDBOX_PROVIDER", "docker");
    vi.stubEnv("ENABLE_LOCAL_SANDBOX", "true");
    vi.stubEnv("LOCAL_SANDBOX_REPOSITORIES", "fixture/isolated");
    vi.stubEnv("NEBIUS_API_KEY", "must-not-enter-the-container");
    let name = "";
    let cliEnvironment: NodeJS.ProcessEnv = { NODE_ENV: "test" };
    const transport: ProcessRunner = (command, args, options) => {
      cliEnvironment = options.env;
      if (args[0] === "create") name = args[args.indexOf("--name") + 1];
      return runProcess(command, args, options);
    };
    const sandbox = new DockerSandboxProvider(
      "fixture/isolated",
      undefined,
      transport,
    );
    try {
      await sandbox.createSandbox();
      const manifest = {
        name: "verifier-isolation-fixture",
        version: "1.0.0",
        scripts: {
          build: "node verify.cjs",
          test: 'node -e "process.exit(1)"',
        },
      };
      const verification = `
        const assert = require('node:assert/strict');
        const fs = require('node:fs');
        assert.notEqual(process.getuid(), 0);
        assert.equal(process.env.NEBIUS_API_KEY, undefined);
        assert.equal(process.env.GITHUB_TOKEN, undefined);
        assert.equal(fs.existsSync('/var/run/docker.sock'), false);
        assert.throws(() => fs.writeFileSync('/verifier-forbidden', 'x'));
        assert.deepEqual(fs.readdirSync('/sys/class/net'), ['lo']);
        console.log('isolation assertions passed');
      `;
      const fixture = {
        "package.json": JSON.stringify(manifest),
        "package-lock.json": JSON.stringify({
          name: manifest.name,
          version: "1.0.0",
          lockfileVersion: 3,
          packages: { "": { name: manifest.name, version: "1.0.0" } },
        }),
        "verify.cjs": verification,
        // Large lockfiles must be detected without reading them unboundedly.
        "large.txt": "x".repeat(300000),
      };
      const seed = `const fs=require('node:fs');fs.mkdirSync('/workspace/repo');for(const [name,body] of Object.entries(${JSON.stringify(fixture)}))fs.writeFileSync('/workspace/repo/'+name,body);fs.symlinkSync('/etc/passwd','/workspace/repo/escape');fs.symlinkSync('/workspace/repo/package.json','/workspace/repo/contained');`;
      // Seed via stdin rather than command-line text to avoid OS argument limits.
      const seeded = await runProcess("docker", ["exec", "-i", name, "node"], {
        env: cliEnvironment,
        input: seed,
        timeout: 15000,
      });
      expect(seeded.exitCode, seeded.output).toBe(0);
      expect((await sandbox.readFile("large.txt")).length).toBe(256000);
      expect(await sandbox.readFile("contained")).toBe(
        JSON.stringify(manifest),
      );
      await expect(sandbox.readFile("escape")).rejects.toThrow();
      await expect(sandbox.writeFile("../escape", "data")).rejects.toThrow();
      const install = await sandbox.installDependencies();
      expect(install.exitCode, install.output).toBe(0);
      const build = await sandbox.runCommand("build");
      expect(build.exitCode, build.output).toBe(0);
      expect(build.output).toContain("isolation assertions passed");
      expect((await sandbox.runCommand("tests")).exitCode).toBe(1);
      await expect(sandbox.runCommand("typecheck")).rejects.toThrow(
        /No typecheck/,
      );
      await sandbox.writeFile(
        ".change-verifier/check.test.ts",
        "// fixture file",
      );
      expect(await sandbox.readFile(".change-verifier/check.test.ts")).toBe(
        "// fixture file",
      );
      await expect(
        sandbox.writeFile(".change-verifier/check.test.ts", "overwrite"),
      ).rejects.toThrow();
    } finally {
      await sandbox.destroySandbox();
    }
    const removed = await runProcess("docker", ["inspect", name], {
      env: cliEnvironment,
      timeout: 10000,
    });
    expect(removed.exitCode).not.toBe(0);
    expect(removed.output).toMatch(/No such/i);
  },
  120000,
);
