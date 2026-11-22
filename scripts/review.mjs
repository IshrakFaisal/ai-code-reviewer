import { existsSync } from "node:fs";
import { Console } from "node:console";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const interrupt = new AbortController();
const onInterrupt = () => interrupt.abort();
process.on("SIGINT", onInterrupt);
// Provider libraries log request paths and raw diagnostics via console. Only
// the CLI's explicit stdout and stderr writers should reach the calling job.
globalThis.console = new Console(new Writable({
  write(_chunk, _encoding, done) { done(); },
}));
try {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const loader = createJiti(import.meta.url, {
    alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  });
  const command = process.env.npm_lifecycle_event;
  if (command === "eval" || command === "eval:score") {
    const { evalMain } = await loader.import("./eval.ts");
    process.exitCode = await evalMain(process.argv.slice(2), interrupt.signal, command === "eval:score");
  } else {
    const { review } = await loader.import("./review-cli.ts");
    process.exitCode = await review(process.argv.slice(2), interrupt.signal);
  }
} catch {
  process.stderr.write(
    "Could not initialize the review CLI. Check the local installation and configuration.\n",
  );
  process.exitCode = interrupt.signal.aborted ? 130 : 1;
} finally {
  process.off("SIGINT", onInterrupt);
}
