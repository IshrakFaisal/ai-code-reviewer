import nextEnv from "@next/env";
import { z } from "zod";

nextEnv.loadEnvConfig(process.cwd(), true);

async function readJson(response, maxBytes) {
  if (!response.ok)
    throw new Error(`Nebius request failed (HTTP ${response.status}).`);
  if (!response.body) throw new Error("Nebius returned an empty response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let raw = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error("Nebius response exceeded size limit.");
      }
      raw += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(raw + decoder.decode());
  } catch {
    throw new Error("Nebius returned invalid JSON.");
  }
}

try {
  const key = process.env.NEBIUS_API_KEY;
  if (!key)
    throw new Error("Set NEBIUS_API_KEY in .env.local or your environment.");
  let base;
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
  const baseUrl = base.href.replace(/\/$/, "");
  const request = (path, options = {}) =>
    fetch(`${baseUrl}/${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(35000),
    });
  const catalogSchema = z.object({
    object: z.literal("list"),
    data: z.array(z.object({ id: z.string().min(1).max(500) })).max(10000),
  });
  const parsed = catalogSchema.safeParse(
    await readJson(await request("models"), 1000000),
  );
  if (!parsed.success)
    throw new Error("Nebius returned an invalid model catalog.");
  const models = parsed.data.data.map(({ id }) => id);
  if (process.argv.includes("--list")) {
    console.log("NVIDIA models available to this endpoint/account:");
    const nvidia = models.filter((id) => /^nvidia\//i.test(id));
    console.log(
      nvidia.length ? nvidia.join("\n") : "No NVIDIA models were returned.",
    );
    console.log(
      "Copy an exact ID into NEBIUS_MODEL. No inference request was made.",
    );
  } else {
    const model = process.env.NEBIUS_MODEL;
    if (!model || !models.includes(model))
      throw new Error(
        "Set NEBIUS_MODEL to an exact accessible catalog ID. Run npm run verify:nebius -- --list to discover NVIDIA models.",
      );
    const setting = process.env.NEBIUS_REQUIRE_NVIDIA;
    if (setting && setting !== "true" && setting !== "false")
      throw new Error("NEBIUS_REQUIRE_NVIDIA must be true or false.");
    if (setting !== "false" && !/^nvidia\//i.test(model))
      throw new Error(
        "Choose an NVIDIA model, or explicitly set NEBIUS_REQUIRE_NVIDIA=false.",
      );
    const envelope = await readJson(
      await request("chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model,
          max_tokens: 4500,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "Return JSON only. This is a structured-output connectivity check.",
            },
            { role: "user", content: 'Return exactly {"connection":"ok"}.' },
          ],
        }),
      }),
      300000,
    );
    let output;
    try {
      if (envelope.choices?.[0]?.message?.refusal) throw new Error();
      output = JSON.parse(envelope.choices?.[0]?.message?.content);
    } catch {
      throw new Error("Selected model did not return a JSON completion.");
    }
    if (
      !z
        .object({ connection: z.literal("ok") })
        .strict()
        .safeParse(output).success
    )
      throw new Error("Selected model failed the structured-output check.");
    console.log(
      `Verified ${model}: catalog access and a Zod-validated structured completion succeeded.`,
    );
    console.log(
      "This confirms connectivity and JSON behavior, not code-review accuracy.",
    );
  }
} catch (error) {
  // Fetch exceptions can include transport details; emit only intentional diagnostic messages.
  console.error(
    error instanceof TypeError
      ? "Nebius network request failed."
      : error.message,
  );
  process.exitCode = 1;
}
