import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const child = spawn(
  process.execPath,
  [
    fileURLToPath(
      new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
    ),
    "run",
    "tests/sandbox-docker.integration.test.ts",
  ],
  {
    stdio: "inherit",
    shell: false,
    windowsHide: true,
    env: { ...process.env, RUN_DOCKER_SANDBOX_TESTS: "true" },
  },
);
child.on("error", () => {
  console.error("Could not launch the Docker sandbox tests.");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
