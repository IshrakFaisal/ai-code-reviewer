import { z } from "zod";

const modelCatalogSchema = z.object({
  object: z.literal("list"),
  data: z.array(z.object({ id: z.string().min(1).max(500) })).max(10000),
});

export interface NebiusConfiguration {
  key: string;
  model: string;
  baseUrl: string;
  requireNvidia: boolean;
}

export function nebiusConfiguration(): NebiusConfiguration {
  const key = process.env.NEBIUS_API_KEY;
  const model = process.env.NEBIUS_MODEL;
  if (!key || !model)
    throw new Error(
      "Nebius is not configured. Set NEBIUS_API_KEY and NEBIUS_MODEL; static analysis remains available.",
    );
  if (/\s|[\u0000-\u001f\u007f]/.test(model) || model.length > 500)
    throw new Error(
      "NEBIUS_MODEL must be an exact model ID from the Nebius catalog.",
    );
  let base: URL;
  try {
    base = new URL(
      process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1",
    );
  } catch {
    throw new Error("NEBIUS_BASE_URL must be a clean HTTPS endpoint.");
  }
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error("NEBIUS_BASE_URL must be a clean HTTPS endpoint.");
  const setting = process.env.NEBIUS_REQUIRE_NVIDIA;
  if (setting && setting !== "true" && setting !== "false")
    throw new Error("NEBIUS_REQUIRE_NVIDIA must be true or false.");
  const requireNvidia = setting !== "false";
  if (requireNvidia && !/^nvidia\//i.test(model))
    throw new Error(
      "Choose an NVIDIA model ID from the Nebius catalog, or explicitly set NEBIUS_REQUIRE_NVIDIA=false to use another provider's model.",
    );
  return { key, model, baseUrl: base.href.replace(/\/$/, ""), requireNvidia };
}

export async function readBoundedResponse(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Nebius returned an empty response.");
  let bytes = 0;
  let raw = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new Error("Nebius response exceeded size limit.");
      }
      raw += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return raw + decoder.decode();
}

/** Validate exact availability for this endpoint/account; never substitute another model. */
export async function validateNebiusModel(
  config: NebiusConfiguration,
  transport: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const response = await transport(`${config.baseUrl}/models`, {
    method: "GET",
    headers: { Authorization: `Bearer ${config.key}` },
    redirect: "error",
    signal: AbortSignal.any([
      AbortSignal.timeout(15000),
      ...(signal ? [signal] : []),
    ]),
  });
  if (!response.ok)
    throw new Error(
      `Nebius model catalog failed (HTTP ${response.status}). Static analysis remains available.`,
    );
  const raw = await readBoundedResponse(response, 1000000);
  let models: z.infer<typeof modelCatalogSchema>;
  try {
    models = modelCatalogSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error(
      "Nebius returned an invalid model catalog. Static analysis remains available.",
    );
  }
  if (!models.data.some(({ id }) => id === config.model))
    throw new Error(
      "NEBIUS_MODEL is not available in this endpoint's model catalog. Choose an exact ID accessible to your API key; no substitute was selected.",
    );
}
