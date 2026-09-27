import { z } from "zod";
import type { AIProvider } from "./provider";
import {
  behaviorSchema,
  hypothesisSchema,
  planSchema,
  categoryRefinementSchema,
  groundHypotheses,
} from "./provider";
import { SYSTEM_PROMPT } from "./prompts";
import {
  nebiusConfiguration,
  readBoundedResponse,
  validateNebiusModel,
  type NebiusConfiguration,
} from "./models";
import type { PullRequest, Hypothesis, Evidence } from "@/lib/types";

function context(pr: PullRequest) {
  let budget = 75000;
  return {
    title: pr.title,
    description: pr.description,
    headSha: pr.headSha,
    files: [...pr.files]
      .sort((a, b) => b.risk.score - a.risk.score)
      .slice(0, 60)
      .map((f) => {
        const patch = (f.patch || "Patch unavailable").slice(
          0,
          Math.max(0, Math.min(10000, budget)),
        );
        budget -= patch.length;
        return { path: f.path, categories: f.categories, risk: f.risk, patch };
      }),
  };
}
export class NebiusProvider implements AIProvider {
  readonly name: string;
  private configuration?: NebiusConfiguration;
  private modelValidation?: Promise<void>;
  constructor(
    private signal?: AbortSignal,
    private transport: typeof fetch = fetch,
  ) {
    this.name = `Nebius · ${/^nvidia\//i.test(process.env.NEBIUS_MODEL || "") ? "NVIDIA · " : ""}${process.env.NEBIUS_MODEL || "model unconfigured"}`;
  }
  async structured<T>(
    task: string,
    data: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const config = (this.configuration ||= nebiusConfiguration());
    this.modelValidation ||= validateNebiusModel(
      config,
      this.transport,
      this.signal,
    );
    await this.modelValidation;
    const jsonSchema = z.toJSONSchema(schema);
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.transport(
        `${config.baseUrl}/chat/completions`,
        {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: `Bearer ${config.key}`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.any([
            AbortSignal.timeout(35000),
            ...(this.signal ? [this.signal] : []),
          ]),
          body: JSON.stringify({
            model: config.model,
            max_tokens: 4500,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              {
                role: "user",
                content: JSON.stringify({
                  task,
                  schema: jsonSchema,
                  data,
                  ...(attempt
                    ? {
                        repair:
                          "Previous output was invalid. Return exactly the required JSON structure, with every required field and no markdown.",
                      }
                    : {}),
                }),
              },
            ],
          }),
        },
      );
      if (!response.ok)
        throw new Error(
          `Nebius request failed (HTTP ${response.status}). Static analysis remains available.`,
        );
      const raw = await readBoundedResponse(response, 300000);
      try {
        const envelope = JSON.parse(raw);
        if (envelope.choices?.[0]?.message?.refusal)
          throw new Error("Model declined analysis.");
        return schema.parse(
          JSON.parse(envelope.choices?.[0]?.message?.content),
        );
      } catch {
        if (attempt === 1)
          throw new Error(
            "Nebius output failed JSON validation twice. The report contains partial analysis.",
          );
      }
    }
    throw new Error("Model output unavailable.");
  }
  async analyzePullRequest(pr: PullRequest) {
    return (
      await this.structured(
        "Summarize the intended behavior in two sentences. Label this as inference.",
        context(pr),
        z.object({ intent: z.string().max(2000) }),
      )
    ).intent;
  }
  async identifyBehavioralChanges(pr: PullRequest) {
    const result = await this.structured(
      "Identify meaningful behavioral changes.",
      context(pr),
      z.object({ changes: z.array(behaviorSchema).max(12) }),
    );
    return result.changes.map((b) => ({
      ...b,
      files: b.files.filter((p) => pr.files.some((f) => f.path === p)),
      source: "AI_INFERENCE" as const,
    }));
  }
  async refineFileCategories(pr: PullRequest) {
    const supplied = context(pr);
    const result = await this.structured(
      "Refine changed-file categories from the supplied code changes. Return only supplied paths. Add concrete behavioral categories overlooked by path heuristics; do not remove heuristic categories or classify production code as tests. Omit files when the patch does not justify additional categories.",
      supplied,
      z.object({ files: z.array(categoryRefinementSchema).max(60) }),
    );
    const paths = new Set(supplied.files.map((file) => file.path));
    return result.files.filter((file) => paths.has(file.path));
  }
  async generateRiskHypotheses(pr: PullRequest, limit: number) {
    const result = await this.structured(
      `Generate at most ${limit} distinct, testable risk hypotheses. Explain change, impact, verification recommendation and files.`,
      context(pr),
      z.object({ hypotheses: z.array(hypothesisSchema).max(limit) }),
    );
    return groundHypotheses(result.hypotheses, pr);
  }
  async generateVerificationPlan(pr: PullRequest, hypothesis: Hypothesis) {
    return this.structured(
      "Generate one targeted Vitest test and a concise verification strategy. Do not use shell commands, network calls, or process execution.",
      { pr: context(pr), hypothesis },
      planSchema,
    );
  }
  async analyzeExecutionEvidence(hypothesis: Hypothesis, evidence: Evidence[]) {
    return (
      await this.structured(
        "Explain the evidence limitations. Do not upgrade the finding to a verified issue.",
        { hypothesis, evidence },
        z.object({ summary: z.string().max(1600) }),
      )
    ).summary;
  }
  async generateFinalReport(pr: PullRequest, hypotheses: Hypothesis[]) {
    return (
      await this.structured(
        "Summarize reviewer priorities without claiming verification or safety.",
        { title: pr.title, hypotheses },
        z.object({ summary: z.string().max(2000) }),
      )
    ).summary;
  }
}
