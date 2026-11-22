import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import { analysisRuns } from "@/lib/agent/runs";
import { getConfig } from "@/lib/config";
import { parseGitHubInput, requestSchema } from "@/lib/github/input";
import { getReport } from "@/lib/reports/store";
import { buildPrComment, reportPriorityScore } from "@/lib/reports/pr-comment";
import { riskLevel } from "@/lib/risk/engine";

function argumentsForReview(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      demo: { type: "boolean" },
      quiet: { type: "boolean" },
      format: { type: "string", default: "comment" },
      out: { type: "string" },
      "fail-on": { type: "string", default: "none" },
    },
  });
  const [url] = positionals;
  if (
    positionals.length > 1 ||
    (!url && !values.demo) ||
    values.out === "" ||
    !["comment", "json"].includes(values.format) ||
    !["none", "medium", "high"].includes(values["fail-on"])
  )
    throw new Error();
  if (url) {
    if (!url.startsWith("https://")) throw new Error();
    parseGitHubInput(url);
  }
  const demoUrl = "https://github.com/acme/platform/pull/127";
  const demo =
    !!values.demo || (getConfig().demo && url?.replace(/\/$/, "") === demoUrl);
  return {
    values,
    input: requestSchema.parse({ input: demo ? demoUrl : url, demo }),
  };
}

export async function review(
  args: string[],
  interrupt: AbortSignal,
  {
    runs = analysisRuns,
    read = getReport,
    stdout = (s: string) => process.stdout.write(s),
    stderr = (s: string) => process.stderr.write(s),
    timeoutMs = 280000,
  } = {},
) {
  let parsed;
  try {
    parsed = argumentsForReview(args);
  } catch {
    stderr(
      "Expected a public GitHub PR URL or --demo and valid review options.\n",
    );
    return 1;
  }
  const { values, input } = parsed;
  if (!input.demo && getConfig().demo) {
    stderr(
      "Demo mode is enabled. Set DEMO_MODE=false for a real PR or use --demo for the fixture.\n",
    );
    return 1;
  }
  const timeout = AbortSignal.timeout(timeoutMs);
  const stop = AbortSignal.any([interrupt, timeout]);
  let id: string | undefined;
  let pause: Promise<unknown> | undefined;
  const cancel = () => {
    if (id && !pause) pause = runs.pause(id).catch(() => undefined);
  };
  stop.addEventListener("abort", cancel, { once: true });
  try {
    if (stop.aborted) return interrupt.aborted ? 130 : 2;
    const job = await runs.start(input);
    id = job.snapshot.id;
    stderr(`Run ${id}\n`);
    if (!values.quiet) stderr("Analyzing pull request…\n");
    if (stop.aborted) cancel();
    await job.done;
    await pause;
    if (stop.aborted) {
      stderr(
        interrupt.aborted ? "Review interrupted.\n" : "Review timed out.\n",
      );
      return interrupt.aborted ? 130 : 2;
    }
    const state = await runs.get(id);
    const report =
      state.status === "COMPLETE" && state.reportId
        ? await read(state.reportId)
        : null;
    if (!report) throw new Error();
    const json = JSON.stringify(report);
    // Upstream report fields can include arbitrary text. Fail closed before
    // exporting any configured credential, including a JSON-escaped value.
    for (const [key, value] of Object.entries(process.env)) {
      if (
        value &&
        /(?:TOKEN|PASSWORD|API_KEY|SECRET)$/i.test(key) &&
        json.includes(JSON.stringify(value).slice(1, -1))
      )
        throw new Error();
    }
    const output =
      (values.format === "json" ? json : buildPrComment(report, null)) + "\n";
    if (values.out) {
      try {
        await writeFile(values.out, output, "utf8");
      } catch {
        stderr("Could not write the output file.\n");
        return 1;
      }
    } else stdout(output);
    if (!values.quiet) stderr("Report saved.\n");
    const level = riskLevel(reportPriorityScore(report));
    const threshold = values["fail-on"];
    return threshold !== "none" &&
      (level === "HIGH" || (level === "MEDIUM" && threshold === "medium"))
      ? 3
      : 0;
  } catch {
    stderr("Review failed. Check the saved run for details.\n");
    return interrupt.aborted ? 130 : 2;
  } finally {
    stop.removeEventListener("abort", cancel);
  }
}
