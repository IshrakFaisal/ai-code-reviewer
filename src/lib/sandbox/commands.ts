import type { CommandId } from "./provider";

export interface Manifest {
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}
export type PackageManager = { name: "npm" | "pnpm" | "yarn"; version?: string };
export interface ExecutionPlan {
  command: string;
  args: string[];
}
export type ReadSandboxFile = (relative: string) => Promise<string>;

export async function optionalFile(read: ReadSandboxFile, relative: string) {
  try { return await read(relative); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function readManifest(read: ReadSandboxFile): Promise<Manifest> {
  const value = JSON.parse(await read("package.json"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The root package.json must be an object.");
  return value as Manifest;
}

export async function packageManager(read: ReadSandboxFile): Promise<PackageManager> {
  const manifest = await readManifest(read);
  const locks: PackageManager["name"][] = [];
  for (const [name, file] of [["npm", "package-lock.json"], ["pnpm", "pnpm-lock.yaml"], ["yarn", "yarn.lock"]] as const)
    if ((await optionalFile(read, file)) !== undefined) locks.push(name);
  if (locks.length !== 1)
    throw new Error("Execution requires exactly one root npm, pnpm or Yarn lockfile.");
  const declared = manifest.packageManager;
  if (declared !== undefined && typeof declared !== "string")
    throw new Error("Invalid packageManager declaration.");
  const pinned = declared?.match(/^(npm|pnpm|yarn)@(\d+\.\d+\.\d+)(?:\+sha(?:224|256|384|512)\.[a-f0-9]+)?$/);
  if (declared && !pinned)
    throw new Error("packageManager must specify an exact npm, pnpm or Yarn version.");
  if (pinned && pinned[1] !== locks[0])
    throw new Error("The packageManager declaration does not match the root lockfile.");
  if (locks[0] !== "npm" && !pinned)
    throw new Error("pnpm and Yarn execution requires an exact packageManager version in package.json.");
  return { name: locks[0], version: pinned?.[2] };
}

function invocation(manager: PackageManager, args: string[]): ExecutionPlan {
  return manager.version
    ? { command: "corepack", args: [`${manager.name}@${manager.version}`, ...args] }
    : { command: "npm", args };
}
export function installPlan(manager: PackageManager): ExecutionPlan {
  if (manager.name === "npm") return invocation(manager, ["ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
  if (manager.name === "pnpm") return invocation(manager, ["install", "--frozen-lockfile", "--ignore-scripts", "--ignore-pnpmfile"]);
  return invocation(manager, Number(manager.version?.split(".")[0]) >= 2
    ? ["install", "--immutable", "--mode=skip-build"]
    : ["--no-default-rc", "install", "--frozen-lockfile", "--ignore-scripts", "--non-interactive"]);
}

export async function commandPlan(command: Exclude<CommandId, "generated">, manager: PackageManager, read: ReadSandboxFile): Promise<ExecutionPlan> {
  const manifest = await readManifest(read);
  const name = command === "tests" ? "test" : command;
  const script = manifest.scripts?.[name];
  if (typeof script !== "string" || !script.trim()) {
    if (command === "typecheck" && (manifest.dependencies?.typescript || manifest.devDependencies?.typescript) && (await optionalFile(read, "tsconfig.json")) !== undefined)
      return { command: "node", args: ["node_modules/typescript/bin/tsc", "--noEmit"] };
    throw new Error(`No ${name} script is available.`);
  }
  const args = ["run", name];
  if (command === "tests") {
    // Appended flags are only safe for a direct runner invocation, not composed scripts.
    if (/^\s*vitest(?:\s|$)/.test(script) && !/[;&|]/.test(script)) args.push(...(manager.name === "npm" ? ["--", "--run"] : ["--run"]));
    else if (/^\s*jest(?:\s|$)/.test(script) && !/[;&|]/.test(script)) args.push(...(manager.name === "npm" ? ["--", "--watch=false", "--runInBand"] : ["--watch=false", "--runInBand"]));
  }
  return invocation(manager, args);
}

export function validateRelativePath(relative: string, writing = false) {
  if (!relative || relative.includes("\\") || relative.includes("\0") || relative.startsWith("/") || /^[a-zA-Z]:/.test(relative) || relative.split("/").some((part) => !part || part === "." || part === ".."))
    throw new Error("Invalid sandbox file path.");
  if (writing && !/^\.change-verifier\/[a-zA-Z0-9_-]+\.test\.ts$/.test(relative))
    throw new Error("Writes are limited to generated test files.");
}

export function generatedPlan(filename: string) {
  if (!/^[a-zA-Z0-9_-]+\.test\.ts$/.test(filename))
    throw new Error("Invalid generated test filename.");
  const stem = filename.slice(0, -8);
  const config = `.change-verifier/${stem}.config.mjs`;
  const report = `.change-verifier/${stem}.report.json`;
  const test = { include: [`.change-verifier/${filename}`], exclude: ["**/node_modules/**"], watch: false, passWithNoTests: false, maxWorkers: 1, minWorkers: 1, fileParallelism: false, expect: { requireAssertions: true } };
  return {
    config, report,
    // Inline projects disable Vitest's automatic workspace/config discovery.
    content: `export default ${JSON.stringify({ test: { ...test, projects: [{ test: { ...test, name: "generated" } }] } })};\n`,
    command: "node",
    args: ["node_modules/vitest/vitest.mjs", "run", "--config", config, "--reporter=json", "--outputFile", report],
  };
}

export async function requireVitest(read: ReadSandboxFile) {
  const manifest = await readManifest(read);
  if (!(manifest.devDependencies?.vitest || manifest.dependencies?.vitest))
    throw new Error("Generated execution requires a declared Vitest dependency.");
  const installed = JSON.parse(await read("node_modules/vitest/package.json"));
  if (typeof installed.version !== "string" || !/^[34]\./.test(installed.version))
    throw new Error("Generated execution requires Vitest 3 or 4 with assertion enforcement support.");
}

export const sandboxEnvironment = (root: string, yarnRcFilename: string): NodeJS.ProcessEnv => ({
  PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  HOME: `${root}/home`, TMPDIR: "/tmp", NODE_ENV: "test", CI: "true",
  GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  npm_config_cache: `${root}/npm-cache`, npm_config_ignore_scripts: "true",
  npm_config_audit: "false", npm_config_fund: "false",
  COREPACK_HOME: `${root}/corepack`, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  COREPACK_DEFAULT_TO_LATEST: "0", YARN_ENABLE_SCRIPTS: "false",
  YARN_RC_FILENAME: yarnRcFilename,
  YARN_ENABLE_TELEMETRY: "0", YARN_IGNORE_PATH: "1", YARN_NODE_LINKER: "node-modules",
  PNPM_HOME: `${root}/pnpm`,
});
