import { spawn } from "node:child_process";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd(), true);
const missing = [
  "NEBIUS_SANDBOX_TOKEN",
  "NEBIUS_SANDBOX_PROJECT_ID",
  "NEBIUS_SANDBOX_IMAGE",
].filter((key) => !process.env[key]);
if (missing.length) {
  console.error(
    `Set ${missing.join(", ")} in .env.local before running the remote sandbox check.`,
  );
  process.exitCode = 1;
} else {
  console.log(
    "Running billable Nebius sandbox checks. A tiny public fixture checkpoint follows Nebius retention policy.",
  );
  const child = spawn(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/sandbox-nebius.integration.test.ts",
    ],
    {
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, RUN_NEBIUS_SANDBOX_TESTS: "true" },
    },
  );
  child.on("error", () => {
    console.error("Could not start the sandbox check.");
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
