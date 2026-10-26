import { execFile } from "node:child_process";
import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";

const image = "node:22-bookworm";
/** @param {string} source @param {string} repository @param {boolean} production */
export function dockerEnvironmentFile(source, repository, production = false) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(
      repository,
    )
  )
    throw new Error("Use one exact public GitHub repository: OWNER/REPO.");
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const values = {
    DEMO_MODE: "false",
    SANDBOX_PROVIDER: "docker",
    ENABLE_LOCAL_SANDBOX: "true",
    LOCAL_SANDBOX_REPOSITORIES: repository,
    SANDBOX_DOCKER_IMAGE: image,
    ENABLE_PRODUCTION_SANDBOX: production ? "true" : "false",
  };
  const seen = new Set();
  const lines = source.split(/\r?\n/).map((line) => {
    const key = /^[ \t]*(?:export[ \t]+)?([A-Z_]+)[ \t]*=/.exec(line)?.[1];
    if (key && Object.hasOwn(values, key)) {
      seen.add(key);
      return `${key}=${values[key]}`;
    }
    return line;
  });
  while (lines.at(-1) === "") lines.pop();
  for (const [key, value] of Object.entries(values))
    if (!seen.has(key)) lines.push(`${key}=${value}`);
  return lines.join(newline) + newline;
}
async function docker(args, timeout = 20000) {
  const env = { NODE_ENV: "test" };
  for (const key of [
    "PATH",
    "SystemRoot",
    "WINDIR",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_CONFIG",
    "DOCKER_CERT_PATH",
    "DOCKER_TLS_VERIFY",
  ])
    if (process.env[key]) env[key] = process.env[key];
  return new Promise((resolve, reject) =>
    execFile(
      "docker",
      args,
      {
        timeout,
        maxBuffer: args[0] === "pull" ? 1_000_000 : 32000,
        windowsHide: true,
        env,
      },
      (error, stdout) =>
        error
          ? reject(
              new Error(
                error.code === "ENOENT"
                  ? "Docker Desktop is not installed or docker is not on PATH. Install/open Docker Desktop, then open a new terminal. See docs/DOCKER-WINDOWS.md."
                  : "Docker could not complete this check. Open Docker Desktop, select Linux containers, and retry. See docs/DOCKER-WINDOWS.md.",
              ),
            )
          : resolve(stdout.trim()),
    ),
  );
}
async function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const repository = args[args.indexOf("--repo") + 1];
  if (!check && (!args.includes("--repo") || !repository))
    throw new Error(
      "Usage: npm run docker:setup -- --repo OWNER/REPO [--production]. This enables exactly the repository you supply.",
    );
  if (!check)
    dockerEnvironmentFile("", repository, args.includes("--production"));
  if ((await docker(["info", "--format", "{{.OSType}}"])) !== "linux")
    throw new Error(
      "Select Linux containers in Docker Desktop before configuring execution.",
    );
  console.log("Docker Linux engine: available.");
  let imageReady = false;
  try {
    imageReady = /^sha256:[a-f0-9]{64}$/.test(
      await docker(["image", "inspect", image, "--format", "{{.Id}}"]),
    );
  } catch {}
  if (!imageReady && check)
    throw new Error(
      `Required image is missing. Run docker pull ${image}, or use npm run docker:setup -- --repo OWNER/REPO to prepare it.`,
    );
  if (!imageReady) {
    console.log(
      `Downloading the official ${image} image. This may take several minutes.`,
    );
    await docker(["pull", image], 600000);
  }
  console.log(`Sandbox image: ${image} available.`);
  if (check) {
    console.log(
      "Docker prerequisites are ready. No environment values were changed.",
    );
    return;
  }
  const root = fileURLToPath(new URL("../", import.meta.url));
  const target = path.join(root, ".env.local");
  let source = "";
  try {
    source = await readFile(target, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporary = path.join(root, `.env.docker-setup-${randomUUID()}.tmp`);
  try {
    await writeFile(
      temporary,
      dockerEnvironmentFile(source, repository, args.includes("--production")),
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  console.log(
    `Configured Docker execution for ${repository} only. Existing inference credentials were preserved and are not displayed.`,
  );
  console.log(
    args.includes("--production")
      ? "Production execution gate: enabled for the explicit allowlist. Restart the app to apply settings."
      : "Development execution is enabled. Restart npm run dev. The production execution gate remains off.",
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
