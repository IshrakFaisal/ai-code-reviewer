import { z } from "zod";
export function getConfig() {
  const explicit = process.env.DEMO_MODE;
  return {
    demo:
      explicit === "true" ||
      (explicit !== "false" && !process.env.NEBIUS_API_KEY),
    maxInvestigations: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .catch(5)
      .parse(process.env.MAX_INVESTIGATIONS),
    localSandbox:
      process.env.NODE_ENV === "development" &&
      process.env.ENABLE_LOCAL_SANDBOX === "true",
    model: process.env.NEBIUS_MODEL || "Not configured",
  };
}
