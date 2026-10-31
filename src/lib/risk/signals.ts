export const DEFAULT_WEIGHTS = {
  authentication: 30,
  authorization: 35,
  payments: 30,
  migration: 30,
  dependency: 15,
  security: 25,
  environment: 15,
  testsRemoved: 30,
  publicApi: 20,
  buildFailed: 50,
  existingTestsFailed: 50,
  generatedTestFailed: 40,
  largeDiff: 10,
  criticalConfig: 20,
  deletedValidation: 30,
  emailIntegration: 25,
};
export type RiskWeights = typeof DEFAULT_WEIGHTS;
export function configuredWeights(): RiskWeights {
  const weights = { ...DEFAULT_WEIGHTS };
  try {
    const input = JSON.parse(process.env.RISK_WEIGHTS_JSON || "{}");
    for (const key of Object.keys(weights) as (keyof RiskWeights)[]) {
      if (
        typeof input[key] === "number" &&
        Number.isFinite(input[key]) &&
        input[key] >= 0 &&
        input[key] <= 100
      )
        weights[key] = input[key];
    }
  } catch {
    /* Invalid overrides leave documented defaults intact. */
  }
  return weights;
}
